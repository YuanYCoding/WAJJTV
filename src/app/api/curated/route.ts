import { NextResponse } from 'next/server';
import { CURATED_FILMS } from '@/lib/curated-films';
import { libraryGuard } from '@/lib/library-api-server';
import { getEnvSources } from '@/lib/env-sources';
import { cmsUrl, readSourceHealth } from '@/lib/source-health-server';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { cmsRequestHeaders } from '@/lib/cms-parser';
import { normalizeFilmTitle } from '@/lib/library-types';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const denied = libraryGuard(req); if (denied) return denied;
  const cached = getCache<typeof CURATED_FILMS>('curated-library');
  if (cached) return NextResponse.json({ items: cached });
  const source = getEnvSources().find((v) => !v.isAdult && readSourceHealth(v.url)?.status !== 'unavailable');
  const items = await Promise.all(CURATED_FILMS.map(async (film) => {
    if (!source) return film;
    try {
      const res = await fetchUpstream(cmsUrl(source.url, { ac: 'detail', wd: film.title }), { headers: cmsRequestHeaders(), timeoutMs: 3500 });
      const raw = await res.json();
      const match = Array.isArray(raw.list) ? raw.list.find((v: Record<string, unknown>) => String(v.vod_year) === film.year && film.aliases.some((a) => normalizeFilmTitle(a) === normalizeFilmTitle(String(v.vod_name || '')))) : null;
      return match && typeof match.vod_pic === 'string' && /^https?:\/\//.test(match.vod_pic) ? { ...film, cover: match.vod_pic } : film;
    } catch { return film; }
  }));
  setCache('curated-library', items, 6 * 60 * 60_000);
  return NextResponse.json({ items });
}
