import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseQuarkShare, mergeCookies, isRelevantPanTitle } from './netdisk-utils';
import { extractQuarkLinks, parseSearchCards } from './netdisk-search';
import { quarkVault, quarkStatus, startQuarkLogin, pollQuarkLogin, disconnectQuark, listQuarkShare, playQuarkFile, previewQuarkFile, quarkMedia, issueQuarkMedia } from './quark-server';
import { GET, POST } from '@/app/api/netdisk/route';
import { SESSION_COOKIE, signSession } from './auth';
vi.mock('./netdisk-storage', async (importOriginal) => ({ ...await importOriginal<typeof import('./netdisk-storage')>(), ensureDiskSpace: vi.fn(async () => ({ deleted: 0, quota: { total: 1e12, used: 0, free: 1e12 } })) }));
vi.mock('./ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));
let directory: string;
const req = () => new Request('https://cinema.test/api/netdisk', { headers: { cookie: 'ltv_session=browser1' } });
const json = (data: unknown, cookie?: string) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
const ok = (data: unknown) => json({ code: 0, status: 200, data });
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'jjbi-pan-')); vi.stubEnv('LIBRARY_DATA_DIR', directory); vi.stubEnv('CLOUD_ENCRYPTION_KEY', 'ab'.repeat(32)); vi.stubEnv('PASSWORD', 'test-password'); vi.stubEnv('SITE_ORIGIN', 'https://cinema.test');
});
afterEach(() => { disconnectQuark(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
const connect = () => quarkVault().write({ id: 'account-1', cookie: '__pus=private-one; __puus=private-two', name: 'QA account', saved: {}, tasks: {} });

describe('netdisk input and source parsing', () => {
  it('accepts public Quark links and extraction codes, rejects unrelated URLs', () => {
    expect(parseQuarkShare('我分享了 https://pan.quark.cn/s/abc123456789 提取码：a123')).toMatchObject({ id: 'abc123456789', passcode: 'a123' });
    expect(parseQuarkShare('https://pan.quark.cn/s/abc123456789?pwd=z123')).toMatchObject({ passcode: 'z123' });
    expect(() => parseQuarkShare('http://127.0.0.1/private')).toThrow();
    expect(() => parseQuarkShare('https://pan.quark.cn.attacker.com/s/abc123456789')).toThrow();
    expect(() => parseQuarkShare('https://pan.quark.cn/s/abc123456789', '\r\nevil')).toThrow();
  });
  it('deduplicates escaped links and extracts only matching ordinary movie titles', () => {
    expect(extractQuarkLinks('https:\\/\\/pan.quark.cn\\/s\\/abc123456789 https://pan.quark.cn/s/abc123456789')).toHaveLength(1);
    expect(extractQuarkLinks('<a href="https://pan.quark.cn/s/abc123456789?pwd=abcd">https://pan.quark.cn/s/abc123456789</a>')[0].passcode).toBe('abcd');
    expect(isRelevantPanTitle('流浪地球2 2160P', '流浪地球')).toBe(true);
    expect(isRelevantPanTitle('环太平洋', '流浪地球')).toBe(false);
    expect(isRelevantPanTitle('色情合集', '合集')).toBe(false);
    expect(parseSearchCards('<h3><a href="/index.php/vod/detail/id/42.html">测试电影</a></h3>', 'muou')).toEqual([{ id: '42', title: '测试电影' }]);
  });
  it('merges rotated cookies without retaining Set-Cookie attributes', () => {
    expect(mergeCookies('__pus=old; other=stable', ['__pus=new; Path=/; HttpOnly'])).toBe('__pus=new; other=stable');
  });
});
describe('Quark account, share and streaming', () => {
  it('refreshes an anonymous file token for the current account and retries one explicit 41020 rejection', async () => {
    let listings = 0; let saves = 0; const submitted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('sharepage/token')) return ok({ stoken: 'session-' + listings });
      if (input.includes('sharepage/detail')) {
        listings++; expect(new URL(input).searchParams.get('_page')).toBe('2');
        return ok({ list: [{ fid: 'v1', file_name: 'video.mp4', file_type: 1, share_fid_token: listings === 1 ? 'anonymous-token' : 'fresh-' + listings }] });
      }
      if (input.includes('file/sort')) return ok({ list: [{ fid: 'folder1', file_name: 'JjBiTV 追剧', file_type: 0 }] });
      if (input.includes('sharepage/save')) { const body = JSON.parse(String(init?.body)); submitted.push(body.fid_token_list[0]); saves++; return saves === 1 ? json({ code: 41020, message: 'file token expired' }) : ok({ task_id: 'task1' }); }
      if (input.includes('/task?')) return ok({ save_as: { save_as_top_fids: ['saved1'] } });
      if (input.includes('file/v2/play')) return ok({ video_list: [] });
      if (input.includes('file/download')) return ok([{ download_url: 'https://cdn.quark.cn/video.mp4' }]);
      throw new Error('unexpected endpoint');
    }));
    const listing = await listQuarkShare(req(), 'https://pan.quark.cn/s/abc123456789', '', '', 2);
    connect(); const result = await playQuarkFile(req(), listing.items[0].key);
    expect(result.saved).toBe(true); expect(submitted).toEqual(['fresh-2', 'fresh-3']); expect(saves).toBe(2);
    expect(quarkVault().read()?.tasks).toEqual({});
  });
  it('bounds token retries and does not leave a definitely rejected save marked uncertain', async () => {
    connect(); let writes = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('sharepage/token')) return ok({ stoken: 'token' });
      if (input.includes('sharepage/detail')) return ok({ list: [{ fid: 'v1', file_name: 'v.mp4', file_type: 1, share_fid_token: 'fresh' }] });
      if (input.includes('file/sort')) return ok({ list: [{ fid: 'folder1', file_name: 'JjBiTV 追剧', file_type: 0 }] });
      if (input.includes('sharepage/save')) { writes++; return json({ code: 41020 }); }
      throw new Error('unexpected endpoint');
    }));
    const listing = await listQuarkShare(req(), 'https://pan.quark.cn/s/abc123456789');
    await expect(playQuarkFile(req(), listing.items[0].key)).rejects.toMatchObject({ code: 'SHARE_TOKEN_EXPIRED', status: 409 });
    expect(writes).toBe(2); expect(quarkVault().read()?.tasks).toEqual({});
  });
  it('labels preview duration from the actual HLS, never saves or promises the full API duration', async () => {
    connect(); const routes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      routes.push(input);
      if (input.includes('sharepage/token')) return ok({ stoken: 'token' });
      if (input.includes('sharepage/detail')) return ok({ list: [{ fid: 'v1', file_name: 'v.mp4', file_type: 1, share_fid_token: 'fresh' }] });
      if (input.includes('video_preview')) { expect(new URL(input).searchParams.get('fid_token')).toBe('fresh'); return ok({ duration: 2554, accessable: true, play_info: { duration: 2554, url: 'https://cdn.quark.cn/preview.m3u8', format: 'm3u8', width: 1440, height: 810 } }); }
      if (input.includes('preview.m3u8')) return new Response('#EXTM3U\n#EXTINF:60,\na.ts\n#EXTINF:61,\nb.ts\n#EXT-X-ENDLIST', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
      throw new Error('unexpected endpoint');
    }));
    const listing = await listQuarkShare(req(), 'https://pan.quark.cn/s/abc123456789');
    const before = readFileSync(join(directory, 'quark-credentials.enc'), 'utf8');
    const result = await previewQuarkFile(req(), listing.items[0].key);
    expect(result).toMatchObject({ saved: false, limited: true, duration: 121, sourceDuration: 2554 });
    expect(result.qualities[0].label).toContain('试看'); expect(routes.some((u) => /sharepage\/save|file\/download|file\/sort/.test(u))).toBe(false);
    expect(readFileSync(join(directory, 'quark-credentials.enc'), 'utf8')).toBe(before);
  });
  it('does not transfer automatically when the preview is unavailable', async () => {
    connect(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls++;
      if (input.includes('sharepage/token')) return ok({ stoken: 'token' });
      if (input.includes('sharepage/detail')) return ok({ list: [{ fid: 'v1', file_name: 'v.mp4', file_type: 1, share_fid_token: 'fresh' }] });
      if (input.includes('video_preview')) return ok({ accessable: false, play_info: { url: 'https://cdn.quark.cn/no.mp4' } });
      throw new Error('unexpected write');
    }));
    const listing = await listQuarkShare(req(), 'https://pan.quark.cn/s/abc123456789');
    await expect(previewQuarkFile(req(), listing.items[0].key)).rejects.toMatchObject({ code: 'PREVIEW_UNAVAILABLE' });
    expect(calls).toBe(5); expect(quarkVault().read()?.saved).toEqual({});
  });
  it('keeps QR login bound to its initiating browser and stores encrypted cookies', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => input.includes('getTokenFor') ? json({ status: 2000000, data: { members: { token: 'qr-token' } } })
      : input.includes('getServiceTicket') ? json({ status: 2000000, data: { members: { service_ticket: 'private-ticket' } } })
      : input.includes('/account/info') ? json({ data: { nickname: 'Test person' } }, '__pus=private-pus; Domain=.quark.cn; Path=/')
      : json({ data: {} }, '__puus=private-puus; Domain=.quark.cn; Path=/')));
    const login = await startQuarkLogin(req()); expect(login.qr).toMatch(/^data:image\/png;base64,/);
    const other = new Request(req().url, { headers: { cookie: 'ltv_session=browser2' } });
    expect(await pollQuarkLogin(other, login.id)).toEqual({ connected: false, expired: true });
    expect(await pollQuarkLogin(req(), login.id)).toEqual({ connected: true });
    expect(quarkStatus()).toMatchObject({ connected: true, name: 'Test person' });
    expect(JSON.stringify(quarkStatus())).not.toContain('private-pus');
    expect(readFileSync(join(directory, 'quark-credentials.enc'), 'utf8')).not.toContain('private-pus');
    expect(quarkVault().read()?.cookie).toContain('__puus=private-puus');
  });
  it('disconnect cancels in-flight login and cannot reconnect after a late response', async () => {
    let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('getTokenFor')) return json({ status: 2000000, data: { members: { token: 'qr-token' } } });
      if (input.includes('getServiceTicket')) { await pending; return json({ status: 2000000, data: { members: { service_ticket: 'private-ticket' } } }); }
      return json({ data: { nickname: 'Test' } }, '__pus=x; Path=/');
    }));
    const login = await startQuarkLogin(req()); const result = pollQuarkLogin(req(), login.id); disconnectQuark(); release();
    await expect(result).rejects.toThrow(); expect(quarkStatus().connected).toBe(false);
  });
  it('rejects expired shares without pretending that a catalogue entry is playable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 41031, message: '分享者用户封禁链接查看受限' }), { status: 403 })));
    await expect(listQuarkShare(req(), 'https://pan.quark.cn/s/abc123456789')).rejects.toThrow('分享已失效');
  });
  it('lists only videos/folders; concurrent play actions reuse one transfer and persist its result', async () => {
    connect(); let saves = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('sharepage/token')) return ok({ stoken: 'share-secret' });
      if (input.includes('sharepage/detail')) return json({ code: 0, data: { list: [
        { fid: 'video1', file_type: 1, file_name: '01.mp4', share_fid_token: 'file-secret', size: 1048576 },
        { fid: 'folder1', file_type: 0, file_name: '第二季' }, { fid: 'doc1', file_type: 1, file_name: '推广.txt' },
      ] }, metadata: { _total: 300 } });
      if (input.includes('file/sort')) return ok({ list: [{ fid: 'app-folder', file_name: 'JjBiTV 追剧', file_type: 0 }] });
      if (input.includes('sharepage/save')) { saves++; await new Promise((r) => setTimeout(r, 5)); return ok({ task_id: 'task1' }); }
      if (input.includes('/task?')) return ok({ save_as: { save_as_top_fids: ['saved-video'] } });
      if (input.includes('file/v2/play')) return ok({ video_list: [] });
      if (input.includes('file/download')) return ok([{ download_url: 'https://cdn.quark.cn/video.mp4?signature=private' }]);
      throw new Error('unexpected route');
    }));
    const listing = await listQuarkShare(req(), 'https://pan.quark.cn/s/abc123456789');
    expect(listing.items).toHaveLength(2); expect(listing.hasMore).toBe(true); expect(listing.total).toBe(300);
    expect(JSON.stringify(listing)).not.toContain('file-secret');
    const outcomes = await Promise.all([playQuarkFile(req(), listing.items[0].key), playQuarkFile(req(), listing.items[0].key), playQuarkFile(req(), listing.items[0].key)]);
    expect(saves).toBe(1); expect(quarkVault().read()?.saved['abc123456789:video1']).toBe('saved-video');
    expect(outcomes.every((o) => o.qualities[0].url.startsWith('/api/netdisk/media?id='))).toBe(true);
    expect(JSON.stringify(outcomes)).not.toContain('signature');
  });
  it('media supports byte ranges, does not leak cookies on cross-host redirects, and revokes tickets', async () => {
    connect(); const url = issueQuarkMedia('https://cdn.quark.cn/video.mp4', 'account-1', 'video');
    const calls: { url: string; headers: Headers }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
      calls.push({ url: input, headers: new Headers(init.headers) });
      if (input.includes('cdn.quark.cn')) return new Response(null, { status: 302, headers: { Location: 'https://media-bucket.aliyuncs.com/video.mp4' } });
      return new Response(new Uint8Array([0, 1]), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-1/100' } });
    }));
    const id = new URL(url, req().url).searchParams.get('id')!;
    const response = await quarkMedia(new Request(req().url, { headers: { Range: 'bytes=0-1' } }), id);
    expect(response.status).toBe(206); expect(response.headers.get('content-range')).toBe('bytes 0-1/100');
    expect(calls[0].headers.get('cookie')).toContain('private-one'); expect(calls[1].headers.has('cookie')).toBe(false);
    disconnectQuark(); await expect(quarkMedia(req(), id)).rejects.toThrow('扫码');
    expect(() => issueQuarkMedia('https://attacker.example/video.mp4', 'account-1', 'video')).toThrow();
  });
  it('requires site login, same origin and explicit cloud-save consent', async () => {
    expect((await GET(new Request(req().url))).status).toBe(401);
    const { token } = signSession(); const headers = { cookie: `${SESSION_COOKIE}=${token}`, 'Content-Type': 'application/json', Origin: 'https://evil.test' };
    expect((await POST(new Request(req().url, { method: 'POST', headers, body: JSON.stringify({ action: 'login' }) }))).status).toBe(403);
    headers.Origin = 'https://cinema.test';
    expect((await POST(new Request(req().url, { method: 'POST', headers, body: JSON.stringify({ action: 'play', key: 'any' }) }))).status).toBe(409);
  });
  it('does not repeat an unconfirmed cloud write after a lost save response', async () => {
    connect(); let writes = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('sharepage/token')) return ok({ stoken: 'token' });
      if (input.includes('sharepage/detail')) return ok({ list: [{ fid: 'video1', file_type: 1, file_name: 'movie.mp4', share_fid_token: 'fid-token' }] });
      if (input.includes('file/sort')) return ok({ list: [{ fid: 'folder1', file_name: 'JjBiTV 追剧', file_type: 0 }] });
      if (input.includes('sharepage/save')) { writes++; throw new Error('connection reset after save'); }
      throw new Error('unexpected request');
    }));
    const listing = await listQuarkShare(req(), 'https://pan.quark.cn/s/abc123456789');
    await expect(playQuarkFile(req(), listing.items[0].key)).rejects.toThrow();
    await expect(playQuarkFile(req(), listing.items[0].key)).rejects.toThrow('转存结果暂未确认');
    expect(writes).toBe(1);
  });
  it('rewrites HLS segments and key URIs through authenticated opaque tickets', async () => {
    connect(); const url = issueQuarkMedia('https://cdn.quark.cn/video/master.m3u8?private=1', 'account-1', 'hls');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:5,\nsegment.ts\n#EXT-X-ENDLIST', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } })));
    const response = await quarkMedia(req(), new URL(url, req().url).searchParams.get('id')!); const body = await response.text();
    expect(body).not.toContain('cdn.quark.cn'); expect(body).not.toContain('private=1');
    expect(body.match(/\/api\/netdisk\/media\?id=/g)).toHaveLength(2); expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
