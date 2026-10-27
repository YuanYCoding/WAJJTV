import { createHash } from 'node:crypto';
import { CloudVault } from './cloud-vault';
import { PanError } from './netdisk-utils';
import { playAliFile } from './alipan-server';
import { playQuarkFile } from './quark-server';
import { touchPlaybackLease } from './netdisk-storage';
import type { PanPrepareEvent, PanProvider } from './netdisk-types';
export interface PrepareJob { signature: string; expires: number; events: PanPrepareEvent[]; listeners: Set<(event: PanPrepareEvent) => void>; done: boolean }
const global = globalThis as typeof globalThis & { __jjbiPrepare?: Map<string, PrepareJob> };
const jobs = global.__jjbiPrepare ??= new Map<string, PrepareJob>();
export function connectionId(provider: PanProvider) {
  const a = new CloudVault<{ id: string }>(process.env.LIBRARY_DATA_DIR || './data', process.env.CLOUD_ENCRYPTION_KEY || '', provider === 'aliyun' ? 'alipan-credentials.enc' : 'quark-credentials.enc').read();
  if (!a) throw new PanError('网盘连接已失效，请重新扫码', 409, 'LOGIN_REQUIRED'); return a.id;
}
export function prepareJob(req: Request, input: { provider: PanProvider; key: string; replaceLease: string; operation: string }): PrepareJob {
  if (!/^[\w-]{16,80}$/.test(input.operation) || !input.key || input.key.length > 128) throw new PanError('播放准备参数无效');
  const account = connectionId(input.provider), owner = createHash('sha256').update(req.headers.get('cookie') || '').digest('hex');
  const id = owner + ':' + input.operation, signature = input.provider + ':' + account + ':' + input.key;
  for (const [key, value] of jobs) if (value.done && value.expires < Date.now()) jobs.delete(key);
  const existing = jobs.get(id); if (existing) { if (existing.signature !== signature) throw new PanError('播放请求已变更，请重新选择视频', 409); return existing; }
  if (jobs.size >= 100 || [...jobs.values()].filter((v) => !v.done).length >= 12) throw new PanError('播放准备请求较多，请稍后重试', 429);
  const job: PrepareJob = { signature, expires: Date.now() + 15 * 60_000, events: [], listeners: new Set(), done: false }; jobs.set(id, job);
  const publish = (event: PanPrepareEvent) => { if (job.events.length >= 64) job.events.splice(0, 1); job.events.push(event); for (const listener of job.listeners) listener(event); };
  void (async () => {
    try {
      if (input.replaceLease) touchPlaybackLease(req, input.replaceLease, true);
      const progress = (value: import('./netdisk-types').PanProgress) => publish({ type: 'progress', value });
      const playback = input.provider === 'aliyun' ? await playAliFile(req, input.key, true, progress) : await playQuarkFile(req, input.key, progress);
      publish({ type: 'ready', playback });
    } catch (e) { publish({ type: 'error', error: e instanceof PanError ? e.message : '播放准备失败，请重试', code: e instanceof PanError ? e.code : undefined }); }
    finally { job.done = true; job.expires = Date.now() + 15 * 60_000; }
  })();
  return job;
}
export function prepareStream(job: PrepareJob, signal: AbortSignal) {
  const encoder = new TextEncoder(); let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false; const heartbeat: { id?: ReturnType<typeof setInterval> } = {};
      const close = () => { if (closed) return; closed = true; clearInterval(heartbeat.id); job.listeners.delete(send); signal.removeEventListener('abort', close); try { controller.close(); } catch { /* disconnected */ } };
      const send = (event: PanPrepareEvent) => { if (closed) return; try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { close(); return; } if (event.type === 'ready' || event.type === 'error') close(); };
      dispose = close;
      for (const event of job.events) { send(event); if (closed) return; }
      if (job.done || signal.aborted) { close(); return; }
      job.listeners.add(send); signal.addEventListener('abort', close, { once: true }); heartbeat.id = setInterval(() => send({ type: 'heartbeat' }), 10_000);
    }, cancel() { dispose(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
}
