import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quarkVault, quarkStorageAdapter } from './quark-server';
import { ensureDiskSpace, setAutoCleanup, startPlaybackLease } from './netdisk-storage';
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'quark-v10-')); vi.stubEnv('LIBRARY_DATA_DIR', dir); vi.stubEnv('CLOUD_ENCRYPTION_KEY', 'ab'.repeat(32)); vi.stubEnv('PAN_AUTO_CLEANUP', '1'); quarkVault().write({ id: 'qa', cookie: 'private', name: 'test', folder: 'app', saved: { 'share:old': 'old' } }); setAutoCleanup('quark', 'qa', true); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
it('reclaims capacity by moving to trash and never calls the failing permanent purge', async () => {
  let used = 90; const paths: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url), path = u.pathname.split('/clouddrive/')[1]; paths.push(path);
    let data: unknown;
    if (path === 'member') data = { total_capacity: 100, use_capacity: used };
    else if (path === 'file/sort') data = { list: u.searchParams.get('pdir_fid') === 'app' ? [{ fid: 'old', size: 70 }] : [{ fid: 'app', file_type: 0 }] };
    else if (path === 'file/delete') { expect(JSON.parse(String(init?.body))).toEqual({ action_type: 2, filelist: ['old'], exclude_fids: [] }); used = 20; data = { task_id: 'task' }; }
    else if (path === 'task') data = { status: 2 };
    else throw new Error('Permanent purge must not be attempted, even if it would return 15000');
    return Response.json({ code: 0, data });
  }));
  const result = await ensureDiskSpace(60, quarkStorageAdapter());
  expect(result).toMatchObject({ deleted: 1, quota: { free: 80 } });
  expect(paths).not.toContain('file/recycle/remove'); expect(paths).not.toContain('file/recycle/list'); expect(quarkVault().read()?.saved).toEqual({});
});
it('keeps active playback protected and stops when Quark capacity has not updated', async () => {
  vi.useFakeTimers(); startPlaybackLease(new Request('https://cinema.test', { headers: { cookie: 'ltv_session=one' } }), 'quark', 'qa', 'active'); const removed: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { const u = new URL(url); let data: unknown;
    if (u.pathname.endsWith('/member')) data = { total_capacity: 100, use_capacity: 90 };
    else if (u.pathname.endsWith('/file/sort')) data = { list: u.searchParams.get('pdir_fid') === 'app' ? [{ fid: 'active', size: 80 }, { fid: 'old', size: 70 }, { fid: 'another', size: 60 }] : [{ fid: 'app' }] };
    else if (u.pathname.endsWith('/file/delete')) { removed.push(JSON.parse(String(init?.body)).filelist[0]); data = {}; }
    else throw new Error('Unexpected purge'); return Response.json({ code: 0, data }); }));
  const p = expect(ensureDiskSpace(60, quarkStorageAdapter())).rejects.toMatchObject({ code: 'CAPACITY_UPDATING' }); await vi.runAllTimersAsync(); await p; expect(removed).toEqual(['old']); vi.useRealTimers();
});
