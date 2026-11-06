import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudVault } from './cloud-vault';
import { prepareJob, prepareStream } from './netdisk-prepare';
import { externalTicket, readExternalTicket } from './netdisk-external';
import { playAliFile } from './alipan-server';
vi.mock('./alipan-server', () => ({ playAliFile: vi.fn() }));
vi.mock('./quark-server', () => ({ playQuarkFile: vi.fn() }));
let dir: string;
const request = () => new Request('https://cinema.test/api/netdisk/prepare', { headers: { cookie: 'ltv_session=browser-one' } });
const vault = () => new CloudVault<{ id: string }>(dir, 'ab'.repeat(32), 'alipan-credentials.enc');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jjbi-prepare-')); vi.stubEnv('LIBRARY_DATA_DIR', dir); vi.stubEnv('CLOUD_ENCRYPTION_KEY', 'ab'.repeat(32)); vault().write({ id: dir }); });
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
describe('play preparation and external playback', () => {
  it('replays the same completed preparation without repeating the cloud mutation', async () => {
    vi.mocked(playAliFile).mockImplementation(async (_r, _k, _save, progress) => { progress?.({ stage: 'cleaning', message: '正在清理网盘空间', deleted: 1 }); return { qualities: [{ label: 'original', url: '/api/alipan/media?id=01234567890123456789', kind: 'video', original: true }], saved: true }; });
    const input = { provider: 'aliyun' as const, key: 'file1', replaceLease: '', operation: 'replay-' + dir.replace(/\W/g, '') };
    const job = prepareJob(request(), input); const first = await prepareStream(job, new AbortController().signal).text();
    expect(first).toContain('cleaning'); expect(first).toContain('ready');
    expect(await prepareStream(prepareJob(request(), input), new AbortController().signal).text()).toBe(first); expect(playAliFile).toHaveBeenCalledTimes(1);
    expect(() => prepareJob(request(), { ...input, key: 'different' })).toThrow('已变更');
  });
  it('does not cancel the cloud mutation when a browser stream disconnects', async () => {
    let complete!: () => void; vi.mocked(playAliFile).mockImplementation(async () => { await new Promise<void>((r) => { complete = r; }); return { qualities: [], saved: true }; });
    const job = prepareJob(request(), { provider: 'aliyun', key: 'f', replaceLease: '', operation: 'disconnect-' + dir.replace(/\W/g, '') });
    const c = new AbortController(); const stream = prepareStream(job, c.signal); c.abort(); await stream.text(); complete(); await vi.waitFor(() => expect(job.done).toBe(true)); expect(job.events.at(-1)?.type).toBe('ready');
  });
  it('binds external bearer links to their current cloud connection and expiry', () => {
    const token = externalTicket('aliyun', '01234567890123456789'); expect(readExternalTicket(token).provider).toBe('aliyun');
    expect(() => readExternalTicket(token.slice(0, -2) + 'xx')).toThrow('无效');
    vault().write({ id: 'new-connection' }); expect(() => readExternalTicket(token)).toThrow('过期');
  });
  it('expires external tickets and rejects arbitrary media identifiers', () => {
    const token = externalTicket('aliyun', '01234567890123456789'); const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 4 * 60 * 60_000 + 1);
    try { expect(() => readExternalTicket(token)).toThrow('过期'); } finally { vi.restoreAllMocks(); }
    expect(() => externalTicket('aliyun', '../private')).toThrow();
  });
});
