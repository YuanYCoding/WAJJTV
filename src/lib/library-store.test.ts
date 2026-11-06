import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryStore, shanghaiDay } from './library-store';
import type { FilmInput, LibraryItem, Preference, ProfileId } from './library-types';
import { CURATED_FILMS } from './curated-films';

let db: LibraryStore;
let now = Date.UTC(2026, 9, 21, 12);
const movie = (id: string, title = id, year = '2026', provider: FilmInput['provider'] = '360'): FilmInput => ({ provider, providerId: id, kind: 'movie', title, year });
function mark(item: LibraryItem, profile: ProfileId, status: Preference) { return db.setPreference(profile, item.film.id, status, db.item(item.film.id).revisions[profile]); }
beforeEach(() => { now = Date.UTC(2026, 9, 21, 12); db = new LibraryStore(':memory:', () => now, () => 0); });
afterEach(() => db.close());

describe('shared library identity and preferences', () => {
  it('a provider id is idempotent and each person owns an independent preference', () => {
    const film = db.resolve(movie('a'));
    expect(db.resolve(movie('a')).film.id).toBe(film.film.id);
    mark(film, 'haiqing', 'want'); mark(film, 'jingjing', 'watched');
    expect(db.list()[0].states).toEqual({ haiqing: 'want', jingjing: 'watched' });
    mark(film, 'haiqing', null);
    expect(db.list()[0].states).toEqual({ haiqing: null, jingjing: 'watched' });
    mark(film, 'jingjing', null);
    expect(db.list()).toEqual([]);
    expect(db.resolve(movie('a')).revisions).toEqual({ haiqing: 2, jingjing: 2 });
  });
  it('requires an explicit link for matching titles across providers', () => {
    const first = db.resolve(movie('a', '同一部', '2020'));
    const other = movie('douban-a', '同一部', '2020', 'douban');
    expect(() => db.resolve(other)).toThrow('请确认');
    expect(() => db.resolve(other, 'link', 'unknown')).toThrow('不匹配');
    expect(db.resolve(other, 'link', first.film.id).film.id).toBe(first.film.id);
    expect(db.item(first.film.id).aliases).toHaveLength(2);
  });
  it('preserves remakes and permits explicitly keeping a same-title work separate', () => {
    const original = db.resolve(movie('a', '同名电影', '1999'));
    const remake = db.resolve(movie('b', '同名电影', '2026'));
    expect(original.film.id).not.toBe(remake.film.id);
    const separate = db.resolve(movie('c', '同名电影', '1999', 'douban'), 'separate');
    expect(separate.film.id).not.toBe(original.film.id);
  });
  it('does not guess identity when a year is missing', () => {
    db.resolve(movie('a', '同名', '1999'));
    expect(() => db.resolve(movie('b', '同名', '', 'baidu'))).toThrow('请确认');
  });
  it('retries are idempotent but a stale different change is rejected', () => {
    const film = db.resolve(movie('a'));
    const saved = db.setPreference('haiqing', film.film.id, 'want', 0);
    expect(db.setPreference('haiqing', film.film.id, 'want', 0).revisions.haiqing).toBe(1);
    db.setPreference('haiqing', film.film.id, 'watched', saved.revisions.haiqing);
    expect(() => db.setPreference('haiqing', film.film.id, 'dismissed', 1)).toThrow('刚刚更新');
  });
  it('keeps a snapshot without requiring any playable source or complete metadata', () => {
    const film = db.resolve({ provider: 'baidu', providerId: 'a', kind: 'tv', title: '尚未上映' });
    mark(film, 'haiqing', 'want');
    expect(db.list()[0].film.title).toBe('尚未上映');
    expect(db.list()[0].film.cover).toBeUndefined();
  });
  it('preserves verified classification through a confirmed alias with missing original year', () => {
    const seed = CURATED_FILMS[0];
    const original = db.resolve({ provider: 'baidu', providerId: 'no-year', title: seed.title, kind: 'movie' });
    const linked = db.resolve(seed, 'link', original.film.id);
    expect(linked.film.classification?.section).toBe('hk-iii');
    mark(linked, 'haiqing', 'want');
    expect(db.getTonight().eligibleCount).toBe(0);
  });
});

describe('shared tonight rounds', () => {
  it('prioritizes mutual wishes, excludes watched, dismissed and curated films', () => {
    const single = db.resolve(movie('single')); mark(single, 'haiqing', 'want');
    const both = db.resolve(movie('both')); mark(both, 'haiqing', 'want'); mark(both, 'jingjing', 'want');
    const watched = db.resolve(movie('watched')); mark(watched, 'haiqing', 'want'); mark(watched, 'jingjing', 'watched');
    const dismissed = db.resolve(movie('dismissed')); mark(dismissed, 'jingjing', 'want'); mark(dismissed, 'haiqing', 'dismissed');
    const mature = db.resolve(CURATED_FILMS[0]); mark(mature, 'haiqing', 'want'); mark(mature, 'jingjing', 'want');
    const round = db.draw(0);
    expect(round.items.map((v) => v.film.id)).toEqual([both.film.id, single.film.id]);
    expect(round.items.map((v) => v.reason)).toEqual(['both', 'haiqing']);
    expect(db.getTonight()).toEqual(round);
  });
  it('shows fewer than three rather than filling from the global catalogue', () => {
    db.resolve(movie('not-wanted'));
    const one = db.resolve(movie('one')); mark(one, 'jingjing', 'want');
    expect(db.draw(0).items).toHaveLength(1);
  });
  it('replaces candidates without changing preferences and needs an explicit reset after exhaustion', () => {
    for (let i = 0; i < 5; i++) mark(db.resolve(movie(String(i))), 'haiqing', 'want');
    const before = db.list();
    const first = db.draw(0); const second = db.draw(first.version);
    expect(first.items).toHaveLength(3); expect(second.items).toHaveLength(2);
    expect(second.items.every((x) => !first.items.some((v) => v.film.id === x.film.id))).toBe(true);
    expect(() => db.draw(second.version)).toThrow('抽过一轮');
    expect(db.draw(second.version, true).items).toHaveLength(3);
    expect(db.list()).toEqual(before);
  });
  it('rejects two simultaneous draws based on the same version', () => {
    mark(db.resolve(movie('one')), 'haiqing', 'want');
    db.draw(0);
    expect(() => db.draw(0, true)).toThrow('对方刚更新');
  });
  it('withdraws a candidate immediately when either person marks it watched', () => {
    const film = db.resolve(movie('one')); mark(film, 'haiqing', 'want');
    const before = db.draw(0); mark(film, 'jingjing', 'watched');
    const after = db.getTonight();
    expect(after.items).toEqual([]); expect(after.version).toBeGreaterThan(before.version);
    expect(() => db.draw(before.version)).toThrow('对方刚更新');
  });
  it('starts a new day at Shanghai midnight', () => {
    now = Date.UTC(2026, 9, 21, 15, 59);
    mark(db.resolve(movie('one')), 'haiqing', 'want');
    expect(db.draw(0).day).toBe('2026-10-21');
    now += 2 * 60_000;
    expect(db.getTonight()).toMatchObject({ day: '2026-10-22', version: 0, items: [] });
    expect(db.draw(0).items).toHaveLength(1);
    expect(shanghaiDay(now)).toBe('2026-10-22');
  });
});

it('retains preferences and the shared round after a database restart', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wajjtv-library-test-'));
  const file = path.join(dir, 'library.sqlite');
  const first = new LibraryStore(file, () => now, () => 0);
  const film = first.resolve(movie('persistent'));
  first.setPreference('haiqing', film.film.id, 'want', 0);
  const round = first.draw(0); first.close();
  const second = new LibraryStore(file, () => now, () => 0);
  try { expect(second.list()[0].states.haiqing).toBe('want'); expect(second.getTonight()).toEqual(round); }
  finally { second.close(); for (const name of readdirSync(dir)) unlinkSync(path.join(dir, name)); rmdirSync(dir); }
});
