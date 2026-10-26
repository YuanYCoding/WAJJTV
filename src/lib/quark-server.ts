import { createHash, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { CloudVault } from './cloud-vault';
import { PanError, idValue, mergeCookies, parseQuarkShare, plainText } from './netdisk-utils';
import { checkUpstreamAllowed } from './ssrf';
import type { PanFile, PanListing, PanQuality } from './netdisk-types';

interface QuarkAccount { id: string; cookie: string; name: string; folder?: string; saved: Record<string, string>; tasks?: Record<string, string> }
interface Login { token: string; owner: string; expires: number; polling?: Promise<{ connected: boolean; expired?: boolean }> }
interface FileRef { fid: string; token: string; name: string; folder: boolean; size: number; share: ReturnType<typeof parseQuarkShare>; parent: string; owner: string; expires: number; width?: number; height?: number }
interface Media { url: string; account: string; expires: number; kind: 'hls' | 'video' }
interface Registry { logins: Map<string, Login>; files: Map<string, FileRef>; media: Map<string, Media>; playback: Map<string, Promise<{ qualities: PanQuality[]; saved: boolean }>> }
const root = globalThis as typeof globalThis & { __jjbiQuark?: Registry };
const registry = root.__jjbiQuark ??= { logins: new Map(), files: new Map(), media: new Map(), playback: new Map() };
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
  if ([41008, 41009].includes(code)) throw new PanError('分享访问凭证或提取码已失效，请重新打开分享', 409, 'SHARE_TOKEN_EXPIRED');
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
  requireSuccess(result.data, result.status);
  const data = result.data.data;
  return (Array.isArray(data) ? data : { ...(data as Record<string, unknown>), __metadata: result.data.metadata }) as Record<string, unknown> | Record<string, unknown>[];
}
export function quarkStatus() {
  const vault = quarkVault(); if (!vault.configured) return { configured: false, connected: false };
  const value = vault.read(); return { configured: true, connected: Boolean(value), name: value?.name };
}
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
export function disconnectQuark() { registry.logins.clear(); registry.media.clear(); registry.files.clear(); quarkVault().clear(); return { connected: false }; }

async function shareToken(share: ReturnType<typeof parseQuarkShare>, value?: QuarkAccount) {
  const data = await drive('share/sharepage/token', value, { pwd_id: share.id, passcode: share.passcode }) as Record<string, unknown>;
  if (typeof data.stoken !== 'string') throw new PanError('分享未提供有效访问凭证', 502);
  return data.stoken;
}
export async function listQuarkShare(req: Request, raw: string, passcode = '', parentKey = '', page = 1): Promise<PanListing> {
  const share = parseQuarkShare(raw, passcode); let parent = '0';
  if (!Number.isInteger(page) || page < 1 || page > 500) throw new PanError('分页参数无效');
  if (parentKey) {
    const ref = registry.files.get(parentKey);
    if (!ref || !ref.folder || ref.owner !== owner(req) || ref.share.id !== share.id || ref.expires < Date.now()) throw new PanError('目录已过期，请重新打开分享', 409);
    parent = ref.fid;
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
    if (!folder && !/\.(mp4|mkv|ts|mov|avi|m4v|webm)$/i.test(name)) continue;
    const key = randomUUID(); const video = file.video_info as Record<string, unknown> | undefined;
    const ref: FileRef = { fid: idValue(file.fid), token: String(file.share_fid_token || ''), name, folder, size: Number(file.size) || 0, share, parent, owner: owner(req), expires: Date.now() + 8 * 60 * 60_000, width: Number(video?.width) || undefined, height: Number(video?.height) || undefined };
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
async function playback(value: QuarkAccount, ref: FileRef) {
  const mapping = ref.share.id + ':' + ref.fid;
  let fid = value.saved[mapping];
  if (!fid) {
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
    if (!task) {
      const stoken = await shareToken(ref.share, value);
      value.tasks[mapping] = 'uncertain'; persist(value);
      try {
        const saved = await drive('share/sharepage/save', value, { fid_list: [ref.fid], fid_token_list: [ref.token], to_pdir_fid: value.folder, pwd_id: ref.share.id, stoken, pdir_fid: ref.parent, scene: 'link' }) as Record<string, unknown>;
        task = idValue(saved.task_id); value.tasks[mapping] = task; persist(value);
      } catch (e) {
        // A timeout can occur after the provider saved the file. Do not blindly repeat that write.
        if (e instanceof PanError && e.status < 500) { delete value.tasks[mapping]; persist(value); }
        throw e;
      }
    }
    for (let i = 0; i < 8; i++) {
      const result = await drive('task', value, undefined, { task_id: task, retry_index: String(i) }) as Record<string, unknown>;
      const saveAs = result.save_as as { save_as_top_fids?: string[] } | undefined;
      if (saveAs?.save_as_top_fids?.[0]) { fid = idValue(saveAs.save_as_top_fids[0]); value.saved[mapping] = fid; delete value.tasks[mapping]; persist(value); break; }
      if (Number(result.status) === 3) { delete value.tasks[mapping]; persist(value); throw new PanError('夸克转存失败，请重新打开分享后重试', 409); }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!fid) throw new PanError('夸克仍在转存，再次点击会继续检查，不会重复转存', 409, 'TRANSFER_PENDING');
  }
  const [transcoded, original] = await Promise.allSettled([
    drive('file/v2/play', value, { fid, resolutions: 'normal,low,high,super,2k,4k', supports: 'fmp4,m3u8' }),
    drive('file/download', value, { fids: [fid] }),
  ]);
  const qualities: PanQuality[] = [];
  if (transcoded.status === 'fulfilled') {
    const data = transcoded.value as { video_list?: Record<string, unknown>[] };
    const labels: Record<string, string> = { normal: '转码标清', low: '转码流畅', high: '转码高清', super: '转码超清', '2k': '转码 2K', '4k': '转码 4K' };
    for (const row of data.video_list || []) {
      const info = row.video_info as Record<string, unknown> | undefined;
      const url = info?.url || row.url;
      if (typeof url !== 'string' || !url.startsWith('https://')) continue;
      const kind = /\.m3u8(?:[?#]|$)/i.test(url) || /m3u8/i.test(String(info?.format || row.format)) ? 'hls' : 'video';
      try { qualities.push({ label: labels[String(row.resolution)] || '平台转码', url: issueQuarkMedia(url, value.id, kind), kind, width: Number(info?.width) || undefined, height: Number(info?.height) || undefined }); } catch { /* Unrecognized upstream host is not exposed. */ }
    }
    qualities.sort((a, b) => (b.height || 0) - (a.height || 0));
  }
  if (original.status === 'fulfilled') {
    const download = original.value as Record<string, unknown>[]; const url = download?.[0]?.download_url;
    if (typeof url === 'string') qualities.push({ label: '原文件', url: issueQuarkMedia(url, value.id, 'video'), kind: 'video', width: ref.width, height: ref.height });
  }
  if (!qualities.length) throw new PanError('夸克暂未提供可用播放地址，可能受格式、转码状态或账号权益限制，请稍后重试或在夸克 App 查看', 409);
  return { qualities, saved: true };
}
export async function playQuarkFile(req: Request, key: string) {
  const ref = registry.files.get(key);
  if (!ref || ref.owner !== owner(req) || ref.expires < Date.now() || ref.folder) throw new PanError('文件列表已过期，请重新打开分享', 409);
  const value = account(); const lock = value.id;
  // Serialize cloud mutations across tabs so folder creation and save mappings cannot overwrite each other.
  const previous = registry.playback.get(lock);
  const task = (previous ? previous.catch(() => {}) : Promise.resolve()).then(() => {
    const current = account();
    if (current.id !== value.id) throw new PanError('夸克连接已更改，请刷新后重试', 409);
    return playback(current, ref);
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
  for (const [id, item] of registry.media) if (item.expires < Date.now()) registry.media.delete(id);
  for (const [id, item] of registry.media) if (item.url === url && item.account === accountId) return '/api/netdisk/media?id=' + id;
  if (registry.media.size > 10_000) throw new PanError('播放请求较多，请稍后重试', 429);
  const id = randomUUID(); registry.media.set(id, { url, account: accountId, kind, expires: Date.now() + 2 * 60 * 60_000 });
  return '/api/netdisk/media?id=' + id;
}
export async function quarkMedia(req: Request, id: string) {
  const ticket = registry.media.get(id); const value = account();
  if (!ticket || ticket.account !== value.id || ticket.expires < Date.now()) throw new PanError('播放链接已过期，请重新点击播放', 410);
  let url = ticket.url;
  for (let i = 0; i < 4; i++) {
    const target = mediaHost(url); const verdict = await checkUpstreamAllowed(url);
    if (!verdict.ok) throw new PanError('播放地址不可用', 502);
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
      const rewrite = (uri: string) => issueQuarkMedia(new URL(uri, url).href, value.id, /\.m3u8(?:[?#]|$)/i.test(uri) ? 'hls' : 'video');
      const body = text.split('\n').map((line) => !line.trim() ? line : line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${rewrite(uri)}"`) : rewrite(line.trim())).join('\n');
      return new Response(body, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, no-store' } });
    }
    const responseHeaders = new Headers({ 'Content-Type': res.headers.get('content-type') || 'video/mp4', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    for (const name of ['content-length', 'content-range', 'accept-ranges']) { const v = res.headers.get(name); if (v) responseHeaders.set(name, v); }
    return new Response(res.body, { status: res.status, headers: responseHeaders });
  }
  throw new PanError('播放重定向次数过多', 502);
}
