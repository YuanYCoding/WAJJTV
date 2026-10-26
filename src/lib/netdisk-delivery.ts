import { checkUpstreamAllowed } from './ssrf';
const cache = new Map<string, { expires: number; promise: Promise<boolean> }>();
export const directDeliveryEnabled = () => process.env.PAN_DIRECT_MEDIA === '1';
/** Prove public, signed CDN media supports this site's origin without any account credentials. */
export async function canDeliverDirect(url: string): Promise<boolean> {
  if (!directDeliveryEnabled()) return false;
  const u = new URL(url); if (u.protocol !== 'https:' || u.username || u.password) return false;
  const origin = process.env.SITE_ORIGIN || ''; if (!/^https?:\/\//.test(origin)) return false;
  const key = origin + ':' + u.hostname; const prior = cache.get(key); if (prior && prior.expires > Date.now()) return prior.promise;
  const promise = (async () => {
    try {
      if (!(await checkUpstreamAllowed(url)).ok) return false;
      const r = await fetch(url, { headers: { Origin: origin, Range: 'bytes=0-1' }, redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(2500), cache: 'no-store' });
      const cors = r.headers.get('access-control-allow-origin'), type = r.headers.get('content-type') || '';
      const ok = r.ok && (cors === '*' || cors === origin) && !/xml|html|json/i.test(type); await r.body?.cancel(); return ok;
    } catch { return false; }
  })();
  if (cache.size > 100) cache.delete(cache.keys().next().value!); cache.set(key, { expires: Date.now() + 120_000, promise }); return promise;
}
export function directMediaResponse(url: string) { return new Response(null, { status: 307, headers: { Location: url, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } }); }
export function preferDirectMedia(url: string) { return directDeliveryEnabled() ? url + '&direct=1' : url; }
