import { createHash } from 'node:crypto';
import { isVideoFile, parsePanShare } from './netdisk-utils';
import type { PanProvider } from './netdisk-types';

export interface Discovery { status: 'video' | 'empty' | 'unknown'; sample?: string; visited: number }
export interface ScanPage { files: { id: string; name: string; folder: boolean }[]; next?: string }
export async function scanVideoTree(read: (parent: string, page: string) => Promise<ScanPage>, root: string, signal: AbortSignal, limit = 48): Promise<Discovery> {
  const queue = [{ id: root, depth: 0, page: '' }], seen = new Set<string>(); let visited = 0, truncated = false;
  while (queue.length && visited < limit && !signal.aborted) {
    const row = queue.shift()!, key = row.id + ':' + row.page; if (seen.has(key)) continue; seen.add(key);
    const data = await read(row.id, row.page); visited++;
    const video = data.files.find((f) => !f.folder && isVideoFile(f.name));
    if (video) return { status: 'video', sample: video.name.slice(0, 200), visited };
    if (data.next) queue.push({ ...row, page: data.next });
    for (const f of data.files) if (f.folder && f.id !== row.id) { if (row.depth < 16) queue.push({ id: f.id, depth: row.depth + 1, page: '' }); else truncated = true; }
  }
  return { status: queue.length || truncated || signal.aborted ? 'unknown' : 'empty', visited };
}
const cache = new Map<string, { expires: number; value: Discovery }>();
const pending = new Map<string, Promise<Discovery>>();
const lanes: Record<PanProvider, { active: number; queue: (() => void)[] }> = { aliyun: { active: 0, queue: [] }, quark: { active: 0, queue: [] } };
function drain(slot: typeof lanes[PanProvider]) { while (slot.active < 2 && slot.queue.length) slot.queue.shift()!(); }
async function lane<T>(provider: PanProvider, signal: AbortSignal, run: () => Promise<T>): Promise<T | undefined> {
  if (signal.aborted) return;
  const slot = lanes[provider];
  const acquired = await new Promise<boolean>((resolve) => {
    const begin = () => { signal.removeEventListener('abort', cancel); if (signal.aborted) resolve(false); else { slot.active++; resolve(true); } };
    const cancel = () => { const i = slot.queue.indexOf(begin); if (i >= 0) slot.queue.splice(i, 1); resolve(false); };
    slot.queue.push(begin); signal.addEventListener('abort', cancel, { once: true }); drain(slot);
  });
  if (!acquired) return;
  try { return await run(); } finally { slot.active--; drain(slot); }
}
async function json(url: string, signal: AbortSignal, body?: object, token = ''): Promise<Record<string, unknown>> {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', Referer: url.includes('quark.cn') ? 'https://pan.quark.cn/' : 'https://www.alipan.com/', ...(token ? { 'X-Share-Token': token } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), redirect: 'error', cache: 'no-store' });
  const reader = r.body?.getReader(); if (!reader || !r.ok) { await r.body?.cancel(); throw new Error('Directory unavailable'); }
  const parts: Uint8Array[] = []; let bytes = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 2_000_000) { await reader.cancel(); throw new Error('Directory too large'); } parts.push(value); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export async function discoverPanVideo(raw: string, passcode: string, external: AbortSignal): Promise<Discovery> {
  const share = parsePanShare(raw, passcode), key = createHash('sha256').update(share.url + ':' + share.passcode).digest('hex');
  const cached = cache.get(key); if (cached && cached.expires > Date.now()) return cached.value;
  const existing = pending.get(key); if (existing) return existing;
  const task = (async (): Promise<Discovery> => await lane(share.provider, external, async () => {
    const signal = AbortSignal.any([external, AbortSignal.timeout(15_000)]);
    try {
      let proof: Discovery;
      if (share.provider === 'aliyun') {
        const access = await json('https://api.alipan.com/v2/share_link/get_share_token', signal, { share_id: share.id, share_pwd: share.passcode });
        if (typeof access.share_token !== 'string') throw new Error('Share unavailable');
        proof = await scanVideoTree(async (parent, marker) => {
          const data = await json('https://api.alipan.com/adrive/v3/file/list', signal, { share_id: share.id, parent_file_id: parent, marker, limit: 100, order_by: 'name', order_direction: 'ASC' }, access.share_token as string);
          if (!Array.isArray(data.items)) throw new Error('Invalid directory');
          return { files: data.items.map((f: Record<string, unknown>) => ({ id: String(f.file_id), name: String(f.name || ''), folder: f.type === 'folder' })), next: typeof data.next_marker === 'string' ? data.next_marker : undefined };
        }, 'root', signal);
      } else {
        const base = 'https://drive-pc.quark.cn/1/clouddrive/'; const query = 'pr=ucpro&fr=pc&uc_param_str=';
        const access = await json(base + 'share/sharepage/token?' + query, signal, { pwd_id: share.id, passcode: share.passcode });
        const token = (access.data as Record<string, unknown> | undefined)?.stoken; if (typeof token !== 'string') throw new Error('Share unavailable');
        proof = await scanVideoTree(async (parent, page) => {
          const data = await json(base + 'share/sharepage/detail?' + query + '&' + new URLSearchParams({ pwd_id: share.id, stoken: token, pdir_fid: parent, _page: page || '1', _size: '100', _fetch_total: '1', _sort: 'file_type:asc,file_name:asc' }), signal);
          const value = data.data as Record<string, unknown> | undefined; if (Number(data.code) !== 0 || !Array.isArray(value?.list)) throw new Error('Invalid directory');
          const n = Number(page || 1), total = Number((data.metadata as Record<string, unknown> | undefined)?._total);
          return { files: value.list.map((f: Record<string, unknown>) => ({ id: String(f.fid), name: String(f.file_name || ''), folder: f.file_type === 0 || f.dir === true })), next: Number.isFinite(total) ? total > n * 100 ? String(n + 1) : undefined : value.list.length === 100 ? String(n + 1) : undefined };
        }, '0', signal);
      }
      if (cache.size >= 1500) cache.delete(cache.keys().next().value!);
      cache.set(key, { value: proof, expires: Date.now() + (proof.status === 'video' ? 15 * 60_000 : proof.status === 'empty' ? 5 * 60_000 : 30_000) }); return proof;
    } catch { return { status: 'unknown', visited: 0 }; }
  }) || { status: 'unknown', visited: 0 })();
  pending.set(key, task); try { return await task; } finally { if (pending.get(key) === task) pending.delete(key); }
}
