import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { PanError } from './netdisk-utils';
import type { PanProvider, PanProgressFn } from './netdisk-types';
export interface DiskQuota { total: number; used: number; free: number }
export interface CleanupEntry { id: string; parent?: string; size: number; modified: number; priority: number; recycle?: boolean; record?: string; drive?: string }
interface Lease { id: string; owner: string; provider: PanProvider; account: string; hashes: string[]; expires: number }
const directory = () => process.env.LIBRARY_DATA_DIR || './data';
const hash = (account: string, file: string) => createHash('sha256').update(account + ':' + file).digest('hex');
const owner = (req: Request) => createHash('sha256').update(req.headers.get('cookie')?.match(/(?:^|;\s*)ltv_session=([^;]+)/)?.[1] || '').digest('hex');
function policy(): string[] {
  try { const value = JSON.parse(readFileSync(join(directory(), 'netdisk-cleanup-policy.json'), 'utf8')); if (!Array.isArray(value)) throw new Error('Invalid policy'); return value; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new PanError('自动清理设置暂时无法读取，已停止清理', 503); }
}
export const autoCleanupEnabled = (provider: PanProvider, account?: string) => process.env.PAN_AUTO_CLEANUP === '1' && Boolean(account && policy().includes(hash(provider, account)));
export function setAutoCleanup(provider: PanProvider, account: string, enabled: boolean) {
  if (enabled && process.env.PAN_AUTO_CLEANUP !== '1') throw new PanError('当前站点未启用自动清理功能', 409);
  const key = hash(provider, account), values = new Set(policy()); if (enabled) values.add(key); else values.delete(key);
  mkdirSync(directory(), { recursive: true, mode: 0o700 }); const path = join(directory(), 'netdisk-cleanup-policy.json'), tmp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(tmp, JSON.stringify([...values]), { mode: 0o600 }); renameSync(tmp, path); return { autoCleanup: autoCleanupEnabled(provider, account) };
}
export function diskQuota(total: unknown, used: unknown): DiskQuota {
  const t = Number(total), u = Number(used);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(u) || u < 0) throw new PanError('暂时无法确认网盘容量，已停止清理，请稍后重试', 502, 'QUOTA_UNKNOWN');
  return { total: t, used: u, free: Math.max(0, t - u) };
}
function readLeases(): Lease[] {
  try { const rows = JSON.parse(readFileSync(join(directory(), 'netdisk-leases.json'), 'utf8')) as Lease[]; if (!Array.isArray(rows)) throw new Error('Invalid leases'); return rows.filter((v) => v.expires > Date.now()); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new PanError('播放状态暂时无法读取，已停止空间清理', 503, 'LEASE_UNAVAILABLE'); }
}
function writeLeases(rows: Lease[]) {
  mkdirSync(directory(), { recursive: true, mode: 0o700 }); const path = join(directory(), 'netdisk-leases.json'), tmp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(tmp, JSON.stringify(rows), { mode: 0o600 }); renameSync(tmp, path);
}
export function startPlaybackLease(req: Request, provider: PanProvider, account: string, file: string, ancestors: string[] = []) {
  const rows = readLeases(); if (rows.length > 500) throw new PanError('播放会话较多，请稍后重试', 429);
  const id = randomUUID(); rows.push({ id, owner: owner(req), provider, account, hashes: [file, ...ancestors].filter(Boolean).map((v) => hash(account, v)), expires: Date.now() + 180_000 }); writeLeases(rows); return id;
}
export function touchPlaybackLease(req: Request, id: string, release = false) {
  const rows = readLeases(), lease = rows.find((v) => v.id === id && v.owner === owner(req)); if (!lease) return { active: false };
  if (release) writeLeases(rows.filter((v) => v !== lease)); else { lease.expires = Date.now() + 180_000; writeLeases(rows); }
  return { active: !release };
}
export function reserveExternalLease(req: Request, id: string) {
  const rows = readLeases(), lease = rows.find((v) => v.id === id && v.owner === owner(req));
  if (!lease) throw new PanError('播放准备已过期，请重新点播放', 410);
  const copy = { ...lease, id: randomUUID(), expires: Date.now() + 6 * 60 * 60_000 }; rows.push(copy); writeLeases(rows); return copy.id;
}
export function storageProtected(provider: PanProvider, account: string, file: string) {
  const key = hash(account, file); return readLeases().some((v) => v.provider === provider && v.account === account && v.hashes.includes(key));
}
export function clearAccountLeases(provider: PanProvider, account: string) { writeLeases(readLeases().filter((v) => v.provider !== provider || v.account !== account)); }
export interface CleanupAdapter {
  provider: PanProvider; account: string;
  protectedIds?: string[];
  quota: () => Promise<DiskQuota>;
  candidates: () => Promise<CleanupEntry[]>;
  remove: (entry: CleanupEntry) => Promise<void>;
}
export async function ensureDiskSpace(required: number, adapter: CleanupAdapter, progress?: PanProgressFn): Promise<{ deleted: number; quota: DiskQuota }> {
  progress?.({ stage: 'capacity', message: '正在检查视频大小和网盘剩余空间' });
  let quota = await adapter.quota();
  if (!Number.isFinite(required) || required <= 0) throw new PanError('无法确认视频大小，暂不执行自动清理', 409, 'FILE_SIZE_UNKNOWN');
  if (required > quota.total) throw new PanError(`该文件约 ${(required / 1024 ** 3).toFixed(1)} GiB，超过网盘总容量 ${(quota.total / 1024 ** 3).toFixed(1)} GiB，清理也无法放入，请换较小版本`, 409, 'FILE_EXCEEDS_CAPACITY');
  if (quota.free >= required) return { deleted: 0, quota };
  if (!autoCleanupEnabled(adapter.provider, adapter.account)) throw new PanError('网盘空间不足，当前账号未开启自动清理，可在网盘连接管理中设置', 409, 'CAPACITY');
  progress?.({ stage: 'cleaning', message: '空间不足，正在清理网盘旧资源和回收站', deleted: 0 });
  const candidates = await adapter.candidates(); let deleted = 0;
  const unique = [...new Map(candidates.map((e) => [(e.drive || '') + ':' + e.id, e])).values()].sort((a, b) => a.priority - b.priority || a.modified - b.modified);
  for (const entry of unique.slice(0, 200)) {
    if (adapter.protectedIds?.includes(entry.id) || storageProtected(adapter.provider, adapter.account, entry.id)) continue;
    const before = quota.used; await adapter.remove(entry); deleted++;
    progress?.({ stage: 'cleaning', message: `正在清理网盘空间 · 已处理 ${deleted} 项旧资源`, deleted });
    quota = await adapter.quota();
    if (quota.free >= required) return { deleted, quota };
    // Capacity can lag deletion. Poll briefly; never keep deleting large files against a stale quota.
    if (entry.size > 0 && quota.used >= before) {
      for (const delay of [350, 700]) { await new Promise((r) => setTimeout(r, delay)); quota = await adapter.quota(); if (quota.used < before) break; }
      if (quota.free >= required) return { deleted, quota };
      if (quota.used >= before) throw new PanError('旧资源已清理，网盘仍在更新容量，请稍后再点播放；不会继续盲目清空', 409, 'CAPACITY_UPDATING');
    }
  }
  throw new PanError('可清理的旧资源已处理，但空间仍不足；正在播放的文件会保留，请结束其他播放或换较小版本', 409, 'CAPACITY_PROTECTED');
}
