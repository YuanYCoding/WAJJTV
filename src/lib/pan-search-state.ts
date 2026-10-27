import type { PanProvider, PanResult } from './netdisk-types';
export interface PanSearchSnapshot { keyword: string; searched: string; filter: 'all' | PanProvider; rows: PanResult[]; page: number; more: boolean; prefer4k: boolean; scroll: number; expires: number; rejected: number; unchecked: number }
const KEY = 'jjbitv:pan-search:v9';
export function readPanSearchState(query?: string | null): PanSearchSnapshot | null {
  try { const raw = sessionStorage.getItem(KEY); if (!raw || raw.length > 1_500_000) return null; const v = JSON.parse(raw) as PanSearchSnapshot; if (v.expires <= Date.now() || !Array.isArray(v.rows) || !['all', 'aliyun', 'quark'].includes(v.filter) || (query && v.searched !== query)) return null; return v; } catch { return null; }
}
export function writePanSearchState(value: Omit<PanSearchSnapshot, 'expires'>) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...value, rows: value.rows.slice(0, 1000), expires: Date.now() + 30 * 60_000 })); } catch { /* In-memory UI still works when browser storage is unavailable. */ }
}
