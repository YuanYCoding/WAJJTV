import { NextResponse } from 'next/server';
import { guardRequest } from './api-guard';
import { LibraryError } from './library-store';
import { isProfile, type FilmInput, type FilmProvider, type ProfileId } from './library-types';
import { CURATED_FILMS } from './curated-films';

export const PROFILE_COOKIE = 'wajjtv_profile';
export function requestProfile(req: Request): ProfileId | null {
  const value = (req.headers.get('cookie') || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(PROFILE_COOKIE + '='))?.slice(PROFILE_COOKIE.length + 1);
  return isProfile(value) ? value : null;
}
export function libraryGuard(req: Request, write = false): NextResponse | null {
  const auth = guardRequest(req);
  if (auth) return auth;
  if (write) {
    const expected = new URL(process.env.SITE_ORIGIN || req.url).origin;
    if (req.headers.get('origin') !== expected) return NextResponse.json({ error: '请求来源不匹配' }, { status: 403 });
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return NextResponse.json({ error: '需要 JSON 请求' }, { status: 415 });
  }
  return null;
}
export async function libraryBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 32768) throw new LibraryError('TOO_LARGE', '请求内容过大', 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new LibraryError('BAD_JSON', '请求格式错误'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LibraryError('BAD_JSON', '请求格式错误');
  return body as Record<string, unknown>;
}
export function libraryFailure(err: unknown): NextResponse {
  // The database singleton survives Next.js hot reloads, so its Error constructor may be from the previous module instance.
  const e = err as Partial<LibraryError> | null;
  const known = new Set(['NOT_FOUND', 'MATCH_CONFIRMATION', 'INVALID_MATCH', 'STALE_PREFERENCE', 'STALE_ROUND', 'POOL_EXHAUSTED', 'TOO_LARGE', 'BAD_JSON', 'BAD_FILM', 'PROFILE_REQUIRED']);
  if (e && typeof e.code === 'string' && known.has(e.code) && typeof e.message === 'string' && Number.isInteger(e.status) && Number(e.status) >= 400 && Number(e.status) < 500) {
    return NextResponse.json({ error: e.message, code: e.code, details: e.details }, { status: e.status });
  }
  console.error('[WAJJTV library]', err instanceof Error ? err.message : err);
  return NextResponse.json({ error: '片单服务暂时不可用，请稍后重试' }, { status: 503 });
}
const cleanText = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim().slice(0, max) : '';
const names = (v: unknown) => Array.isArray(v) ? v.slice(0, 16).map((s) => cleanText(s, 80)).filter(Boolean) : [];
export function validateFilm(raw: unknown): FilmInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new LibraryError('BAD_FILM', '影片资料无效');
  const v = raw as Record<string, unknown>;
  if (!['360', 'douban', 'bangumi', 'baidu', 'curated'].includes(String(v.provider)) || !['movie', 'tv', 'anime', 'variety'].includes(String(v.kind))) throw new LibraryError('BAD_FILM', '影片来源或类型无效');
  const providerId = cleanText(v.providerId, 300);
  const title = cleanText(v.title, 200);
  if (!providerId || !title) throw new LibraryError('BAD_FILM', '缺少影片标识或名称');
  if (v.provider === 'curated') {
    const seed = CURATED_FILMS.find((s) => s.providerId === providerId);
    if (!seed) throw new LibraryError('BAD_FILM', '精选条目不存在');
    const cover = cleanText(v.cover, 2048);
    return { ...seed, cover: /^https?:\/\//i.test(cover) ? cover : seed.cover };
  }
  const year = cleanText(v.year, 4);
  const cover = cleanText(v.cover, 2048);
  const rating = Number(v.rating);
  return {
    provider: v.provider as FilmProvider, providerId, title, kind: v.kind as FilmInput['kind'],
    year: /^(18|19|20)\d{2}$/.test(year) ? year : '',
    cover: /^https?:\/\//i.test(cover) ? cover : '', rating: rating > 0 && rating <= 10 ? String(rating) : undefined,
    synopsis: cleanText(v.synopsis, 5000), actors: names(v.actors), directors: names(v.directors),
    area: cleanText(v.area, 100), genre: cleanText(v.genre, 100),
    durationMinutes: typeof v.durationMinutes === 'number' && Number.isFinite(v.durationMinutes) && v.durationMinutes > 0 && v.durationMinutes <= 1000 ? Math.round(v.durationMinutes) : undefined,
  };
}
export function requireProfile(req: Request): ProfileId {
  const profile = requestProfile(req);
  if (!profile) throw new LibraryError('PROFILE_REQUIRED', '请先选择海清或静静', 409);
  return profile;
}
