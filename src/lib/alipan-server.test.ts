import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { aliVault, aliStatus, startAliLogin, pollAliLogin, disconnectAli, listAliFiles, playAliFile, aliMedia, issueAliMedia } from './alipan-server';
import { parsePanShare, isRelevantPanTitle } from './netdisk-utils';
import { extractPanLinks } from './netdisk-search';
import { parseYunsoCards } from './netdisk-search-extra';
import { GET, POST } from '@/app/api/alipan/route';
import { SESSION_COOKIE, signSession } from './auth';
vi.mock('./ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));
let directory: string;
const req = () => new Request('https://cinema.test/api/alipan', { headers: { cookie: 'ltv_session=browser1' } });
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'Content-Type': 'application/json' } });
const connect = (expires = Date.now() + 3600_000) => aliVault().write({ id: 'ali-one', accessToken: 'secret-access', refreshToken: 'secret-refresh', expires, name: 'Test', userId: 'user1', drive: 'drive1', saved: {}, tasks: {} });
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'jjbi-ali-')); vi.stubEnv('LIBRARY_DATA_DIR', directory); vi.stubEnv('CLOUD_ENCRYPTION_KEY', 'ab'.repeat(32)); vi.stubEnv('PASSWORD', 'test-password'); vi.stubEnv('SITE_ORIGIN', 'https://cinema.test'); });
afterEach(() => { disconnectAli(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
describe('multi-drive discovery', () => {
  it('canonicalizes Aliyun domains and preserves passcodes without following arbitrary links', () => {
    expect(parsePanShare('分享 https://www.aliyundrive.com/s/abc12345678 提取码：ab12')).toMatchObject({ provider: 'aliyun', url: 'https://www.alipan.com/s/abc12345678', passcode: 'ab12' });
    expect(parsePanShare('https://pan.quark.cn/s/abc123456789')).toMatchObject({ provider: 'quark' });
    expect(() => parsePanShare('https://alipan.com.evil.test/s/abc12345678')).toThrow();
    expect(extractPanLinks('https://www.alipan.com/s/abc12345678 https://www.aliyundrive.com/s/abc12345678')).toHaveLength(1);
  });
  it('parses titles independently from provider badges and retains explicitly matching sequel collections', () => {
    expect(parseYunsoCards('<a url="https://www.aliyundrive.com/s/abc12345678?" pa="abcd">战狼 <em>1-2</em></a>')[0]).toEqual({ title: '战狼 1-2', content: 'https://www.aliyundrive.com/s/abc12345678? 提取码：abcd' });
    expect(isRelevantPanTitle('【吴京电影】战狼 1-2', '战狼2')).toBe(true);
    expect(isRelevantPanTitle('战狼1 2015', '战狼2')).toBe(false);
    expect(isRelevantPanTitle('战狼.2015.BD1080P.mp4', '战狼2')).toBe(false);
    expect(isRelevantPanTitle('战狼2.2017.BD1080P.mp4', '战狼2')).toBe(true);
    expect(isRelevantPanTitle('No.02战狼2 4K-56.89亿', '战狼2')).toBe(true);
    expect(isRelevantPanTitle('战狼 1-2', '战狼3')).toBe(false);
  });
});
describe('Aliyun official login and playback', () => {
  it('binds QR to the initiating session and stores tokens only in an encrypted separate vault', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('generate.do') ? json({ content: { data: { t: 123, ck: 'private-ck', codeContent: 'https://passport.aliyundrive.com/qr?code=test' } } })
      : url.includes('query.do') ? json({ content: { data: { qrCodeStatus: 'CONFIRMED', bizExt: Buffer.from(JSON.stringify({ pds_login_result: { refreshToken: 'private-refresh', userId: 'u1' } })).toString('base64') } } })
      : json({ access_token: 'private-access', refresh_token: 'private-refresh-new', default_drive_id: 'drive1', user_id: 'u1', nick_name: '测试用户', expires_in: 3600 })));
    const qr = await startAliLogin(req()); expect(qr.qr).toMatch(/^data:image\/png/);
    expect(await pollAliLogin(new Request(req().url, { headers: { cookie: 'ltv_session=other' } }), qr.id)).toEqual({ connected: false, expired: true });
    expect(await pollAliLogin(req(), qr.id)).toEqual({ connected: true });
    expect(aliStatus()).toMatchObject({ connected: true, name: '测试用户' });
    expect(JSON.stringify(aliStatus())).not.toContain('private-'); expect(readFileSync(join(directory, 'alipan-credentials.enc'), 'utf8')).not.toContain('private-');
  });
  it('disconnect invalidates a pending QR before a late authorization completes', async () => {
    let release!: () => void; const pause = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url.includes('generate.do')) return json({ content: { data: { t: 1, ck: 'ck', codeContent: 'https://passport.aliyundrive.com/qr' } } }); if (url.includes('query.do')) { await pause; return json({ content: { data: { qrCodeStatus: 'CONFIRMED', bizExt: Buffer.from(JSON.stringify({ pds_login_result: { refreshToken: 'r' } })).toString('base64') } } }); } return json({ access_token: 'a', refresh_token: 'r', default_drive_id: 'd' }); }));
    const qr = await startAliLogin(req()); const result = pollAliLogin(req(), qr.id); disconnectAli(); release(); await expect(result).rejects.toThrow('取消'); expect(aliStatus().connected).toBe(false);
  });
  it('browses public shares without account credentials and rejects another browser file reference', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { expect(new Headers(init.headers).has('Authorization')).toBe(false); return url.includes('get_share_token') ? json({ share_token: 'share-secret' }) : json({ items: [{ file_id: 'file1', name: '01.mkv', type: 'file', size: 1024 }, { file_id: 'f2', name: '第二季', type: 'folder' }, { file_id: 'junk', name: '推广.txt', type: 'file' }], next_marker: 'page2' }); }));
    const result = await listAliFiles(req(), 'https://www.alipan.com/s/abc12345678'); expect(result.items).toHaveLength(2); expect(result.marker).toBe('page2'); expect(JSON.stringify(result)).not.toContain('share-secret');
    await expect(listAliFiles(new Request(req().url, { headers: { cookie: 'ltv_session=other' } }), result.shareUrl, '', result.items[1].key)).rejects.toThrow('过期');
  });
  it('plays authorized share URLs without copying and exposes actual quality dimensions', async () => {
    connect(); const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { paths.push(url); if (url.includes('get_share_token')) return json({ share_token: 'share-secret' }); if (url.includes('/file/list')) return json({ items: [{ file_id: 'file1', name: '01.mkv', type: 'file', size: 1024, drive_id: 'source-drive' }] }); if (url.includes('video_preview')) return json({ video_preview_play_info: { live_transcoding_task_list: [{ status: 'finished', template_id: 'FHD', template_width: 1920, template_height: 1080, url: 'https://media.aliyundrive.net/a.m3u8' }] } }); if (url.includes('get_share_link_download')) return json({ download_url: 'https://media.aliyundrive.net/a.mkv' }); if (url.includes('a.m3u8')) return new Response('#EXTM3U\n#EXTINF:3600,\na.ts\n#EXT-X-ENDLIST', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }); throw new Error('Unexpected write'); }));
    const list = await listAliFiles(req(), 'https://www.alipan.com/s/abc12345678'); const value = await playAliFile(req(), list.items[0].key);
    expect(value.saved).toBe(false); expect(value.qualities.map((q) => q.label)).toEqual(['1080P · 转码', '原文件']); expect(paths.some((p) => p.includes('batch') || p.includes('createWithFolders'))).toBe(false);
  });
  it('serializes single-file transfers, persists mapping, and reuses it on repeated play', async () => {
    connect(); let copies = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('get_share_token')) return json({ share_token: 'share-secret' });
      if (url.includes('/adrive/v3/file/list')) return json({ items: [{ file_id: 'file1', name: '01.mp4', type: 'file' }] });
      if (url.includes('/v2/file/list')) return json({ items: [{ file_id: 'app-folder', name: 'JjBiTV 追剧', type: 'folder' }] });
      if (url.includes('/batch')) { const body = JSON.parse(String(init.body)); expect(body.requests).toHaveLength(1); expect(body.requests[0].body.file_id).toBe('file1'); copies++; return json({ responses: [{ status: 201, body: { file_id: 'saved-file' } }] }); }
      if (url.includes('video_preview')) return json({ video_preview_play_info: { live_transcoding_task_list: [] } });
      if (url.includes('get_download_url')) return json({ url: 'https://media.aliyundrive.net/movie.mp4' });
      throw new Error('Unexpected endpoint');
    }));
    const list = await listAliFiles(req(), 'https://www.alipan.com/s/abc12345678'); const values = await Promise.all([playAliFile(req(), list.items[0].key, true), playAliFile(req(), list.items[0].key, true)]);
    expect(copies).toBe(1); expect(values.every((v) => v.saved)).toBe(true); expect(aliVault().read()?.saved['abc12345678:file1']).toBe('saved-file'); expect(aliVault().read()?.tasks).toEqual({});
  });
  it('prefers a full 720P stream over a 1080P preview and measures each manifest independently', async () => {
    connect();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('get_share_token')) return json({ share_token: 's' });
      if (url.includes('/file/list')) return json({ items: [{ file_id: 'f', name: 'movie.mp4', type: 'file', drive_id: 'd' }] });
      if (url.includes('video_preview')) return json({ video_preview_play_info: { meta: { duration: 8000 }, live_transcoding_task_list: [{ status: 'finished', template_height: 1080, preview_url: 'https://media.aliyundrive.net/preview.m3u8' }, { status: 'finished', template_height: 720, url: 'https://media.aliyundrive.net/full.m3u8' }] } });
      if (url.includes('download')) return json({ code: 'Forbidden' }, 403);
      return new Response(`#EXTM3U\n#EXTINF:${url.includes('preview.m3u8') ? 120 : 8000},\na.ts\n#EXT-X-ENDLIST`, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
    }));
    const list = await listAliFiles(req(), 'https://www.alipan.com/s/abc12345678'); const value = await playAliFile(req(), list.items[0].key);
    expect(value.qualities[0]).toMatchObject({ height: 720, limited: false, duration: 8000 });
    expect(value.qualities[1]).toMatchObject({ height: 1080, limited: true, duration: 120 });
    expect(value.qualities[1].label).toContain('限时试看'); expect(value.limited).toBe(false);
  });
  it('does not repeat a transfer after an uncertain network failure', async () => {
    connect(); let copies = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url.includes('get_share_token')) return json({ share_token: 's' }); if (url.includes('/adrive/v3/file/list')) return json({ items: [{ file_id: 'v', name: 'v.mp4', type: 'file' }] }); if (url.includes('/v2/file/list')) return json({ items: [{ file_id: 'f', name: 'JjBiTV 追剧', type: 'folder' }] }); if (url.includes('/batch')) { copies++; throw new Error('reset'); } throw new Error('unexpected'); }));
    const list = await listAliFiles(req(), 'https://www.alipan.com/s/abc12345678'); await expect(playAliFile(req(), list.items[0].key, true)).rejects.toThrow(); await expect(playAliFile(req(), list.items[0].key, true)).rejects.toThrow('尚未确认'); expect(copies).toBe(1);
  });
  it('protects API login, same origin and explicit save consent', async () => {
    expect((await GET(new Request(req().url))).status).toBe(401); const { token } = signSession(); const headers = { cookie: `${SESSION_COOKIE}=${token}`, 'Content-Type': 'application/json', Origin: 'https://evil.test' };
    expect((await POST(new Request(req().url, { method: 'POST', headers, body: JSON.stringify({ action: 'login' }) }))).status).toBe(403); headers.Origin = 'https://cinema.test';
    expect((await POST(new Request(req().url, { method: 'POST', headers, body: JSON.stringify({ action: 'play', key: 'any' }) }))).status).toBe(409);
  });
  it('keeps media opaque, rewrites HLS, passes ranges and never sends account credentials to CDNs', async () => {
    connect(); const url = issueAliMedia('https://media.aliyundrive.net/a.m3u8', 'ali-one');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { const h = new Headers(init.headers); expect(h.has('Authorization')).toBe(false); expect(h.has('Cookie')).toBe(false); return new Response('#EXTM3U\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }); }));
    const response = await aliMedia(req(), new URL(url, req().url).searchParams.get('id')!); expect(await response.text()).toContain('/api/alipan/media?id=');
    expect(() => issueAliMedia('https://evil.test/movie.mp4', 'ali-one')).toThrow(); disconnectAli(); await expect(aliMedia(req(), new URL(url, req().url).searchParams.get('id')!)).rejects.toThrow();
  });
});
