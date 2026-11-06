import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, signSession } from './auth';
import { getLibrary, LibraryStore } from './library-store';
import { validateFilm, libraryFailure } from './library-api-server';
import { PUT as chooseProfile, GET as readProfile } from '@/app/api/profile/route';
import { PUT as preference } from '@/app/api/preferences/route';
import { POST as resolve } from '@/app/api/films/resolve/route';
import { GET as list } from '@/app/api/library/route';
import { GET as tonight, POST as draw } from '@/app/api/tonight/route';
import { CURATED_FILMS, curatedMatch } from './curated-films';

vi.mock('./library-store', async (original) => ({ ...await original<typeof import('./library-store')>(), getLibrary: vi.fn() }));
let store: LibraryStore;
beforeEach(() => { vi.stubEnv('PASSWORD', 'library-test-only'); vi.stubEnv('SITE_ORIGIN', 'https://local.test'); store = new LibraryStore(':memory:'); vi.mocked(getLibrary).mockReturnValue(store); });
afterEach(() => { store.close(); vi.unstubAllEnvs(); });
function req(path: string, method = 'GET', body?: unknown, profile = 'haiqing', origin = 'https://local.test', auth = true) {
  return new Request(`https://local.test${path}`, { method, headers: { origin, 'content-type': 'application/json', cookie: auth ? `${SESSION_COOKIE}=${signSession().token}; wajjtv_profile=${profile}` : '' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
describe('private shared APIs', () => {
  it('preserves a known conflict from a previous hot-reloaded Error constructor', async () => {
    const oldError = Object.assign(new Error('需要确认影片'), { code: 'MATCH_CONFIRMATION', status: 409, details: [] });
    const response = libraryFailure(oldError);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('MATCH_CONFIRMATION');
  });
  it('requires login for profile, library, film resolution and tonight', async () => {
    expect((await readProfile(req('/api/profile', 'GET', undefined, '', '', false))).status).toBe(401);
    expect((await list(req('/api/library', 'GET', undefined, '', '', false))).status).toBe(401);
    expect((await tonight(req('/api/tonight', 'GET', undefined, '', '', false))).status).toBe(401);
    expect((await resolve(req('/api/films/resolve', 'POST', {}, '', '', false))).status).toBe(401);
  });
  it('blocks foreign or absent origins on writes', async () => {
    for (const origin of ['', 'https://evil.example']) expect((await chooseProfile(req('/api/profile', 'PUT', { profile: 'haiqing' }, 'haiqing', origin))).status).toBe(403);
    expect((await chooseProfile(req('/api/profile', 'PUT', { profile: 'other' }))).status).toBe(400);
    expect((await chooseProfile(req('/api/profile', 'PUT', { profile: 'jingjing' }))).headers.get('set-cookie')).toContain('wajjtv_profile=jingjing');
  });
  it('keeps profile cookies aligned with HTTPS and the explicit deployment policy', async () => {
    const secureRequest = req('/api/profile', 'PUT', { profile: 'haiqing' });
    secureRequest.headers.set('x-forwarded-proto', 'https');
    expect((await chooseProfile(secureRequest)).headers.get('set-cookie')).toContain('Secure');
    expect((await chooseProfile(req('/api/profile', 'PUT', { profile: 'haiqing' }))).headers.get('set-cookie')).not.toContain('Secure');
    vi.stubEnv('COOKIE_SECURE', 'true');
    expect((await chooseProfile(req('/api/profile', 'PUT', { profile: 'haiqing' }))).headers.get('set-cookie')).toContain('Secure');
  });
  it('rejects an action queued before the browser switched profiles', async () => {
    const item = store.resolve({ provider: '360', providerId: 'test', title: '测试', kind: 'movie' });
    const body = { filmId: item.film.id, profile: 'haiqing', status: 'want', expectedRevision: 0 };
    expect((await preference(req('/api/preferences', 'PUT', body, 'jingjing'))).status).toBe(409);
    expect(store.list()).toEqual([]);
    expect((await preference(req('/api/preferences', 'PUT', body))).status).toBe(200);
    expect(store.list()[0].states).toEqual({ haiqing: 'want', jingjing: null });
  });
  it('exposes identity confirmation and round conflicts as 409 responses', async () => {
    const film = { provider: '360', providerId: 'a', title: '测试', year: '2020', kind: 'movie' };
    expect((await resolve(req('/api/films/resolve', 'POST', { film }))).status).toBe(200);
    const conflict = await resolve(req('/api/films/resolve', 'POST', { film: { ...film, provider: 'douban', providerId: 'b' } }));
    expect(conflict.status).toBe(409); expect((await conflict.json()).code).toBe('MATCH_CONFIRMATION');
    await draw(req('/api/tonight', 'POST', { expectedVersion: 0 }));
    expect((await draw(req('/api/tonight', 'POST', { expectedVersion: 0 }))).status).toBe(409);
  });
  it('validates metadata and derives classification only from verified records', () => {
    const cleaned = validateFilm({ provider: '360', providerId: 'a', title: '<b>正常电影</b>', kind: 'movie', cover: 'javascript:bad', classification: { section: 'hk-iii' } });
    expect(cleaned.title).toBe('正常电影'); expect(cleaned.cover).toBe(''); expect(cleaned.classification).toBeUndefined();
    expect(() => validateFilm({ provider: 'curated', providerId: 'invented', title: '假的', kind: 'movie' })).toThrow('不存在');
    expect(CURATED_FILMS.every((f) => f.classification.sourceUrl.startsWith('https://'))).toBe(true);
    expect(curatedMatch({ ...CURATED_FILMS[0], provider: '360', providerId: 'other' })?.classification.section).toBe('hk-iii');
    expect(curatedMatch({ ...CURATED_FILMS[0], provider: '360', providerId: 'other', year: '1999' })).toBeUndefined();
  });
});
