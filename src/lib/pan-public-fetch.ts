import { fetchUpstream } from './fetch-utils';
export async function panGet(url: string, signal: AbortSignal, body?: object) {
  const r = await fetchUpstream(url, { timeoutMs: 6000, signal, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', Referer: new URL(url).origin + '/' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const reader = r.body!.getReader(), parts: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error('来源数据过大'); } parts.push(value); }
  return Buffer.concat(parts).toString('utf8');
}
export async function panWorkers<T>(rows: T[], concurrency: number, signal: AbortSignal, action: (row: T) => Promise<void>) {
  let cursor = 0; await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => { while (cursor < rows.length && !signal.aborted) await action(rows[cursor++]); }));
}
