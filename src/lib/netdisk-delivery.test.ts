import { afterEach, describe, expect, it, vi } from 'vitest';
import { canDeliverDirect, directMediaResponse } from './netdisk-delivery';
vi.mock('./ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('authenticated media redirect eligibility', () => {
  it('only enables direct delivery after a successful no-credential CORS probe', async () => {
    vi.stubEnv('PAN_DIRECT_MEDIA', '1'); vi.stubEnv('SITE_ORIGIN', 'https://cinema-a.test');
    const fetch = vi.fn(async (_url: string, init: RequestInit) => { const h = new Headers(init.headers); expect(h.has('Cookie')).toBe(false); expect(h.has('Authorization')).toBe(false); expect(h.has('Referer')).toBe(false); expect(h.get('Origin')).toBe('https://cinema-a.test'); return new Response(new Uint8Array([1]), { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'video/mp2t' } }); });
    vi.stubGlobal('fetch', fetch); expect(await canDeliverDirect('https://media.aliyundrive.net/a.ts')).toBe(true); expect(await canDeliverDirect('https://media.aliyundrive.net/b.ts')).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
    const redirect = directMediaResponse('https://media.aliyundrive.net/a.ts'); expect(redirect.status).toBe(307); expect(redirect.headers.get('Referrer-Policy')).toBe('no-referrer'); expect(redirect.headers.get('Cache-Control')).toContain('no-store');
  });
  it('keeps refused, non-CORS or error-document responses on the server proxy', async () => {
    vi.stubEnv('PAN_DIRECT_MEDIA', '1'); vi.stubEnv('SITE_ORIGIN', 'https://cinema-b.test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<error/>', { status: 403, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/xml' } }))); expect(await canDeliverDirect('https://refused.quark.cn/v.ts')).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('video', { headers: { 'Access-Control-Allow-Origin': 'https://another.test', 'Content-Type': 'video/mp4' } }))); expect(await canDeliverDirect('https://restricted.quark.cn/v.ts')).toBe(false);
  });
  it('does not contact the CDN when direct delivery is disabled', async () => { vi.stubEnv('PAN_DIRECT_MEDIA', '0'); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); expect(await canDeliverDirect('https://media.aliyundrive.net/x.ts')).toBe(false); expect(fetch).not.toHaveBeenCalled(); });
});
