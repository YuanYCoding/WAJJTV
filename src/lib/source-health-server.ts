import fs from 'node:fs';
import path from 'node:path';
import { fetchUpstream } from './fetch-utils';
import { cmsRequestHeaders } from './cms-parser';
import { getEnvSources } from './env-sources';
import { nextHealth, type SourceHealth } from './source-health';

type Registry = { records: Record<string, SourceHealth>; inFlight: Map<string, Promise<SourceHealth>>; started: boolean; timer?: ReturnType<typeof setTimeout> };
const root = globalThis as typeof globalThis & { __wajjtvHealth?: Registry };
const file = path.join(process.env.HEALTH_DATA_DIR || path.join(process.cwd(), 'data'), 'source-health.json');
function state(): Registry {
  if (!root.__wajjtvHealth) {
    let records: Record<string, SourceHealth> = {};
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) records = raw;
    } catch { /* First start, or corrupted cache: unknown until checked. */ }
    root.__wajjtvHealth = { records, inFlight: new Map(), started: false };
  }
  return root.__wajjtvHealth;
}
const urlKey = (url: string) => url.replace(/\/+$/, '');
export function readSourceHealth(url: string): SourceHealth | undefined { return state().records[urlKey(url)]; }
export function recordSourceResult(url: string, ok: boolean, ms?: number, error?: string): SourceHealth {
  const s = state();
  const key = urlKey(url);
  const entry = nextHealth(s.records[key], ok, ms, error);
  s.records[key] = entry;
  if (Object.keys(s.records).length > 500) {
    const keys = Object.keys(s.records).sort((a, b) => s.records[a].checkedAt - s.records[b].checkedAt);
    for (const k of keys.slice(0, 100)) delete s.records[k];
  }
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(s.records), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) { console.warn('[WAJJTV] health cache not persisted:', err instanceof Error ? err.message : err); }
  }, 250);
  s.timer.unref?.();
  return entry;
}
export function cmsUrl(raw: string, params: Record<string, string>): string {
  const u = new URL(raw);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.href;
}
export function probeSource(url: string): Promise<SourceHealth> {
  const s = state();
  const key = urlKey(url);
  const pending = s.inFlight.get(key);
  if (pending) return pending;
  const task = (async () => {
    const start = Date.now();
    try {
      const res = await fetchUpstream(cmsUrl(url, { ac: 'detail', wd: 'test', pg: '1' }), { timeoutMs: 5000, headers: cmsRequestHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // A valid empty search is healthy. JSON error pages are not.
      if (!data || !Object.prototype.hasOwnProperty.call(data, 'list') || (data.list !== null && !Array.isArray(data.list)) || data.code === 0) throw new Error('接口未返回有效的影视列表');
      return recordSourceResult(url, true, Date.now() - start);
    } catch (err) {
      return recordSourceResult(url, false, Date.now() - start, err instanceof Error ? err.message : '探测失败');
    } finally { s.inFlight.delete(key); }
  })();
  s.inFlight.set(key, task);
  return task;
}
let sweeping = false;
export async function sweepSources(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const due = getEnvSources().filter((s) => !s.isAdult && (readSourceHealth(s.url)?.nextCheckAt || 0) <= Date.now());
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(3, due.length) }, async () => {
      while (cursor < due.length) await probeSource(due[cursor++].url);
    }));
  } finally { sweeping = false; }
}
export function startSourceMonitor(): void {
  const s = state();
  if (s.started) return;
  s.started = true;
  const initial = setTimeout(() => { void sweepSources(); }, 2000);
  initial.unref?.();
  const interval = setInterval(() => { void sweepSources(); }, 60_000);
  interval.unref?.();
}
