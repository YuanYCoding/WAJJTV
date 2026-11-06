import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DEFAULT_RESOURCE_SOURCES } from './resource-source-defaults';
import { isValidProxyUrl, checkUpstreamAllowed } from './ssrf';
import { PanError, plainText } from './netdisk-utils';
import type { ResourceSource, ResourceSourceConfig, ResourceSourceHealth } from './resource-source-types';
interface Saved extends ResourceSourceConfig { deleted: string[] }
const directory = () => process.env.LIBRARY_DATA_DIR || './data';
function read(): Saved { try { const raw = readFileSync(join(directory(), 'resource-sources.json'), 'utf8'); if (raw.length > 1_000_000) throw new Error(); const data = JSON.parse(raw); if (!Number.isInteger(data.revision) || !Array.isArray(data.sources) || !Array.isArray(data.deleted)) throw new Error(); return data; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, sources: [], deleted: [] }; throw new PanError('资源接口配置无法读取，请恢复配置文件后重试', 503); } }
export function resourceSources(): ResourceSourceConfig {
  const saved = read(), all = new Map(DEFAULT_RESOURCE_SOURCES.map((v) => [v.id, { ...v }])); for (const item of saved.sources) all.set(item.id, item); for (const id of saved.deleted) all.delete(id); return { revision: saved.revision, sources: [...all.values()] };
}
export function sourceRevisionKey() { const c = resourceSources(); return createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 16); }
export function enabledResourceSources(kind: 'hls' | 'pan') { return resourceSources().sources.filter((v) => v.kind === kind && v.enabled); }
export function validateResourceSources(raw: unknown): ResourceSource[] {
  if (!Array.isArray(raw) || raw.length > 150) throw new PanError('最多保存 150 个资源接口');
  const ids = new Set<string>(), urls = new Set<string>();
  return raw.map((v) => {
    if (!v || typeof v !== 'object' || !/^[\w-]{1,80}$/.test(v.id) || ids.has(v.id)) throw new PanError('接口 ID 无效或重复'); ids.add(v.id);
    const name = plainText(v.name, 80), kind = v.kind; if (!name || !['pan', 'hls'].includes(kind) || typeof v.enabled !== 'boolean' || typeof v.url !== 'string' || v.url.length > 3000 || !isValidProxyUrl(v.url)) throw new PanError('接口名称、类型或地址无效');
    const url = new URL(v.url); if (url.username || url.password || url.hash) throw new PanError('接口地址不能含账号密码或锚点');
    const builtin = DEFAULT_RESOURCE_SOURCES.find((x) => x.id === v.id), allowed = kind === 'hls' ? ['cms'] : ['pansou', 'pan-json', 'pan-cms'];
    if (builtin && (builtin.kind !== kind || builtin.adapter !== v.adapter)) throw new PanError('内置接口的适配协议不能更改');
    if (!builtin && !allowed.includes(v.adapter)) throw new PanError('不支持该接口协议');
    const normalized = url.search ? url.href : url.href.replace(/\/$/, ''), duplicate = kind + ':' + normalized; if (urls.has(duplicate)) throw new PanError('同类接口地址重复，请保留一个'); urls.add(duplicate);
    return { id: v.id, name, kind, adapter: v.adapter, url: normalized, enabled: v.enabled, builtin: Boolean(builtin), priority: builtin?.priority ?? 50 };
  });
}
export async function saveResourceSources(revision: unknown, raw: unknown) {
  const before = resourceSources(); if (revision !== before.revision) throw new PanError('另一台设备已修改接口，请刷新后再保存', 409, 'CONFIG_CONFLICT');
  const sources = validateResourceSources(raw); const changed = sources.filter((v) => !before.sources.some((p) => p.id === v.id && p.url.replace(/\/$/, '') === v.url));
  for (const v of changed) if (!(await checkUpstreamAllowed(v.url)).ok) throw new PanError('接口地址必须指向公网');
  // DNS awaits above must not allow another device's edit to be overwritten.
  if (resourceSources().revision !== before.revision) throw new PanError('配置已更新，请刷新后再保存', 409, 'CONFIG_CONFLICT');
  const saved: Saved = { revision: before.revision + 1, sources, deleted: DEFAULT_RESOURCE_SOURCES.filter((v) => !sources.some((x) => x.id === v.id)).map((v) => v.id) };
  mkdirSync(directory(), { recursive: true, mode: 0o700 }); const path = join(directory(), 'resource-sources.json'), tmp = path + '.' + randomUUID() + '.tmp'; writeFileSync(tmp, JSON.stringify(saved), { mode: 0o600 }); renameSync(tmp, path); return resourceSources();
}
const health = new Map<string, ResourceSourceHealth>();
const key = (source: ResourceSource) => createHash('sha256').update(source.kind + source.id + source.url).digest('hex');
export function resourceHealth(source: ResourceSource) { return health.get(key(source)); }
export function recordResourceHealth(source: ResourceSource, ok: boolean, ms: number, error?: string, sample?: ResourceSourceHealth['sample']) { const prior = resourceHealth(source), failures = ok ? 0 : (prior?.failures || 0) + 1; health.set(key(source), { failures, nextCheck: failures >= 2 ? Date.now() + Math.min(30, failures * 3) * 60_000 : 0, checkedAt: Date.now(), ms, error, sample }); }
