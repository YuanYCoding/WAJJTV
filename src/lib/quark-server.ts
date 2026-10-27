import { createHash, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { CloudVault } from './cloud-vault';
import { PanError, isVideoFile, idValue, mergeCookies, parseQuarkShare, plainText } from './netdisk-utils';
import { checkUpstreamAllowed } from './ssrf';
import { autoCleanupEnabled, diskQuota, ensureDiskSpace, startPlaybackLease, storageProtected, clearAccountLeases, setAutoCleanup, type CleanupAdapter, type CleanupEntry } from './netdisk-storage';
import { canDeliverDirect, directMediaResponse, preferDirectMedia } from './netdisk-delivery';
import type { PanFile, PanListing, PanQuality, PanPlayback, PanProgressFn } from './netdisk-types';

interface QuarkAccount { id: string; cookie: string; name: string; folder?: string; saved: Record<string, string>; tasks?: Record<string, string> }
interface Login { token: string; owner: string; expires: number; polling?: Promise<{ connected: boolean; expired?: boolean }> }
interface FileRef { fid: string; token: string; name: string; folder: boolean; size: number; share: ReturnType<typeof parseQuarkShare>; parent: string; page: number; owner: string; expires: number; ancestors?: string[]; width?: number; height?: number }
interface Media { url: string; account: string; expires: number; kind: 'hls' | 'video' }
interface Registry { logins: Map<string, Login>; files: Map<string, FileRef>; media: Map<string, Media>; playback: Map<string, Promise<PanPlayback>>; mediaIndex?: Map<string, string>; prunedAt?: number }
const root = globalThis as typeof globalThis & { __jjbiQuark?: Registry };
const registry: Registry = root.__jjbiQuark ??= { logins: new Map(), files: new Map(), media: new Map(), playback: new Map() };
const DRIVE = 'https://drive-pc.quark.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const owner = (req: Request) => createHash('sha256').update(req.headers.get('cookie')?.match(/(?:^|;\s*)ltv_session=([^;]+)/)?.[1] || '').digest('hex');
export const quarkVault = () => new CloudVault<QuarkAccount>(process.env.LIBRARY_DATA_DIR || './data', process.env.CLOUD_ENCRYPTION_KEY || '', 'quark-credentials.enc');
const account = () => { const value = quarkVault().read(); if (!value) throw new PanError('请先用夸克 App 扫码连接', 409, 'LOGIN_REQUIRED'); return value; };

async function readJson(res: Response) {
  const reader = res.body?.getReader(); if (!reader) throw new PanError('夸克返回空响应', 502);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new PanError('夸克返回数据过大', 502); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
  catch { throw new PanError('夸克接口暂时未返回有效数据，请稍后重试', 502); }
}
async function official(url: string, cookie = '', body?: object) {
  const host = new URL(url).hostname;
  if (!['uop.quark.cn', 'pan.quark.cn', 'drive-pc.quark.cn', 'drive.quark.cn'].includes(host)) throw new PanError('无效的夸克请求');
  let res: Response;
  try { res = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'User-Agent': UA, Referer: 'https://pan.quark.cn/', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(12_000), cache: 'no-store' }); }
  catch { throw new PanError('暂时连接不上夸克，请稍后重试', 502); }
  const nextCookie = mergeCookies(cookie, res.headers.getSetCookie());
  const data = await readJson(res);
  return { data, cookie: nextCookie, setCookies: res.headers.getSetCookie(), status: res.status };
}
function requireSuccess(data: Record<string, unknown>, status: number) {
  const code = Number(data.code ?? 0);
  if (status < 400 && (code === 0 || code === 200)) return;
  if (status === 401 || /未登录|请先?登录|登录失效|登录状态/.test(String(data.message))) throw new PanError('夸克登录已失效，请重新扫码', 409, 'LOGIN_REQUIRED');
  if ([41031, 41012].includes(code) || /取消了分享|分享者.*封禁/.test(String(data.message))) throw new PanError('该分享已失效或被夸克限制，请换一个资源', 410, 'SHARE_UNAVAILABLE');
  // Quark's own share client defines 41020 as FID_TOKEN_EXPIRED and 41016 as STOKEN_EXPIRED.
  if ([41016, 41020].includes(code)) throw new PanError('分享文件的访问凭证已过期，请重新打开目录后播放', 409, 'SHARE_TOKEN_EXPIRED');
  if ([41007, 41008].includes(code)) throw new PanError('分享需要正确的提取码', 409, 'PASSCODE_REQUIRED');
  if (/提取码|密码/.test(String(data.message))) throw new PanError('分享需要正确的提取码', 409, 'PASSCODE_REQUIRED');
  if (/空间|容量/.test(String(data.message))) throw new PanError('夸克网盘空间不足，请先整理空间', 409, 'CAPACITY');
  if (/会员|权益|权限/.test(String(data.message))) throw new PanError('当前账号暂不支持这条播放线路，可尝试其他画质或在夸克中打开', 403, 'ACCOUNT_LIMIT');
  throw new PanError(`夸克暂未完成请求（状态 ${Number.isFinite(code) ? code : status}），请稍后重试`, 502);
}
async function drive(path: string, value?: QuarkAccount, body?: object, query: Record<string, string> = {}) {
  if (value) {
    const current = quarkVault().read();
    if (!current || current.id !== value.id) throw new PanError('夸克连接已更改，请刷新后重试', 409);
    value.cookie = current.cookie;
  }
  const url = DRIVE + '/1/clouddrive/' + path + '?' + new URLSearchParams({ pr: 'ucpro', fr: 'pc', uc_param_str: '', ...query });
  const result = await official(url, value?.cookie, body);
  if (value && result.setCookies.length) {
    const current = quarkVault().read();
    if (!current || current.id !== value.id) throw new PanError('夸克连接已更改，请刷新后重试', 409);
    current.cookie = mergeCookies(current.cookie, result.setCookies);
    quarkVault().write(current, current.id); value.cookie = current.cookie;
  }
  try { requireSuccess(result.data, result.status); }
  catch (e) { console.warn('[quark] request rejected', { phase: path, status: result.status, code: Number(result.data.code) || 0 }); throw e; }
  const data = result.data.data;
  return (Array.isArray(data) ? data : { ...(data as Record<string, unknown>), __metadata: result.data.metadata }) as Record<string, unknown> | Record<string, unknown>[];
}
export function quarkStatus() {
  const vault = quarkVault(); if (!vault.configured) return { configured: false, connected: false };
  const value = vault.read(); return { configured: true, connected: Boolean(value), name: value?.name, autoCleanup: autoCleanupEnabled('quark', value?.id) };
}
export function setQuarkCleanup(enabled: boolean) { return setAutoCleanup('quark', account().id, enabled); }
export async function startQuarkLogin(req: Request) {
  if (!quarkVault().configured) throw new PanError('网盘加密配置尚未就绪', 503);
  const result = await official('https://uop.quark.cn/cas/ajax/getTokenForQrcodeLogin?' + new URLSearchParams({ client_id: '532', v: '1.2', request_id: randomUUID() }));
  const data = result.data.data as { members?: { token?: string } } | undefined;
  const token = data?.members?.token;
  if (result.data.status !== 2000000 || !token) throw new PanError('无法生成夸克二维码，请稍后重试', 502);
  const url = 'https://su.quark.cn/4_eMHBJ?' + new URLSearchParams({ token, client_id: '532', ssb: 'weblogin', uc_param_str: '', uc_biz_str: 'S:custom|OPT:SAREA@0|OPT:IMMERSIVE@1|OPT:BACK_BTN_STYLE@0' });
  const id = randomUUID(); const expires = Date.now() + 120_000;
  registry.logins.clear(); registry.logins.set(id, { token, owner: owner(req), expires });
  return { id, expires, qr: await QRCode.toDataURL(url, { width: 260, margin: 2, errorCorrectionLevel: 'M' }) };
}
export async function pollQuarkLogin(req: Request, id: string) {
  const login = registry.logins.get(id);
  if (!login || login.owner !== owner(req) || login.expires < Date.now()) return { connected: false, expired: true };
  if (login.polling) return login.polling;
  login.polling = (async () => {
    const result = await official('https://uop.quark.cn/cas/ajax/getServiceTicketByQrcodeToken?' + new URLSearchParams({ client_id: '532', v: '1.2', token: login.token, request_id: randomUUID() }));
    const data = result.data.data as { members?: { service_ticket?: string } } | undefined;
    const ticket = data?.members?.service_ticket;
    if (!ticket) return { connected: false };
    const info = await official('https://pan.quark.cn/account/info?' + new URLSearchParams({ st: ticket, lw: 'scan' }));
    const user = info.data.data as Record<string, unknown> | undefined;
    let cookie = info.cookie;
    if (!/__puus=/.test(cookie)) {
      const setup = await official(DRIVE + '/1/clouddrive/file/sort?pr=ucpro&fr=pc&uc_param_str=&pdir_fid=0&_page=1&_size=1', cookie);
      cookie = setup.cookie;
    }
    if (!/__puus=/.test(cookie)) {
      const extra = await official(DRIVE + '/1/clouddrive/member?pr=ucpro&fr=pc&uc_param_str=&fetch_subscribe=true', cookie);
      cookie = extra.cookie;
    }
    if (!/__pus=/.test(cookie) || !/__puus=/.test(cookie)) throw new PanError('夸克尚未完成登录，请重新扫码确认', 409);
    if (registry.logins.get(id) !== login) throw new PanError('二维码已被更新，请重新扫码', 409);
    quarkVault().write({ id: randomUUID(), cookie, name: plainText(user?.nickname || user?.nickName || '夸克网盘', 80), saved: {}, tasks: {} });
    registry.logins.clear(); registry.media.clear(); return { connected: true };
  })().finally(() => { login.polling = undefined; });
  return login.polling;
}
export function disconnectQuark() { const a = quarkVault().configured ? quarkVault().read() : null; if (a) try { clearAccountLeases('quark', a.id); } catch { /* Logout must still revoke credentials if the lease journal is unreadable. */ } registry.logins.clear(); registry.media.clear(); registry.mediaIndex?.clear(); registry.files.clear(); quarkVault().clear(); return { connected: false }; }

async function shareToken(share: ReturnType<typeof parseQuarkShare>, value?: QuarkAccount) {
  const data = await drive('share/sharepage/token', value, { pwd_id: share.id, passcode: share.passcode }) as Record<string, unknown>;
  if (typeof data.stoken !== 'string') throw new PanError('分享未提供有效访问凭证', 502);
  return data.stoken;
}
export async function listQuarkShare(req: Request, raw: string, passcode = '', parentKey = '', page = 1): Promise<PanListing> {
  const share = parseQuarkShare(raw, passcode); let parent = '0'; let ancestors: string[] = [];
  if (!Number.isInteger(page) || page < 1 || page > 500) throw new PanError('分页参数无效');
  if (parentKey) {
    const ref = registry.files.get(parentKey);
    if (!ref || !ref.folder || ref.owner !== owner(req) || ref.share.id !== share.id || ref.expires < Date.now()) throw new PanError('目录已过期，请重新打开分享', 409);
    parent = ref.fid;
    ancestors = [...(ref.ancestors || []), ref.fid];
  }
  const value = quarkVault().read() || undefined;
  const stoken = await shareToken(share, value);
  const data = await drive('share/sharepage/detail', value, undefined, { pwd_id: share.id, stoken, pdir_fid: parent, _page: String(page), _size: '100', _fetch_total: '1', _sort: 'file_type:asc,file_name:asc' }) as Record<string, unknown>;
  const list = Array.isArray(data.list) ? data.list as Record<string, unknown>[] : [];
  for (const [key, ref] of registry.files) if (ref.expires < Date.now()) registry.files.delete(key);
  if (registry.files.size > 5000) throw new PanError('打开的目录较多，请稍后重试', 429);
  const items: PanFile[] = [];
  for (const file of list) {
    const folder = file.file_type === 0 || file.dir === true;
    const name = plainText(file.file_name, 300);
    if (!folder && !isVideoFile(name)) continue;
    const key = randomUUID(); const video = file.video_info as Record<string, unknown> | undefined;
    const ref: FileRef = { fid: idValue(file.fid), token: String(file.share_fid_token || ''), name, folder, size: Number(file.size) || 0, share, parent, page, owner: owner(req), ancestors, expires: Date.now() + 8 * 60 * 60_000, width: Number(video?.width) || undefined, height: Number(video?.height) || undefined };
    const identity = createHash('sha256').update(share.id + ':' + ref.fid).digest('hex').slice(0, 32);
    registry.files.set(key, ref); items.push({ key, identity, name, folder, size: ref.size, width: ref.width, height: ref.height });
  }
  const rawTotal = Number((data.__metadata as Record<string, unknown> | undefined)?._total ?? data.total);
  const total = Number.isFinite(rawTotal) ? rawTotal : (page - 1) * 100 + list.length;
  return { title: plainText((data.share as Record<string, unknown> | undefined)?.title || '分享目录'), items, total, hasMore: Number.isFinite(rawTotal) ? total > page * 100 : list.length === 100, page, shareUrl: share.url };
}
function persist(value: QuarkAccount) {
  const current = quarkVault().read();
  if (!current || current.id !== value.id) throw new PanError('夸克连接已更改，请刷新后重试', 409);
  value.cookie = current.cookie;
  if (!quarkVault().write(value, value.id)) throw new PanError('夸克连接已更改，请刷新后重试', 409);
}
async function freshShareFile(value: QuarkAccount, ref: FileRef) {
  // A file token from anonymous browsing (or a previous login) cannot be used for this account's save.
  // Refresh stoken and share_fid_token together, using the same account and original directory/page.
  const stoken = await shareToken(ref.share, value);
  const data = await drive('share/sharepage/detail', value, undefined, { pwd_id: ref.share.id, stoken, pdir_fid: ref.parent, _page: String(ref.page), _size: '100', _fetch_total: '1', _sort: 'file_type:asc,file_name:asc' }) as { list?: Record<string, unknown>[] };
  const file = data.list?.find((f) => f.fid === ref.fid);
  if (!file || file.file_type === 0 || file.dir === true) throw new PanError('这集在分享目录中已变动，请重新打开目录选择', 409, 'FILE_CHANGED');
  if (typeof file.share_fid_token !== 'string' || !file.share_fid_token) throw new PanError('夸克未提供这集的转存凭证，请重新打开目录或在夸克中查看', 409, 'SHARE_TOKEN_EXPIRED');
  return { stoken, token: file.share_fid_token };
}
function fileReference(req: Request, key: string) {
  const ref = registry.files.get(key);
  if (!ref || ref.owner !== owner(req) || ref.expires < Date.now() || ref.folder) throw new PanError('文件列表已过期，请重新打开分享', 409);
  return ref;
}
export async function previewQuarkFile(req: Request, key: string): Promise<PanPlayback> {
  const ref = fileReference(req, key); const value = account();
  const fresh = await freshShareFile(value, ref);
  const data = await drive('share/sharepage/video_preview', value, undefined, { pwd_id: ref.share.id, stoken: fresh.stoken, fid: ref.fid, fid_token: fresh.token, format: 'png' }) as Record<string, unknown>;
  const info = data.play_info as Record<string, unknown> | undefined;
  if (data.accessable === false || !info || typeof info.url !== 'string' || !info.url.startsWith('https://')) throw new PanError('夸克暂未提供这集的免转存播放线路。可以在夸克中查看，或自行选择「转存后播放」', 409, 'PREVIEW_UNAVAILABLE');
  const current = account();
  if (current.id !== value.id) throw new PanError('夸克连接已更改，请刷新后重试', 409);
  const width = Number(info.width) || undefined; const height = Number(info.height) || undefined;
  const kind = /m3u8/i.test(String(info.format)) || /\.m3u8(?:[?#]|$)/i.test(info.url) ? 'hls' : 'video';
  const sourceDuration = Number(data.duration) || undefined;
  const url = issueQuarkMedia(info.url, value.id, kind);
  // The preview API can report the full source duration while its actual HLS contains only two minutes.
  // Never use play_info.duration to promise full playback or automatically transfer after the preview.
  let duration: number | undefined;
  if (kind === 'hls') {
    const manifest = await quarkMedia(new Request(req.url, { signal: req.signal }), new URL(url, req.url).searchParams.get('id')!);
    const text = await manifest.text();
    const parts = [...text.matchAll(/^#EXTINF:([\d.]+)/gm)].map((m) => Number(m[1]));
    if (text.includes('#EXT-X-ENDLIST') && parts.length) duration = Math.round(parts.reduce((sum, n) => sum + n, 0));
  }
  return { qualities: [{ label: `免转存试看${height ? ` · ${height}P` : ''}`, kind, width, height, url }], saved: false, duration, sourceDuration, limited: true };
}
async function saveShareFile(value: QuarkAccount, ref: FileRef, mapping: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const fresh = await freshShareFile(value, ref);
    value.tasks![mapping] = 'uncertain'; persist(value);
    try {
      const saved = await drive('share/sharepage/save', value, { fid_list: [ref.fid], fid_token_list: [fresh.token], to_pdir_fid: value.folder, pwd_id: ref.share.id, stoken: fresh.stoken, pdir_fid: ref.parent, scene: 'link' }) as Record<string, unknown>;
      if (typeof saved.task_id !== 'string' || !/^[A-Za-z\d_-]{1,128}$/.test(saved.task_id)) throw new PanError('夸克已接收转存，但未返回任务编号，请先在夸克确认结果', 502, 'TRANSFER_UNCERTAIN');
      const task = idValue(saved.task_id); value.tasks![mapping] = task; persist(value); return task;
    } catch (e) {
      // Only an explicit provider rejection permits another write. Timeouts remain uncertain.
      if (e instanceof PanError && e.status < 500) { delete value.tasks![mapping]; persist(value); }
      if (e instanceof PanError && e.code === 'SHARE_TOKEN_EXPIRED' && attempt === 0) continue;
      throw e;
    }
  }
  throw new PanError('分享凭证仍未刷新，请重新打开目录', 409, 'SHARE_TOKEN_EXPIRED');
}
export function quarkStorageAdapter(value = account()): CleanupAdapter {
  const list = async (parent = '0', recycle = false) => {
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; page <= 8; page++) { const d = await drive(recycle ? 'file/recycle/list' : 'file/sort', value, undefined, { pdir_fid: parent, _page: String(page), _size: '100', _fetch_total: '1', _sort: 'updated_at:asc' }) as { list?: Record<string, unknown>[]; __metadata?: { _total?: number } }; const items = d.list || []; rows.push(...items); if (items.length < 100 || rows.length >= Number(d.__metadata?._total)) break; }
    return rows;
  };
  const waitTask = async (data: Record<string, unknown>) => {
    if (!data.task_id) return;
    for (let n = 0; n < 8; n++) { const t = await drive('task', value, undefined, { task_id: idValue(data.task_id), retry_index: String(n) }) as Record<string, unknown>; if (Number(t.status) === 2) return; if (Number(t.status) === 3) throw new PanError('夸克清理失败，请稍后重试', 409); await new Promise((r) => setTimeout(r, 300)); }
    throw new PanError('夸克仍在清理，请稍后重试', 409, 'CLEANUP_PENDING');
  };
  return {
    provider: 'quark', account: value.id,
    quota: async () => { const v = await drive('member', value, undefined, { fetch_subscribe: 'false', fetch_identity: 'false' }) as Record<string, unknown>; return diskQuota(v.total_capacity, v.use_capacity); },
    candidates: async () => {
      const out: CleanupEntry[] = [], roots = await list();
      const add = (rows: Record<string, unknown>[], parent: string, priority: number, recycle = false) => { for (const v of rows) if (v.fid && v.fid !== value.folder) out.push({ id: idValue(v.fid), parent, size: Number(v.size) || 0, modified: Number(v.updated_at || v.created_at) || 0, priority, recycle, record: textRecord(v.record_id) }); };
      if (value.folder && roots.some((v) => v.fid === value.folder)) add(await list(value.folder), value.folder, 1);
      add(roots, '0', 2); add(await list('0', true), '0', 0, true); return out;
    },
    remove: async (entry) => {
      if (storageProtected('quark', value.id, entry.id)) throw new PanError('该文件正在播放，已保留', 409, 'FILE_ACTIVE');
      let record = entry.record;
      if (!entry.recycle) { const deleted = await drive('file/delete', value, { action_type: 2, filelist: [idValue(entry.id)], exclude_fids: [] }) as Record<string, unknown>; await waitTask(deleted); record = textRecord((await list('0', true)).find((v) => v.fid === entry.id)?.record_id); }
      const latest = account(); if (latest.id !== value.id) throw new PanError('网盘账号已更改', 409);
      for (const [key, fid] of Object.entries(latest.saved)) if (fid === entry.id) delete latest.saved[key]; quarkVault().write(latest, latest.id); value.saved = latest.saved;
      if (record) await waitTask(await drive('file/recycle/remove', value, { select_mode: 2, record_list: [idValue(record)] }) as Record<string, unknown>);
    },
  };
}
const textRecord = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
async function playback(value: QuarkAccount, ref: FileRef, progress?: PanProgressFn): Promise<PanPlayback> {
  const mapping = ref.share.id + ':' + ref.fid;
  let fid = value.saved[mapping]; let cleaned = 0;
  if (!fid) {
    if (value.tasks?.[mapping] === 'uncertain') throw new PanError('上次转存结果暂未确认，请先在夸克查看「JjBiTV 追剧」目录，避免重复占用空间', 409, 'TRANSFER_UNCERTAIN');
    if (!value.tasks?.[mapping]) cleaned = (await ensureDiskSpace(ref.size, { ...quarkStorageAdapter(value), protectedIds: [ref.fid, ...(ref.ancestors || [])] }, progress)).deleted;
    progress?.({ stage: 'saving', message: '空间已就绪，正在转存选中的视频' });
    if (!value.folder) {
      const folders = await drive('file/sort', value, undefined, { pdir_fid: '0', _page: '1', _size: '100', _sort: 'file_type:asc,file_name:asc' }) as { list?: Record<string, unknown>[] };
      const existing = folders.list?.find((f) => f.file_name === 'JjBiTV 追剧' && f.file_type === 0);
      if (existing) value.folder = idValue(existing.fid);
      else {
        const created = await drive('file', value, { pdir_fid: '0', file_name: 'JjBiTV 追剧', dir_path: '', dir_init_lock: false }) as Record<string, unknown>;
        value.folder = idValue(created.fid);
      }
      persist(value);
    }
    value.tasks ??= {};
    let task = value.tasks[mapping];
    if (task === 'uncertain') throw new PanError('上次转存结果暂未确认，请先在夸克查看「JjBiTV 追剧」目录，避免重复占用空间', 409, 'TRANSFER_UNCERTAIN');
    if (!task) task = await saveShareFile(value, ref, mapping);
    for (let i = 0; i < 8; i++) {
      const result = await drive('task', value, undefined, { task_id: task, retry_index: String(i) }) as Record<string, unknown>;
      const saveAs = result.save_as as { save_as_top_fids?: string[] } | undefined;
      if (saveAs?.save_as_top_fids?.[0]) { fid = idValue(saveAs.save_as_top_fids[0]); value.saved[mapping] = fid; delete value.tasks[mapping]; persist(value); break; }
      if (Number(result.status) === 3) { delete value.tasks[mapping]; persist(value); throw new PanError('夸克转存失败，请重新打开分享后重试', 409); }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!fid) throw new PanError('夸克仍在转存，再次点击会继续检查，不会重复转存', 409, 'TRANSFER_PENDING');
  }
  progress?.({ stage: 'resolving', message: '正在获取原文件地址和完整转码画质' });
  const [transcoded, original] = await Promise.allSettled([
    drive('file/v2/play', value, { fid, resolutions: 'normal,low,high,super,2k,4k', supports: 'fmp4,m3u8' }),
    drive('file/download', value, { fids: [fid] }),
  ]);
  const qualities: PanQuality[] = [];
  if (transcoded.status === 'fulfilled') {
    const data = transcoded.value as { video_list?: Record<string, unknown>[] };
    const labels: Record<string, string> = { normal: '转码标清', low: '转码流畅', high: '转码高清', super: '转码超清', '2k': '转码 2K', '4k': '转码 4K' };
    for (const row of data.video_list || []) {
      if (row.accessable === false) continue;
      const info = row.video_info as Record<string, unknown> | undefined;
      const url = info?.url || row.url;
      if (typeof url !== 'string' || !url.startsWith('https://')) continue;
      const kind = /\.m3u8(?:[?#]|$)/i.test(url) || /m3u8/i.test(String(info?.format || row.format)) ? 'hls' : 'video';
      const height = Number(info?.height) || undefined;
      try { qualities.push({ label: `${labels[String(row.resolution)] || '平台转码'}${height ? ` · ${height}P` : ''}`, url: issueQuarkMedia(url, value.id, kind), kind, width: Number(info?.width) || undefined, height }); } catch { /* Unrecognized upstream host is not exposed. */ }
    }
    qualities.sort((a, b) => (b.height || 0) - (a.height || 0));
  }
  if (original.status === 'fulfilled') {
    const download = original.value as Record<string, unknown>[]; const url = download?.[0]?.download_url;
    if (typeof url === 'string') qualities.push({ label: '原画 · 原文件', url: issueQuarkMedia(url, value.id, 'video') + '&direct=1&original=1', kind: 'video', original: true, container: ref.name.split('.').pop()?.toLowerCase(), width: ref.width, height: ref.height });
  }
  if (!qualities.length) throw new PanError('夸克暂未提供可用播放地址，可能受格式、转码状态或账号权益限制，请稍后重试或在夸克 App 查看', 409);
  const payload = transcoded.status === 'fulfilled' ? transcoded.value as { meta?: { width?: number; height?: number; size?: number }; video_list?: Record<string, unknown>[] } : undefined;
  const unavailable = (payload?.video_list || []).filter((v) => v.accessable === false).map((v) => ({ '4k': '4K', super: '超清', high: '高清' }[String(v.resolution)] || String(v.resolution)));
  return { qualities, saved: true, cleaned, original: { width: Number(payload?.meta?.width) || ref.width, height: Number(payload?.meta?.height) || ref.height, size: ref.size }, unavailable, notice: unavailable.length ? '原文件画质与网页可播画质不同。夸克未向当前网页连接开放部分高清线路，可在夸克 App 中查看。' : undefined };
}
export async function playQuarkFile(req: Request, key: string, progress?: PanProgressFn) {
  const ref = fileReference(req, key);
  const value = account(); const lock = value.id;
  // Serialize cloud mutations across tabs so folder creation and save mappings cannot overwrite each other.
  progress?.({ stage: 'queued', message: '已加入播放准备队列，正在连接夸克' });
  const previous = registry.playback.get(lock);
  const task = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
    const current = account();
    if (current.id !== value.id) throw new PanError('夸克连接已更改，请刷新后重试', 409);
    const result = await playback(current, ref, progress); return { ...result, lease: startPlaybackLease(req, 'quark', current.id, current.saved[ref.share.id + ':' + ref.fid], [current.folder || '']) };
  });
  registry.playback.set(lock, task);
  try { return await task; } finally { if (registry.playback.get(lock) === task) registry.playback.delete(lock); }
}
function mediaHost(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || !['quark.cn', 'uc.cn', 'ucweb.com', 'aliyuncs.com'].some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) throw new PanError('夸克播放地址不受支持', 502);
  return u;
}
export function issueQuarkMedia(url: string, accountId: string, kind: 'hls' | 'video') {
  mediaHost(url);
  const index = registry.mediaIndex ??= new Map<string, string>(), now = Date.now();
  if (now - (registry.prunedAt || 0) > 60_000) { for (const [id, item] of registry.media) if (item.expires < now) { registry.media.delete(id); index.delete(item.account + '\n' + item.url); } registry.prunedAt = now; }
  const key = accountId + '\n' + url, prior = index.get(key);
  if (prior && (registry.media.get(prior)?.expires || 0) > now) return '/api/netdisk/media?id=' + prior;
  if (registry.media.size > 10_000) throw new PanError('播放请求较多，请稍后重试', 429);
  const id = randomUUID(); registry.media.set(id, { url, account: accountId, kind, expires: Date.now() + 2 * 60 * 60_000 });
  index.set(key, id);
  return '/api/netdisk/media?id=' + id;
}
export function extendQuarkMedia(id: string) { const ticket = registry.media.get(id); if (!ticket || ticket.account !== account().id || ticket.expires < Date.now()) throw new PanError('播放地址已过期，请重新准备', 410); ticket.expires = Date.now() + 4 * 60 * 60_000; }
export async function quarkMedia(req: Request, id: string) {
  const ticket = registry.media.get(id); const value = account();
  if (!ticket || ticket.account !== value.id || ticket.expires < Date.now()) throw new PanError('播放链接已过期，请重新点击播放', 410);
  let url = ticket.url;
  for (let i = 0; i < 4; i++) {
    const target = mediaHost(url); const verdict = await checkUpstreamAllowed(url);
    if (!verdict.ok) throw new PanError('播放地址不可用', 502);
    if (ticket.kind !== 'hls' && new URL(req.url).searchParams.get('direct') === '1' && await canDeliverDirect(url, new URL(req.url).searchParams.get('original') !== '1')) return directMediaResponse(url);
    const headers = new Headers({ 'User-Agent': UA, Referer: 'https://pan.quark.cn/' });
    // Never forward account cookies to unrelated CDN tenants or arbitrary redirects.
    if (target.hostname === 'quark.cn' || target.hostname.endsWith('.quark.cn')) headers.set('Cookie', value.cookie);
    const range = req.headers.get('range'); if (range && /^bytes=\d*-\d*$/.test(range)) headers.set('Range', range);
    const connection = new AbortController(); const timeout = setTimeout(() => connection.abort(), 20_000);
    let res: Response;
    try { res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.any([req.signal, connection.signal]), cache: 'no-store' }); }
    finally { clearTimeout(timeout); }
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.has('location')) { url = new URL(res.headers.get('location')!, url).href; await res.body?.cancel(); continue; }
    if (res.status === 416) { await res.body?.cancel(); return new Response(null, { status: 416, headers: { 'Content-Range': res.headers.get('content-range') || 'bytes */*', 'Cache-Control': 'no-store' } }); }
    if (!res.ok) { await res.body?.cancel(); throw new PanError('夸克播放链接暂不可用，请刷新播放地址', 502); }
    if (/mpegurl/i.test(res.headers.get('content-type') || '') || /\.m3u8(?:[?#]|$)/i.test(url)) {
      const reader = res.body!.getReader(); const parts: Uint8Array[] = []; let length = 0;
      for (;;) { const { done, value: part } = await reader.read(); if (done) break; length += part.length; if (length > 2_000_000) { await reader.cancel(); throw new PanError('播放清单过大', 502); } parts.push(part); }
      const text = Buffer.concat(parts).toString('utf8');
      if (!text.trimStart().startsWith('#EXTM3U')) throw new PanError('播放清单无效', 502);
      const rewrite = (uri: string) => { const playlist = /\.m3u8(?:[?#]|$)/i.test(uri); const path = issueQuarkMedia(new URL(uri, url).href, value.id, playlist ? 'hls' : 'video'); return playlist ? path : preferDirectMedia(path); };
      const body = text.split('\n').map((line) => !line.trim() ? line : line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${rewrite(uri)}"`) : rewrite(line.trim())).join('\n');
      return new Response(body, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, no-store' } });
    }
    const responseHeaders = new Headers({ 'Content-Type': res.headers.get('content-type') || 'video/mp4', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    for (const name of ['content-length', 'content-range', 'accept-ranges']) { const v = res.headers.get(name); if (v) responseHeaders.set(name, v); }
    return new Response(res.body, { status: res.status, headers: responseHeaders });
  }
  throw new PanError('播放重定向次数过多', 502);
}
