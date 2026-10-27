import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST, GET } from '@/app/api/netdisk/external/route';
import { CloudVault } from './cloud-vault';
import { signSession, SESSION_COOKIE } from './auth';
import { startPlaybackLease } from './netdisk-storage';
import { aliMedia } from './alipan-server';
vi.mock('./alipan-server', () => ({ aliMedia: vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 206 })), playAliFile: vi.fn(), extendAliMedia: vi.fn() }));
vi.mock('./quark-server', () => ({ quarkMedia: vi.fn(), playQuarkFile: vi.fn(), extendQuarkMedia: vi.fn() }));
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jjbi-external-')); vi.stubEnv('LIBRARY_DATA_DIR', dir); vi.stubEnv('CLOUD_ENCRYPTION_KEY', 'ab'.repeat(32)); vi.stubEnv('PASSWORD', 'test-password'); vi.stubEnv('SITE_ORIGIN', 'https://cinema.test'); new CloudVault<{ id: string }>(dir, 'ab'.repeat(32), 'alipan-credentials.enc').write({ id: 'test-account' }); });
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
it('mints a scoped link under the public origin that an external player can use without site cookies', async () => {
  const headers = { Cookie: `${SESSION_COOKIE}=${signSession().token}`, Origin: 'https://cinema.test', 'Content-Type': 'application/json' };
  const req = new Request('https://cinema.test/api/netdisk/external', { headers }); const lease = startPlaybackLease(req, 'aliyun', 'test-account', 'file');
  const r = await POST(new Request(req.url, { method: 'POST', headers, body: JSON.stringify({ provider: 'aliyun', url: '/api/alipan/media?id=01234567890123456789', lease }) }));
  expect(r.status).toBe(200); const value = await r.json(); expect(value.url).toMatch(/^https:\/\/cinema.test\/api\/netdisk\/external\?t=/); expect(value.lease).not.toBe(lease);
  const video = await GET(new Request(value.url, { headers: { Range: 'bytes=0-1' } })); expect(video.status).toBe(206); expect(vi.mocked(aliMedia).mock.calls[0][0].headers.get('range')).toBe('bytes=0-1');
  expect((await GET(new Request(value.url + 'tampered'))).status).toBe(403);
});
it('rejects anonymous minting and cross-origin writes before making a link', async () => {
  expect((await POST(new Request('https://cinema.test/api/netdisk/external', { method: 'POST', body: '{}' }))).status).toBe(401);
  const headers = { Cookie: `${SESSION_COOKIE}=${signSession().token}`, Origin: 'https://evil.test', 'Content-Type': 'application/json' };
  expect((await POST(new Request('https://cinema.test/api/netdisk/external', { method: 'POST', headers, body: '{}' }))).status).toBe(403);
});
