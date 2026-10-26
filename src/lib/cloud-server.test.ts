import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudVault, cloudVault } from './cloud-vault';
import { beginCloudLogin, finishCloudLogin, cloudStatus, cloudFiles, cloudPlayback, disconnectCloud, cloudMedia } from './cloud-server';
import { GET, POST } from '@/app/api/cloud/route';

let dir: string;
const owner = new Request('https://cinema.test/api/cloud', { headers: { cookie: 'session=owner' } });
const reply = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wajjtv-cloud-'));
  vi.stubEnv('LIBRARY_DATA_DIR', dir); vi.stubEnv('CLOUD_ENCRYPTION_KEY', 'ab'.repeat(32));
  vi.stubEnv('PASSWORD', 'test-cinema'); vi.stubEnv('SITE_ORIGIN', 'https://cinema.test');
});
afterEach(() => { disconnectCloud(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
const credentials = () => ({ id: 'account-1', accessToken: 'private-access-secret', refreshToken: 'private-refresh-secret', expiresAt: Date.now() + 3600_000, name: 'Test account', drives: [{ id: 'drive-1', name: '资源库' }] });

describe('cloud account and playback boundary', () => {
  it('encrypted storage survives reopen; tampering and wrong encryption key fail closed', () => {
    const vault = cloudVault(); const saved = credentials(); vault.write(saved);
    expect(readFileSync(join(dir, 'cloud-credentials.enc'), 'utf8')).not.toContain('private-access-secret');
    expect(new CloudVault(dir, 'ab'.repeat(32)).read()).toEqual(saved);
    expect(() => new CloudVault(dir, 'cd'.repeat(32)).read()).toThrow();
    expect(cloudStatus()).not.toHaveProperty('accessToken');
    vault.clear(); expect(vault.write(credentials(), 'account-1')).toBe(false);
  });
  it('QR completion belongs to the initiating browser; no secret is returned to it', async () => {
    const upstream = vi.fn(async (url: string) => url.includes('/requests') ? reply({ sid: 'sid-1', text: 'https://openapi.alipan.com/oauth/qrcode/qr-1' })
      : url.includes('/callback') ? reply({ access_token: 'private-access-secret', refresh_token: 'private-refresh-secret' })
      : reply({ resource_drive_id: 'drive-1', name: 'Test account' }));
    vi.stubGlobal('fetch', upstream);
    const qr = await beginCloudLogin(owner);
    await expect(finishCloudLogin(new Request(owner.url, { headers: { cookie: 'session=other' } }), qr.id)).rejects.toThrow('失效');
    const result = await finishCloudLogin(owner, qr.id);
    expect(result.connected).toBe(true); expect(JSON.stringify(result)).not.toContain('secret');
    expect(upstream.mock.calls.every(([url]) => url.startsWith('https://api.oplist.org/') || url.startsWith('https://openapi.alipan.com/'))).toBe(true);
  });
  it('disconnect cancels pending authorization so a late response cannot reconnect', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ sid: 'sid-2', text: 'https://openapi.alipan.com/oauth/qrcode/qr-2' })));
    const qr = await beginCloudLogin(owner); disconnectCloud();
    await expect(finishCloudLogin(owner, qr.id)).rejects.toThrow('失效');
  });
  it('lists only video and folders; no unknown drive or invalid file IDs', async () => {
    cloudVault().write(credentials());
    const upstream = vi.fn(async () => reply({ items: [{ file_id: 'folder', name: '电影', type: 'folder' }, { file_id: 'v', name: 'test.mp4', category: 'video' }, { file_id: 'private-document', name: 'document.pdf', category: 'doc' }], next_marker: 'next' }));
    vi.stubGlobal('fetch', upstream);
    const list = await cloudFiles('drive-1', 'root', '');
    expect(list.items.map((i) => i.id)).toEqual(['folder', 'v']); expect(list.marker).toBe('next');
    await expect(cloudFiles('other-drive', 'root', '')).rejects.toThrow('不存在');
    await expect(cloudPlayback('drive-1', '../private')).rejects.toThrow('无效');
    expect(upstream).toHaveBeenCalledOnce();
  });
  it('exposes only finished qualities and opaque media URLs; revoked tickets fail', async () => {
    cloudVault().write(credentials());
    vi.stubGlobal('fetch', vi.fn(async () => reply({ video_preview_play_info: { live_transcoding_task_list: [
      { status: 'finished', url: 'https://cdn.example.com/movie.m3u8?secret=signed', template_id: 'HD', template_height: 720 },
      { status: 'running', url: 'https://cdn.example.com/4k.m3u8', template_id: 'QHD', template_height: 2160 },
    ] } })));
    const play = await cloudPlayback('drive-1', 'file-1');
    expect(play.qualities).toHaveLength(1); expect(play.qualities[0].height).toBe(720);
    expect(JSON.stringify(play)).not.toContain('secret');
    const id = new URL(play.qualities[0].url, owner.url).searchParams.get('id')!;
    disconnectCloud(); await expect(cloudMedia(id, owner)).rejects.toThrow('过期');
  });
  it('removed cloud endpoints return gone and cannot reach the provider', async () => {
    const spy = vi.fn(); vi.stubGlobal('fetch', spy);
    expect((await GET()).status).toBe(410);
    expect((await POST()).status).toBe(410); expect(spy).not.toHaveBeenCalled();
  });
});
