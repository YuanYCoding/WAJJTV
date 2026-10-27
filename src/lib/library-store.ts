import type { DatabaseSync as NativeDatabase } from 'node:sqlite';
import { randomUUID, randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { curatedMatch } from './curated-films';
import { normalizeFilmTitle, type FilmInput, type LibraryFilm, type LibraryItem, type Preference, type ProfileId, type TonightItem, type TonightRound } from './library-types';

// Native access keeps older bundlers from rewriting the mandatory node: prefix.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

export class LibraryError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); }
}
export function shanghaiDay(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map((type) => parts.find((p) => p.type === type)!.value).join('-');
}
type FilmRow = { id: string; snapshot: string; updated_at: number };
type PreferenceRow = { profile_id: ProfileId; status: Preference; revision: number; updated_at: number };
type RoundRow = { day: string; version: number; candidates: string; excluded: string };

/** Synchronous short transactions are deliberate: a single private household, no network work inside transactions. */
export class LibraryStore {
  private db: NativeDatabase;
  constructor(filename: string, private now: () => number = Date.now, private choose: (size: number) => number = randomInt) {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;');
    const version = Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    if (version > 1) throw new Error('片单数据库版本比程序更新，请使用对应版本');
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, name TEXT NOT NULL);
        INSERT OR IGNORE INTO profiles VALUES('haiqing','海清'),('jingjing','静静');
        CREATE TABLE IF NOT EXISTS films(id TEXT PRIMARY KEY, normalized_title TEXT NOT NULL, year TEXT NOT NULL, kind TEXT NOT NULL, snapshot TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS films_match ON films(normalized_title,kind,year);
        CREATE TABLE IF NOT EXISTS aliases(provider TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL, film_id TEXT NOT NULL REFERENCES films(id), PRIMARY KEY(provider,external_id,kind));
        CREATE TABLE IF NOT EXISTS preferences(profile_id TEXT NOT NULL REFERENCES profiles(id), film_id TEXT NOT NULL REFERENCES films(id), status TEXT CHECK(status IN ('want','watched','dismissed') OR status IS NULL), revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(profile_id,film_id));
        CREATE TABLE IF NOT EXISTS tonight(day TEXT PRIMARY KEY, version INTEGER NOT NULL, candidates TEXT NOT NULL, excluded TEXT NOT NULL);
        PRAGMA user_version=1;
      `);
    });
  }
  close(): void { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  private filmRow(id: string): FilmRow | undefined { return this.db.prepare('SELECT id,snapshot,updated_at FROM films WHERE id=?').get(id) as FilmRow | undefined; }
  item(id: string): LibraryItem {
    const row = this.filmRow(id);
    if (!row) throw new LibraryError('NOT_FOUND', '影片已不存在', 404);
    const film = JSON.parse(row.snapshot) as LibraryFilm;
    const aliases = this.db.prepare('SELECT provider,external_id AS providerId,kind FROM aliases WHERE film_id=?').all(id) as LibraryItem['aliases'];
    // Confirmed aliases also carry classification when the original metadata had no year.
    film.classification = curatedMatch(film)?.classification || aliases
      .filter((a) => a.provider === 'curated')
      .map((a) => curatedMatch({ ...film, ...a })?.classification).find(Boolean);
    const states: LibraryItem['states'] = { haiqing: null, jingjing: null };
    const revisions = { haiqing: 0, jingjing: 0 };
    let updatedAt = row.updated_at;
    for (const p of this.db.prepare('SELECT * FROM preferences WHERE film_id=?').all(id) as PreferenceRow[]) {
      states[p.profile_id] = p.status;
      revisions[p.profile_id] = p.revision;
      updatedAt = Math.max(updatedAt, p.updated_at);
    }
    return { film, states, revisions, updatedAt, aliases };
  }
  resolve(input: FilmInput, decision?: 'separate' | 'link', existingId?: string): LibraryItem {
    return this.transaction(() => {
      const trusted = curatedMatch(input);
      const clean: FilmInput = input.provider === 'curated' && trusted ? { ...trusted, cover: input.cover || trusted.cover } : input;
      const alias = this.db.prepare('SELECT film_id FROM aliases WHERE provider=? AND external_id=? AND kind=?').get(clean.provider, clean.providerId, clean.kind) as { film_id: string } | undefined;
      if (alias) return this.item(alias.film_id);
      const candidates = this.db.prepare('SELECT id FROM films WHERE normalized_title=? AND kind=? AND (year=? OR year=\'\' OR ?=\'\') LIMIT 10')
        .all(normalizeFilmTitle(clean.title), clean.kind, clean.year || '', clean.year || '') as { id: string }[];
      if (candidates.length && !decision) throw new LibraryError('MATCH_CONFIRMATION', '发现可能是同一部的影片，请确认后再保存', 409, candidates.map((c) => this.item(c.id)));
      if (decision === 'link') {
        if (!candidates.some((c) => c.id === existingId)) throw new LibraryError('INVALID_MATCH', '不能关联到不匹配的影片');
        this.db.prepare('INSERT INTO aliases VALUES(?,?,?,?)').run(clean.provider, clean.providerId, clean.kind, existingId!);
        return this.item(existingId!);
      }
      const id = randomUUID();
      const film: LibraryFilm = { ...clean, id, classification: trusted?.classification };
      this.db.prepare('INSERT INTO films VALUES(?,?,?,?,?,?)').run(id, normalizeFilmTitle(clean.title), clean.year || '', clean.kind, JSON.stringify(film), this.now());
      this.db.prepare('INSERT INTO aliases VALUES(?,?,?,?)').run(clean.provider, clean.providerId, clean.kind, id);
      return this.item(id);
    });
  }
  list(): LibraryItem[] {
    const rows = this.db.prepare('SELECT film_id,MAX(updated_at) AS recent FROM preferences GROUP BY film_id HAVING MAX(status IS NOT NULL)=1 ORDER BY recent DESC').all() as { film_id: string }[];
    return rows.map((r) => this.item(r.film_id));
  }
  setPreference(profile: ProfileId, filmId: string, status: Preference, expectedRevision: number): LibraryItem {
    return this.transaction(() => {
      const item = this.item(filmId);
      if (item.states[profile] === status) return item;
      if (item.revisions[profile] !== expectedRevision) throw new LibraryError('STALE_PREFERENCE', '片单刚刚更新，请查看最新状态后重试', 409);
      this.db.prepare('INSERT INTO preferences VALUES(?,?,?,?,?) ON CONFLICT(profile_id,film_id) DO UPDATE SET status=excluded.status,revision=excluded.revision,updated_at=excluded.updated_at')
        .run(profile, filmId, status, expectedRevision + 1, this.now());
      // Invalidate any in-flight draw based on the previous preference snapshot.
      this.db.prepare('UPDATE tonight SET version=version+1 WHERE day=?').run(shanghaiDay(this.now()));
      return this.item(filmId);
    });
  }
  private eligible(): TonightItem[] {
    return this.list().flatMap((item) => {
      const { haiqing: h, jingjing: j } = item.states;
      if (item.film.classification || h === 'watched' || j === 'watched' || h === 'dismissed' || j === 'dismissed' || (h !== 'want' && j !== 'want')) return [];
      return [{ ...item, reason: h === 'want' && j === 'want' ? 'both' as const : h === 'want' ? 'haiqing' as const : 'jingjing' as const }];
    });
  }
  getTonight(): TonightRound {
    const day = shanghaiDay(this.now());
    const row = this.db.prepare('SELECT * FROM tonight WHERE day=?').get(day) as RoundRow | undefined;
    const eligible = this.eligible();
    const current = row ? JSON.parse(row.candidates) as string[] : [];
    const excluded = new Set<string>(row ? JSON.parse(row.excluded) : []);
    const byId = new Map(eligible.map((v) => [v.film.id, v]));
    const remainingCount = eligible.filter((v) => !excluded.has(v.film.id)).length;
    return { day, version: row?.version || 0, items: current.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []), eligibleCount: eligible.length, remainingCount, exhausted: eligible.length > 0 && remainingCount === 0 };
  }
  draw(expectedVersion: number, reset = false): TonightRound {
    return this.transaction(() => {
      const current = this.getTonight();
      if (current.version !== expectedVersion) throw new LibraryError('STALE_ROUND', '对方刚更新了选片结果，已为你刷新', 409);
      const row = this.db.prepare('SELECT * FROM tonight WHERE day=?').get(current.day) as RoundRow | undefined;
      const excluded = new Set<string>(!reset && row ? JSON.parse(row.excluded) : []);
      const available = this.eligible().filter((v) => !excluded.has(v.film.id));
      if (!available.length && current.eligibleCount) throw new LibraryError('POOL_EXHAUSTED', '今天的片单已抽过一轮，可以重新抽选', 409);
      const picks: string[] = [];
      for (const pool of [available.filter((v) => v.reason === 'both'), available.filter((v) => v.reason !== 'both')]) {
        while (pool.length && picks.length < 3) picks.push(pool.splice(this.choose(pool.length), 1)[0].film.id);
      }
      for (const id of picks) excluded.add(id);
      this.db.prepare('INSERT INTO tonight VALUES(?,?,?,?) ON CONFLICT(day) DO UPDATE SET version=excluded.version,candidates=excluded.candidates,excluded=excluded.excluded')
        .run(current.day, current.version + 1, JSON.stringify(picks), JSON.stringify([...excluded]));
      this.db.prepare('DELETE FROM tonight WHERE day < ?').run(shanghaiDay(this.now() - 30 * 86400_000));
      return this.getTonight();
    });
  }
}

const globalStore = globalThis as typeof globalThis & { __wajjtvLibrary?: LibraryStore };
export function getLibrary(): LibraryStore {
  if (!globalStore.__wajjtvLibrary) {
    const dir = process.env.LIBRARY_DATA_DIR || process.env.HEALTH_DATA_DIR || path.join(process.cwd(), 'data');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    globalStore.__wajjtvLibrary = new LibraryStore(path.join(dir, 'library.sqlite'));
  }
  return globalStore.__wajjtvLibrary;
}
