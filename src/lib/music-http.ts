import { fetchUpstream } from './fetch-utils';
import { parseMusicJson } from './music-types';
export const MUSIC_UA = 'Mozilla/5.0';
// Provider data is normalized before it reaches clients.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MusicRow = Record<string, any>;
export async function musicData(url: string, signal: AbortSignal, headers: Record<string, string> = {}, timeoutMs = 4500): Promise<MusicRow> {
  const r = await fetchUpstream(url, { signal, timeoutMs, headers: { 'User-Agent': MUSIC_UA, Referer: new URL(url).origin + '/', ...headers } });
  if (!r.ok || !r.body) { await r.body?.cancel(); throw new Error(`接口暂不可用（HTTP ${r.status}）`); }
  const reader = r.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 1_500_000) throw new Error('目录数据过大'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  return parseMusicJson(Buffer.concat(chunks).toString('utf8')) as MusicRow;
}
