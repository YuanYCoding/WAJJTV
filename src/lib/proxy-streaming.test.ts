import { afterEach, expect, it, vi } from 'vitest';
import { handleProxyRequest } from './proxy-handlers';
vi.mock('./api-guard', () => ({ guardRequest: () => null }));
vi.mock('./ssrf', () => ({ isValidProxyUrl: () => true, isBlockedByDNS: async () => false, checkUpstreamAllowed: async () => ({ ok: true }) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('does not abort a large media body at the old whole-request timeout after headers have arrived', async () => {
  vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Response(new ReadableStream({ start(controller) { const timer = setTimeout(() => { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); }, 9500); init?.signal?.addEventListener('abort', () => { clearTimeout(timer); controller.error(new Error('Whole body was aborted')); }); } }), { headers: { 'Content-Type': 'video/mp2t' } })));
  const response = await handleProxyRequest(new Request('https://cinema.test/api/proxy'), 'https://cdn.test/large.ts'); const body = response.arrayBuffer(); await vi.advanceTimersByTimeAsync(10000); expect(new Uint8Array(await body)).toEqual(new Uint8Array([1, 2, 3]));
});
