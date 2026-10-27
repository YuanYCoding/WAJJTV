import { panGet, panWorkers } from './pan-public-fetch';
import { isRelevantPanTitle, plainText } from './netdisk-utils';
export interface CatalogLink { url: string; name: string }
export interface CatalogMovie { id: string; title: string; links: CatalogLink[] }
const cache = new Map<string, { expires: number; movies: CatalogMovie[] }>();
export function validMagnet(raw: string) {
  try { if (raw.length > 6000) return ''; const u = new URL(raw); return u.protocol === 'magnet:' && u.searchParams.getAll('xt').some((v) => /^urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(v) || /^urn:btmh:1220[a-f\d]{64}$/i.test(v)) ? u.href : ''; } catch { return ''; }
}
/** Only public catalog metadata is requested; no cloud account credentials are sent. */
export async function aipanCatalog(keyword: string, page: number, signal: AbortSignal, origin = 'https://www.aipan.me'): Promise<CatalogMovie[]> {
  const cacheKey = origin + ':' + keyword; const prior = cache.get(cacheKey); if (prior && prior.expires > Date.now()) return prior.movies.slice((page - 1) * 12, page * 12);
  const data = JSON.parse(await panGet(origin + '/api/movies/search?q=' + encodeURIComponent(keyword), signal));
  if (!Array.isArray(data.movies)) throw new Error('爱盼目录响应异常');
  const rows = data.movies.filter((v: Record<string, unknown>) => typeof v.id === 'string' && /^[\w-]{1,80}$/.test(v.id) && isRelevantPanTitle(plainText(v.title), keyword)).slice(0, 36) as Record<string, unknown>[];
  const movies: CatalogMovie[] = [];
  await panWorkers(rows, 3, signal, async (row) => {
    try { const detail = JSON.parse(await panGet(origin + '/api/movies/detail/' + row.id, signal)); const links = [...(Array.isArray(detail.panLinks) ? detail.panLinks : []), ...(Array.isArray(detail.resources) ? detail.resources : [])].flatMap((v: Record<string, unknown>) => typeof v.url === 'string' ? [{ url: v.url, name: plainText(v.name || v.title || v.sizeLabel, 180) }] : []); movies.push({ id: String(row.id), title: plainText(row.title), links }); }
    catch { /* A failed detail does not hide the other returned movies. */ }
  });
  if (cache.size > 80) cache.delete(cache.keys().next().value!); if (!signal.aborted) cache.set(cacheKey, { expires: Date.now() + 5 * 60_000, movies });
  return movies.slice((page - 1) * 12, page * 12);
}
