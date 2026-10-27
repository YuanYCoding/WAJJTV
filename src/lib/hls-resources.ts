import { createHash } from 'node:crypto';
import { fetchUpstreamWithMeta } from './fetch-utils';
import { decryptAes128CbcPrefix, looksLikeMp4, parseMp4VideoResolution, parseTsVideoResolution, type MediaResolution } from './codec-parse';
import { isRelevantPanTitle, plainText } from './netdisk-utils';
import { resourceTier } from './hls-resource-types';
import { acquireHostSlot } from './host-gate';
export { resourceTier } from './hls-resource-types';
export const HLS_SOURCES = [
  { id: 'mangguo', name: '芒果 HLS', url: 'https://caiji.mgzyapi.com/api.php/provide/vod/' },
  { id: 'guangsu', name: '光速 HLS', url: 'https://api.guangsuapi.com/api.php/provide/vod/' },
  { id: 'baofeng', name: '暴风 HLS', url: 'https://bfzyapi.com/api.php/provide/vod/' },
  { id: 'haohua', name: '豪华 HLS', url: 'https://hhzyapi.com/api.php/provide/vod/' },
  { id: 'huya', name: '虎牙 HLS', url: 'https://www.huyaapi.com/api.php/provide/vod/' },
  { id: 'jinying', name: '金鹰 HLS', url: 'https://jyzyapi.com/provide/vod/' },
  { id: 'jisu', name: '极速 HLS', url: 'https://jszyapi.com/api.php/provide/vod/' },
  { id: 'hongniu', name: '红牛 HLS', url: 'https://www.hongniuzy2.com/api.php/provide/vod/' },
];
export interface HlsInspection { width?: number; height?: number; declaredWidth?: number; declaredHeight?: number; evidence: 'segment' | 'manifest' | 'unknown'; duration: number; complete: boolean; bandwidth?: number; }
export interface HlsResource extends HlsInspection { id: string; title: string; year: string; source: string; url: string; episodes: { name: string; url: string }[]; checkedAt: number; }
export type HlsSearchEvent = { type: 'result'; item: HlsResource } | { type: 'progress'; sources: number; total: number; checked: number; candidates: number } | { type: 'done'; sources: number; total: number; checked: number; candidates: number; count: number; errors: number };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
const cache = new Map<string, { expires: number; value: HlsResource[]; stats: Omit<Extract<HlsSearchEvent, { type: 'done' }>, 'type'> }>();
async function bounded(url: string, signal: AbortSignal, limit = 2_000_000, range = false) {
  const { res, finalUrl } = await fetchUpstreamWithMeta(url, { timeoutMs: 7000, signal, headers: { 'User-Agent': UA, Accept: '*/*', ...(range ? { Range: `bytes=0-${limit - 1}` } : {}) } });
  if (!res.ok || !res.body) { await res.body?.cancel(); throw new Error(`HTTP ${res.status}`); }
  const reader = res.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try { while (size < limit) { const r = await reader.read(); if (r.done) break; const piece = r.value.subarray(0, limit - size); parts.push(piece); size += piece.length; } } finally { void reader.cancel().catch(() => {}); }
  return { bytes: Buffer.concat(parts), url: finalUrl };
}
export function hlsEpisodes(raw: unknown) {
  const seen = new Set<string>();
  return String(raw || '').split('$$$').flatMap((g) => g.split('#')).flatMap((entry) => {
    const split = entry.indexOf('$'); if (split < 0) return []; const url = entry.slice(split + 1).trim();
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol) || u.username || u.password || !/\.m3u8(?:[?#]|$)/i.test(u.pathname + u.search) || seen.has(u.href)) return []; seen.add(u.href); return [{ name: plainText(entry.slice(0, split), 80) || '正片', url: u.href }]; } catch { return []; }
  }).slice(0, 500);
}
export function hlsVariants(text: string, base: string) {
  const lines = text.split('\n'); return lines.flatMap((line, i) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return []; const next = lines.slice(i + 1).find((v) => v.trim() && !v.startsWith('#')); if (!next) return [];
    const dim = line.match(/RESOLUTION=(\d+)x(\d+)/i), bandwidth = Number(line.match(/BANDWIDTH=(\d+)/)?.[1]) || 0;
    try { return [{ url: new URL(next.trim(), base).href, width: dim ? Number(dim[1]) : 0, height: dim ? Number(dim[2]) : 0, bandwidth }]; } catch { return []; }
  }).sort((a, b) => b.width * b.height - a.width * a.height || b.bandwidth - a.bandwidth);
}
/** Read actual media dimensions where possible. Bitrate is never proof of 4K. */
export async function inspectHls(url: string, signal: AbortSignal): Promise<HlsInspection> {
  let text = '', base = url, declaredWidth: number | undefined, declaredHeight: number | undefined, bandwidth: number | undefined;
  for (let depth = 0; depth < 4; depth++) {
    const r = await bounded(base, signal); base = r.url; text = r.bytes.toString('utf8').trimStart(); if (!text.startsWith('#EXTM3U')) throw new Error('不是有效的 HLS 播放清单');
    const variants = hlsVariants(text, base); if (!variants.length) break;
    const best = variants[0]; declaredWidth = best.width || undefined; declaredHeight = best.height || undefined; bandwidth = best.bandwidth || undefined; base = best.url;
    if (depth === 3) throw new Error('播放清单层级过深');
  }
  const segments: { url: string; key?: string; iv?: string; sequence: number; method?: string }[] = [];
  let method: string | undefined, key: string | undefined, iv: string | undefined, sequence = 0, duration = 0, init: string | undefined;
  for (const line of text.split('\n').map((v) => v.trim())) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = Number(line.split(':')[1]) || 0;
    else if (line.startsWith('#EXT-X-MAP:')) { const value = line.match(/URI="([^"]+)"/)?.[1]; if (value) init = new URL(value, base).href; }
    else if (line.startsWith('#EXT-X-KEY:')) { method = line.match(/METHOD=([^,]+)/)?.[1]; key = line.match(/URI="([^"]+)"/)?.[1]; iv = line.match(/IV=0x([a-f\d]{32})(?:,|$)/i)?.[1]; }
    else if (line.startsWith('#EXTINF:')) duration += Number(line.match(/^#EXTINF:([\d.]+)/)?.[1]) || 0;
    else if (line && !line.startsWith('#')) segments.push({ url: new URL(line, base).href, key: key ? new URL(key, base).href : undefined, iv, sequence: sequence++, method });
  }
  if (!segments.length) throw new Error('播放清单没有视频分片');
  if (method && !['NONE', 'AES-128'].includes(method)) throw new Error('该线路需要授权播放器');
  let resolution: MediaResolution | undefined;
  if (init) resolution = parseMp4VideoResolution((await bounded(init, signal, 192 * 1024, true)).bytes);
  const sample = segments[Math.floor(segments.length / 2)];
  let bytes = (await bounded(sample.url, signal, 192 * 1024, true)).bytes;
  if (sample.method === 'AES-128') {
    if (!sample.key) throw new Error('播放密钥缺失');
    const k = (await bounded(sample.key, signal, 32)).bytes; if (k.length !== 16) throw new Error('播放密钥无效');
    const vector = sample.iv ? Buffer.from(sample.iv, 'hex') : Buffer.alloc(16); if (!sample.iv) vector.writeBigUInt64BE(BigInt(sample.sequence), 8);
    bytes = Buffer.from(decryptAes128CbcPrefix(bytes, k, vector));
  }
  resolution ||= looksLikeMp4(bytes) ? parseMp4VideoResolution(bytes) : parseTsVideoResolution(bytes);
  return { width: resolution?.width || declaredWidth, height: resolution?.height || declaredHeight, declaredWidth, declaredHeight, evidence: resolution ? 'segment' : declaredHeight ? 'manifest' : 'unknown', duration: Math.round(duration), complete: text.includes('#EXT-X-ENDLIST'), bandwidth };
}
async function workers<T>(rows: T[], count: number, fn: (v: T) => Promise<void>) { let n = 0; await Promise.all(Array.from({ length: Math.min(count, rows.length) }, async () => { while (n < rows.length) await fn(rows[n++]); })); }
export async function searchHlsResources(keyword: string, signal: AbortSignal, emit: (v: HlsSearchEvent) => void) {
  const cached = cache.get(keyword); if (cached && cached.expires > Date.now()) { cached.value.forEach((item) => emit({ type: 'result', item })); emit({ type: 'done', ...cached.stats }); return; }
  const stats = { sources: 0, total: HLS_SOURCES.length, checked: 0, candidates: 0, count: 0, errors: 0 }, seen = new Set<string>(), results: HlsResource[] = [];
  const all = AbortSignal.any([signal, AbortSignal.timeout(40_000)]);
  const jobs: { title: string; year: string; source: string; episodes: { name: string; url: string }[] }[] = [];
  const tasks: Promise<void>[] = [];
  const check = async (job: typeof jobs[number]) => {
    const release = await acquireHostSlot('resources-hls-probes');
    try { if (all.aborted) return; const url = job.episodes[0].url, inspection = await inspectHls(url, AbortSignal.any([all, AbortSignal.timeout(16_000)])); if (!inspection.complete || inspection.duration < 600 || resourceTier(inspection) === 'other') return;
      const item: HlsResource = { ...job, ...inspection, url, id: createHash('sha256').update(url).digest('hex').slice(0, 24), checkedAt: Date.now() }; results.push(item); stats.count++; emit({ type: 'result', item });
    } catch { stats.errors++; } finally { release(); stats.checked++; emit({ type: 'progress', ...stats }); }
  };
  await workers(HLS_SOURCES, 4, async (source) => {
    if (all.aborted) return;
    try { const url = new URL(source.url); url.search = new URLSearchParams({ ac: 'detail', wd: keyword }).toString(); const r = await bounded(url.href, all); const json = JSON.parse(r.bytes.toString('utf8')); for (const movie of (Array.isArray(json.list) ? json.list : []).slice(0, 20)) { const title = plainText(movie.vod_name, 200); if (!isRelevantPanTitle(title, keyword) || /解说|预告|花絮|伦理|写真/.test(title + String(movie.type_name || ''))) continue; const episodes = hlsEpisodes(movie.vod_play_url); if (!episodes.length || jobs.length >= 24 || jobs.filter((j) => j.source === source.name).length >= 4) continue; const first = episodes[0].url; if (seen.has(first)) continue; seen.add(first); const job = { title, year: plainText(movie.vod_year, 8), source: source.name, episodes }; jobs.push(job); stats.candidates = jobs.length; tasks.push(check(job)); } }
    catch { stats.errors++; } finally { stats.sources++; stats.candidates = jobs.length; emit({ type: 'progress', ...stats }); }
  });
  await Promise.all(tasks);
  if (!signal.aborted && !all.aborted) { if (cache.size >= 40) cache.delete(cache.keys().next().value!); cache.set(keyword, { value: results, stats: { ...stats }, expires: Date.now() + (results.length ? 5 * 60_000 : 30_000) }); }
  emit({ type: 'done', ...stats });
}
