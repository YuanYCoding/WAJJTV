export const PROFILES = [{ id: 'haiqing', name: '海清' }, { id: 'jingjing', name: '静静' }] as const;
export type ProfileId = (typeof PROFILES)[number]['id'];
export type FilmKind = 'movie' | 'tv' | 'anime' | 'variety';
export type Preference = 'want' | 'watched' | 'dismissed' | null;
export type FilmProvider = '360' | 'douban' | 'bangumi' | 'baidu' | 'curated';
export interface Classification {
  section: 'ethics' | 'hk-iii';
  label: string;
  basis: string;
  sourceUrl: string;
  verifiedAt: string;
}
export interface FilmInput {
  provider: FilmProvider;
  providerId: string;
  kind: FilmKind;
  title: string;
  year?: string;
  cover?: string;
  rating?: string;
  synopsis?: string;
  actors?: string[];
  directors?: string[];
  area?: string;
  genre?: string;
  durationMinutes?: number;
  /** Display metadata; write APIs derive this from the verified catalogue, never trust client labels. */
  classification?: Classification;
}
export interface LibraryFilm extends FilmInput {
  id: string;
  classification?: Classification;
}
export interface LibraryItem {
  film: LibraryFilm;
  states: Record<ProfileId, Preference>;
  revisions: Record<ProfileId, number>;
  updatedAt: number;
  aliases: { provider: FilmProvider; providerId: string; kind: FilmKind }[];
}
export interface TonightItem extends LibraryItem {
  reason: 'both' | 'haiqing' | 'jingjing';
}
export interface TonightRound {
  day: string;
  version: number;
  items: TonightItem[];
  eligibleCount: number;
  remainingCount: number;
  exhausted: boolean;
}
export interface LibraryResponse { items: LibraryItem[] }
export function isProfile(value: unknown): value is ProfileId {
  return value === 'haiqing' || value === 'jingjing';
}
export const profileName = (id: ProfileId) => PROFILES.find((p) => p.id === id)!.name;
export const normalizeFilmTitle = (title: string) => title.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, '');

/** Stable fallback for providers whose feeds do not expose a durable id. Never use rank. */
export function titleIdentity(title: string, year = ''): string {
  return `${normalizeFilmTitle(title)}:${year}`;
}
