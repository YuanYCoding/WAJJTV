import { fetchUpstream, getCache, setCache } from './fetch-utils';

export const DISCOVER_KINDS = ['hot', 'movie', 'tv', 'anime', 'variety'] as const;
export type DiscoverKind = typeof DISCOVER_KINDS[number];
export interface DiscoverItem { id: string; title: string; cover: string; rating?: string; year?: string; area?: string; genre?: string; remarks?: string; kind: DiscoverKind }
export interface DiscoverResult { items: DiscoverItem[]; total: number; hasMore: boolean; provider: string }
export interface DiscoverFilters { kind: DiscoverKind; page: number; genre: string; area: string; year: string; sort: string }
const CATEGORIES = { movie: 1, tv: 2, variety: 3, anime: 4 };
const forbidden = /伦理|情色|三级片|AV女|成人影片/;
const text = (v: unknown) => typeof v === 'string' ? v.replace(/<[^>]+>/g, '').trim() : '';
const join = (v: unknown) => Array.isArray(v) ? v.map(text).filter(Boolean).join(' / ') : text(v);
export function normalizeDiscoverItem(raw: unknown, kind: DiscoverKind): DiscoverItem | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  const title = text(v.title);
  const genre = join(v.moviecategory || v.tvcategory || v.dongmancategory || v.category);
  if (!title || !v.id || forbidden.test(`${title} ${genre}`)) return undefined;
  let cover = text(v.cdncover || v.cover);
  if (cover.startsWith('//')) cover = 'https:' + cover;
  if (!/^https?:\/\//.test(cover)) cover = '';
  const rating = Number(v.doubanscore || v.score);
  return { id: `${kind}:${v.id}`, title, cover, rating: rating > 0 && rating <= 10 ? rating.toFixed(1) : undefined, year: text(v.pubdate || v.year).slice(0, 4), area: join(v.area), genre, remarks: v.upinfo ? `更新至 ${v.upinfo} 集` : text(v.tag), kind };
}
export async function fetchDiscover(filters: DiscoverFilters): Promise<DiscoverResult> {
  const key = `discover:${JSON.stringify(filters)}`;
  const cached = getCache<DiscoverResult>(key);
  if (cached) return cached;
  const kinds = filters.kind === 'hot' ? ['movie', 'tv'] as const : [filters.kind];
  const size = filters.kind === 'hot' ? 12 : 24;
  const results = await Promise.all(kinds.map(async (kind) => {
    const url = new URL('https://api.web.360kan.com/v1/filter/list');
    const area = filters.area === '大陆' && kind === 'tv' ? '内地' : filters.area;
    const params = { catid: String(CATEGORIES[kind]), rank: filters.sort, size: String(size), pageno: String(filters.page), cat: filters.genre, area, year: filters.year, act: '' };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetchUpstream(url.href, { timeoutMs: 6500, headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.360kan.com/', Accept: 'application/json' } });
    if (!res.ok) throw new Error('片库暂时不可用，请稍后重试或切换排行榜');
    const raw = await res.json();
    if (!Array.isArray(raw?.data?.movies)) throw new Error('片库返回格式异常');
    const items = raw.data.movies.map((v: unknown) => normalizeDiscoverItem(v, kind)).filter((v: DiscoverItem | undefined): v is DiscoverItem => !!v);
    const total = Math.max(0, Number(raw.data.total) || 0);
    return { items: items as DiscoverItem[], total, hasMore: filters.page * size < total };
  }));
  // Interleave films and series on the opening shelf.
  const items: DiscoverItem[] = [];
  for (let i = 0; i < size; i++) for (const r of results) if (r.items[i]) items.push(r.items[i]);
  const result = { items, total: results.reduce((n, v) => n + v.total, 0), hasMore: results.some((r) => r.hasMore), provider: '360 影视片库' };
  setCache(key, result, 10 * 60_000);
  return result;
}
