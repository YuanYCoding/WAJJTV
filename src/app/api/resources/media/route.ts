import { guardRequest } from '@/lib/api-guard';
import { fetchWithSafeRedirects } from '@/lib/fetch-utils';
import { canDeliverDirect, directMediaResponse } from '@/lib/netdisk-delivery';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const auth = guardRequest(req); if (auth) return auth;
  try {
    const params = new URL(req.url).searchParams, url = params.get('url') || ''; if (url.length > 4000) return new Response('地址过长', { status: 400 });
    const target = new URL(url); if (!/^https?:$/.test(target.protocol) || target.username || target.password) return new Response('地址无效', { status: 400 });
    if (params.get('asset') === '1' && params.get('direct') === '1' && await canDeliverDirect(url)) return directMediaResponse(url);
    const range = req.headers.get('range'), headers: Record<string, string> = { Accept: '*/*', 'User-Agent': 'Mozilla/5.0' }; if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
    const { res, finalUrl } = await fetchWithSafeRedirects(url, { headers, signal: req.signal, cache: 'no-store' }, { headerTimeoutMs: 12_000 });
    if (!res.ok && res.status !== 416) { await res.body?.cancel(); return new Response('上游播放线路暂不可用', { status: res.status >= 400 ? res.status : 502 }); }
    const type = res.headers.get('content-type') || '', playlist = /mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(finalUrl);
    if (playlist && res.body) {
      const reader = res.body.getReader(), parts: Uint8Array[] = []; let size = 0;
      try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > 2_000_000) throw new Error('播放清单过大'); parts.push(r.value); } } finally { void reader.cancel().catch(() => {}); }
      const text = Buffer.concat(parts).toString('utf8').trimStart(); if (!text.startsWith('#EXTM3U')) throw new Error('无效的播放清单');
      const master = text.includes('#EXT-X-STREAM-INF:');
      const rewrite = (v: string, asset = false) => '/api/resources/media?direct=1' + (asset ? '&asset=1' : '') + '&url=' + encodeURIComponent(new URL(v, finalUrl).href);
      const body = text.split('\n').map((line) => !line.trim() ? line : line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${rewrite(uri, /^#EXT-X-(?:KEY|MAP):/.test(line))}"`) : rewrite(line.trim(), !master)).join('\n');
      return new Response(body, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, no-store' } });
    }
    if (params.get('asset') !== '1' && params.get('direct') === '1' && await canDeliverDirect(finalUrl)) { await res.body?.cancel(); return directMediaResponse(finalUrl); }
    const out = new Headers({ 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' }); for (const key of ['content-length', 'content-range', 'accept-ranges']) { const value = res.headers.get(key); if (value) out.set(key, value); }
    return new Response(res.body, { status: res.status, headers: out });
  } catch { return new Response('这条播放线路暂不可用，请切换来源或稍后重试', { status: 502 }); }
}
