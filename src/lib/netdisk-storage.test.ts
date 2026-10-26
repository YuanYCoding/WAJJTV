import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diskQuota, ensureDiskSpace, startPlaybackLease, touchPlaybackLease, storageProtected, setAutoCleanup, type CleanupAdapter, type CleanupEntry } from './netdisk-storage';
let dir: string;
const request = (user = 'one') => new Request('https://cinema.test/api/netdisk/session', { headers: { Cookie: 'ltv_session=' + user } });
const entry = (id: string, size: number, priority = 1): CleanupEntry => ({ id, size, priority, modified: 1 });
function adapter(items: CleanupEntry[], used = 90) {
  let current = used;
  const remove = vi.fn(async (v: CleanupEntry) => { current -= v.size; });
  const api: CleanupAdapter = { provider: 'aliyun', account: 'account', quota: vi.fn(async () => diskQuota(100, current)), candidates: vi.fn(async () => items), remove };
  return { api, remove };
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jjbi-space-')); vi.stubEnv('LIBRARY_DATA_DIR', dir); vi.stubEnv('PAN_AUTO_CLEANUP', '1'); setAutoCleanup('aliyun', 'account', true); setAutoCleanup('quark', 'account', true); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
describe('dedicated streaming account capacity cleanup', () => {
  it('handles over-quota accounts and refuses unknown quota values', () => { expect(diskQuota(100, 120).free).toBe(0); expect(() => diskQuota(0, 0)).toThrow(); expect(() => diskQuota(100, NaN)).toThrow(); });
  it('does not enumerate or remove files when capacity is sufficient', async () => { const { api, remove } = adapter([], 10); await ensureDiskSpace(30, api); expect(api.candidates).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); });
  it('refuses a file larger than total capacity before deleting anything', async () => { const { api, remove } = adapter([entry('old', 90)]); await expect(ensureDiskSpace(101, api)).rejects.toMatchObject({ code: 'FILE_EXCEEDS_CAPACITY' }); expect(remove).not.toHaveBeenCalled(); expect(api.candidates).not.toHaveBeenCalled(); });
  it('requires deployment opt-in for automatic destructive cleanup', async () => { vi.stubEnv('PAN_AUTO_CLEANUP', '0'); const { api, remove } = adapter([entry('old', 60)]); await expect(ensureDiskSpace(60, api)).rejects.toMatchObject({ code: 'CAPACITY' }); expect(remove).not.toHaveBeenCalled(); });
  it('does not transfer cleanup consent to a different or newly connected account', async () => { const { api, remove } = adapter([entry('old', 60)]); api.account = 'new-account'; await expect(ensureDiskSpace(60, api)).rejects.toMatchObject({ code: 'CAPACITY' }); expect(remove).not.toHaveBeenCalled(); });
  it('cleans recycled and old app resources first and stops as soon as enough space is available', async () => { const { api, remove } = adapter([entry('other-root', 70, 2), entry('old-app', 35, 1), entry('trash', 10, 0)]); const result = await ensureDiskSpace(50, api); expect(remove.mock.calls.map(([v]) => v.id)).toEqual(['trash', 'old-app']); expect(result).toMatchObject({ deleted: 2, quota: { free: 55 } }); });
  it('protects playing files and their ancestor folders on other devices', async () => { startPlaybackLease(request('other'), 'aliyun', 'account', 'movie', ['album']); const { api, remove } = adapter([entry('album', 80, 0), entry('movie', 60), entry('old', 40)]); await ensureDiskSpace(50, api); expect(remove.mock.calls.map(([v]) => v.id)).toEqual(['old']); });
  it('does not remove an incoming share file or its source folder', async () => { const { api, remove } = adapter([entry('source-folder', 80, 0), entry('source-file', 60), entry('old', 40)]); api.protectedIds = ['source-folder', 'source-file']; await ensureDiskSpace(50, api); expect(remove.mock.calls.map(([v]) => v.id)).toEqual(['old']); });
  it('stops when all remaining data is protected', async () => { startPlaybackLease(request(), 'aliyun', 'account', 'active'); const { api, remove } = adapter([entry('active', 90)]); await expect(ensureDiskSpace(50, api)).rejects.toMatchObject({ code: 'CAPACITY_PROTECTED' }); expect(remove).not.toHaveBeenCalled(); });
  it('does not keep deleting files when provider quota updates are delayed', async () => { vi.useFakeTimers(); const { api, remove } = adapter([entry('first', 60), entry('second', 40)]); api.quota = async () => diskQuota(100, 90); const promise = expect(ensureDiskSpace(50, api)).rejects.toMatchObject({ code: 'CAPACITY_UPDATING' }); await vi.runAllTimersAsync(); await promise; expect(remove).toHaveBeenCalledTimes(1); });
  it('does not retry an uncertain deletion or continue deleting other files', async () => { const { api, remove } = adapter([entry('first', 60), entry('second', 40)]); remove.mockRejectedValueOnce(new Error('response lost')); await expect(ensureDiskSpace(50, api)).rejects.toThrow('response lost'); expect(remove).toHaveBeenCalledTimes(1); });
  it('binds lease release to the browser, expires stale leases, and stores no raw file IDs or session token', () => { vi.useFakeTimers(); const lease = startPlaybackLease(request('secret-browser-token'), 'aliyun', 'account', 'private-file-id'); expect(touchPlaybackLease(request('different'), lease, true)).toEqual({ active: false }); expect(storageProtected('aliyun', 'account', 'private-file-id')).toBe(true); const text = readFileSync(join(dir, 'netdisk-leases.json'), 'utf8'); expect(text).not.toContain('secret-browser-token'); expect(text).not.toContain('private-file-id'); vi.advanceTimersByTime(181000); expect(storageProtected('aliyun', 'account', 'private-file-id')).toBe(false); });
  it('preserves a file while either device still watches it', () => { const one = startPlaybackLease(request('one'), 'quark', 'account', 'movie'); startPlaybackLease(request('two'), 'quark', 'account', 'movie'); touchPlaybackLease(request('one'), one, true); expect(storageProtected('quark', 'account', 'movie')).toBe(true); });
  it('fails closed if the active-playback journal is corrupted', async () => { writeFileSync(join(dir, 'netdisk-leases.json'), 'broken'); const { api, remove } = adapter([entry('old', 90)]); await expect(ensureDiskSpace(50, api)).rejects.toMatchObject({ code: 'LEASE_UNAVAILABLE' }); expect(remove).not.toHaveBeenCalled(); });
});
