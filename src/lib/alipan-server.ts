import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import QRCode from 'qrcode';
import { CloudVault } from './cloud-vault';
import { PanError, isVideoFile, idValue, parsePanShare, plainText } from './netdisk-utils';
import { checkUpstreamAllowed } from './ssrf';
import { autoCleanupEnabled, diskQuota, ensureDiskSpace, startPlaybackLease, storageProtected, clearAccountLeases, setAutoCleanup, type CleanupAdapter, type CleanupEntry } from './netdisk-storage';
import { canDeliverDirect, directMediaResponse, preferDirectMedia } from './netdisk-delivery';
import type { PanFile, PanListing, PanPlayback, PanQuality, PanProgressFn } from './netdisk-types';

interface AliAccount { id: string; accessToken: string; refreshToken: string; expires: number; name: string; userId: string; drive: string; folder?: string; saved: Record<string, string>; tasks: Record<string, string>; device?: { id: string; key: string; signature: string } }
interface AliLogin { t: string; ck: string; owner: string; expires: number; polling?: Promise<{ connected: boolean; expired?: boolean }> }
interface AliFile { fid: string; name: string; folder: boolean; size: number; owner: string; expires: number; share?: ReturnType<typeof parsePanShare>; account?: string; drive?: string; ancestors?: string[]; width?: number; height?: number }
interface Ticket { url: string; account: string; expires: number; playlist: boolean }
const root = globalThis as typeof globalThis & { __jjbiAli?: { logins: Map<string, AliLogin>; files: Map<string, AliFile>; media: Map<string, Ticket>; locks: Map<string, Promise<PanPlayback>>; refresh?: Promise<AliAccount>; mediaIndex?: Map<string, string>; prunedAt?: number } };
const registry: NonNullable<typeof root.__jjbiAli> = root.__jjbiAli ??= { logins: new Map(), files: new Map(), media: new Map(), locks: new Map() };
const API = 'https://api.alipan.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const text = (v: unknown) => typeof v === 'string' ? v : '';
const owner = (req: Request) => createHash('sha256').update(req.headers.get('cookie')?.match(/(?:^|;\s*)ltv_session=([^;]+)/)?.[1] || '').digest('hex');
export const aliVault = () => new CloudVault<AliAccount>(process.env.LIBRARY_DATA_DIR || './data', process.env.CLOUD_ENCRYPTION_KEY || '', 'alipan-credentials.enc');
const currentAccount = () => { const a = aliVault().read(); if (!a) throw new PanError('请先用阿里云盘 App 扫码连接', 409, 'LOGIN_REQUIRED'); return a; };
async function bounded(res: Response) {
  const reader = res.body?.getReader(); if (!reader) throw new PanError('阿里云盘返回空响应', 502);
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new PanError('阿里云盘响应过大', 502); } parts.push(value); }
  return Buffer.concat(parts).toString('utf8');
}
class AliReject extends PanError { constructor(public upstream: string) {
  const [message, code, status] = /AccessToken|RefreshToken|Unauthorized/i.test(upstream) ? ['阿里云盘登录已失效，请重新扫码', 'LOGIN_REQUIRED', 409]
    : /ShareLink.*(Cancel|Forbid|NotFound|Expired)|ForbiddenFileInTheShareLink|ShareLinkNotFound/i.test(upstream) ? ['该阿里云盘分享已失效，请换一个资源', 'SHARE_UNAVAILABLE', 410]
    : /ShareLinkPwd|ShareLinkPassword/i.test(upstream) ? ['请输入正确的阿里云盘提取码', 'PASSCODE_REQUIRED', 409]
    : /Quota|Capacity|Space/i.test(upstream) ? ['阿里云盘空间不足，请整理空间后重试', 'CAPACITY', 409]
    : ['阿里云盘暂未允许此操作，请在官方客户端检查文件或账号状态', 'ALI_REJECTED', 409];
  super(String(message), Number(status), String(code));
} }
async function official(url: string, body?: object | URLSearchParams, headers: Record<string, string> = {}) {
  if (!['api.alipan.com', 'auth.alipan.com', 'passport.aliyundrive.com'].includes(new URL(url).hostname)) throw new PanError('阿里云盘地址无效');
  let res: Response;
  try { res = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'User-Agent': UA, Referer: 'https://www.alipan.com/', 'Content-Type': body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json', ...headers }, body: body instanceof URLSearchParams ? body : body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(12_000), cache: 'no-store' }); }
  catch { throw new PanError('暂时连接不上阿里云盘，请稍后重试', 502); }
  if (res.status === 204) return {};
  let data: Record<string, unknown>; try { data = JSON.parse(await bounded(res)); } catch (e) { if (e instanceof PanError) throw e; throw new PanError('阿里云盘返回数据异常', 502); }
  if (data.code || !res.ok) { if (res.status >= 500) throw new PanError('阿里云盘服务暂时异常，请稍后重试', 502); throw new AliReject(text(data.code) || 'HTTP_' + res.status); }
  return data;
}
function persist(a: AliAccount) {
  const latest = currentAccount(); if (latest.id !== a.id) throw new PanError('阿里云盘账号已更改，请刷新', 409);
  a.accessToken = latest.accessToken; a.refreshToken = latest.refreshToken; a.expires = latest.expires; a.device = latest.device;
  if (!aliVault().write(a, a.id)) throw new PanError('阿里云盘账号已更改，请刷新', 409);
}
async function account(force = false): Promise<AliAccount> {
  const a = currentAccount(); if (!force && a.expires > Date.now() + 60_000) return a;
  if (!registry.refresh) registry.refresh = (async () => {
    const data = await official('https://auth.alipan.com/v2/account/token', { refresh_token: a.refreshToken, grant_type: 'refresh_token' });
    if (!text(data.access_token) || !text(data.refresh_token)) throw new PanError('阿里云盘授权已失效，请重新连接', 409, 'LOGIN_REQUIRED');
    const latest = currentAccount(); if (latest.id !== a.id) throw new PanError('账号已更改，请刷新', 409);
    const next = { ...latest, accessToken: text(data.access_token), refreshToken: text(data.refresh_token), expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    aliVault().write(next, a.id); return next;
  })().finally(() => { registry.refresh = undefined; });
  const next = await registry.refresh; if (next.id !== currentAccount().id) throw new PanError('账号已更改，请刷新', 409); return next;
}
async function registerDevice(a: AliAccount) {
  let claims: { app_id?: string }; try { claims = JSON.parse(Buffer.from(a.accessToken.split('.')[1], 'base64url').toString()); } catch { throw new PanError('阿里云盘要求重新验证设备，请重新扫码', 409, 'LOGIN_REQUIRED'); }
  if (!claims.app_id || !a.userId) throw new PanError('阿里云盘缺少设备验证信息，请重新扫码', 409, 'LOGIN_REQUIRED');
  const key = randomBytes(32); const id = randomUUID();
  const digest = createHash('sha256').update(`${claims.app_id}:${id}:${a.userId}:0`).digest();
  const sig = secp256k1.sign(digest, key, { lowS: true });
  const signature = Buffer.concat([Buffer.from(sig.toCompactRawBytes()), Buffer.from([sig.recovery])]).toString('hex');
  await official(API + '/users/v1/users/device/create_session', { deviceName: 'JjBiTV', modelName: 'Web', nonce: 0, pubKey: Buffer.from(secp256k1.getPublicKey(key, false)).toString('hex'), refreshToken: a.refreshToken }, { Authorization: 'Bearer ' + a.accessToken, 'X-Device-Id': id, 'X-Signature': signature });
  const latest = currentAccount(); if (latest.id !== a.id) throw new PanError('账号已更改', 409);
  latest.device = { id, key: key.toString('hex'), signature }; aliVault().write(latest, a.id);
}
async function api(path: string, body: object, a?: AliAccount, shareToken = '', retry = true): Promise<Record<string, unknown>> {
  let value: AliAccount | undefined;
  if (a) { value = await account(); if (value.id !== a.id) throw new PanError('阿里云盘账号已更改，请刷新', 409); }
  try { return await official(API + path, body, { ...(value ? { Authorization: 'Bearer ' + value.accessToken } : {}), ...(value?.device ? { 'X-Device-Id': value.device.id, 'X-Signature': value.device.signature } : {}), ...(shareToken ? { 'X-Share-Token': shareToken } : {}) }); }
  catch (e) {
    if (value && retry && e instanceof AliReject && e.upstream === 'AccessTokenInvalid') { await account(true); return api(path, body, value, shareToken, false); }
    if (value && retry && e instanceof AliReject && e.upstream === 'DeviceSessionSignatureInvalid') { await registerDevice(value); return api(path, body, value, shareToken, false); }
    if (e instanceof AliReject) console.warn('[alipan] request rejected', { path, code: e.upstream });
    throw e;
  }
}
export function aliStatus() { const vault = aliVault(); const a = vault.configured ? vault.read() : null; return { configured: vault.configured, connected: Boolean(a), name: a?.name, autoCleanup: autoCleanupEnabled('aliyun', a?.id) }; }
export function setAliCleanup(enabled: boolean) { return setAutoCleanup('aliyun', currentAccount().id, enabled); }
export async function startAliLogin(req: Request) {
  if (!aliVault().configured) throw new PanError('网盘加密配置尚未就绪', 503);
  const data = await official('https://passport.aliyundrive.com/newlogin/qrcode/generate.do?appName=aliyun_drive&fromSite=52&appEntrance=web');
  const value = (data.content as { data?: { t?: number; ck?: string; codeContent?: string } })?.data;
  if (!value?.t || !value.ck || !value.codeContent || !/^https:\/\/passport\.aliyundrive\.com\//.test(value.codeContent)) throw new PanError('无法生成阿里云盘二维码，请重试', 502);
  const id = randomUUID(), expires = Date.now() + 5 * 60_000; registry.logins.clear(); registry.logins.set(id, { t: String(value.t), ck: value.ck, owner: owner(req), expires });
  return { id, expires, qr: await QRCode.toDataURL(value.codeContent, { width: 260, margin: 2, errorCorrectionLevel: 'M' }) };
}
export async function pollAliLogin(req: Request, id: string) {
  const login = registry.logins.get(id); if (!login || login.owner !== owner(req) || login.expires < Date.now()) return { connected: false, expired: true };
  if (login.polling) return login.polling;
  login.polling = (async () => {
    const data = await official('https://passport.aliyundrive.com/newlogin/qrcode/query.do?appName=aliyun_drive&fromSite=52', new URLSearchParams({ t: login.t, ck: login.ck }));
    const value = (data.content as { data?: { qrCodeStatus?: string; bizExt?: string } })?.data;
    if (['EXPIRED', 'CANCELED'].includes(value?.qrCodeStatus || '')) return { connected: false, expired: true };
    if (value?.qrCodeStatus !== 'CONFIRMED' || !value.bizExt) return { connected: false };
    let user: Record<string, unknown>; const bytes = Buffer.from(value.bizExt, 'base64');
    try { user = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).pds_login_result; }
    catch { try { user = JSON.parse(new TextDecoder('gb18030').decode(bytes)).pds_login_result; } catch { throw new PanError('阿里云盘登录结果无效，请重新扫码', 502); } }
    const refreshToken = text(user?.refreshToken); if (!refreshToken) throw new PanError('阿里云盘未完成授权，请重新扫码', 409);
    const tokens = await official('https://auth.alipan.com/v2/account/token', { refresh_token: refreshToken, grant_type: 'refresh_token' });
    const drive = text(tokens.resource_drive_id) || text(tokens.default_drive_id);
    if (!drive || !text(tokens.access_token) || !text(tokens.refresh_token)) throw new PanError('未获取到阿里云盘资源库，请重新扫码', 502);
    if (registry.logins.get(id) !== login) throw new PanError('二维码已取消或更新，请重新连接', 409);
    aliVault().write({ id: randomUUID(), accessToken: text(tokens.access_token), refreshToken: text(tokens.refresh_token), expires: Date.now() + (Number(tokens.expires_in) || 3600) * 1000, userId: text(tokens.user_id) || text(user.userId), drive: idValue(drive), name: plainText(tokens.nick_name || tokens.user_name || user.nickName || user.userName || '阿里云盘', 60), saved: {}, tasks: {} });
    registry.logins.clear(); registry.media.clear(); registry.files.clear(); return { connected: true };
  })().finally(() => { login.polling = undefined; }); return login.polling;
}
export function disconnectAli() { const a = aliVault().configured ? aliVault().read() : null; if (a) try { clearAccountLeases('aliyun', a.id); } catch { /* Logout must still revoke credentials if the lease journal is unreadable. */ } registry.logins.clear(); registry.media.clear(); registry.mediaIndex?.clear(); registry.files.clear(); aliVault().clear(); return { connected: false }; }
function reference(req: Request, key: string) { const ref = registry.files.get(key); if (!ref || ref.owner !== owner(req) || ref.expires < Date.now()) throw new PanError('目录已过期，请重新打开', 409); return ref; }
async function shareAccess(share: ReturnType<typeof parsePanShare>) { const data = await api('/v2/share_link/get_share_token', { share_id: share.id, share_pwd: share.passcode }); if (!text(data.share_token)) throw new PanError('阿里云盘分享凭证无效', 502); return text(data.share_token); }
export async function listAliFiles(req: Request, raw: string, passcode = '', parentKey = '', marker = ''): Promise<PanListing> {
  const share = raw ? parsePanShare(raw, passcode) : undefined; if (share && share.provider !== 'aliyun') throw new PanError('请选择阿里云盘分享');
  if (marker.length > 1024) throw new PanError('分页参数无效');
  const a = share ? undefined : await account(); let parent = 'root'; let ancestors: string[] = [];
  if (parentKey) { const ref = reference(req, parentKey); if (!ref.folder || ref.share?.id !== share?.id || ref.account !== a?.id) throw new PanError('目录与当前网盘不一致'); parent = ref.fid; ancestors = [...(ref.ancestors || []), ref.fid]; }
  const token = share ? await shareAccess(share) : '';
  const data = await api(share ? '/adrive/v3/file/list' : '/v2/file/list', { ...(share ? { share_id: share.id } : { drive_id: a!.drive }), parent_file_id: parent, marker, limit: 100, order_by: 'name', order_direction: 'ASC' }, a, token);
  const rows = Array.isArray(data.items) ? data.items as Record<string, unknown>[] : [];
  for (const [key, ref] of registry.files) if (ref.expires < Date.now()) registry.files.delete(key);
  if (registry.files.size > 5000) throw new PanError('打开目录较多，请稍后重试', 429);
  const items: PanFile[] = [];
  for (const file of rows) {
    const name = plainText(file.name, 300), folder = file.type === 'folder'; if (!folder && !isVideoFile(name)) continue;
    const ref: AliFile = { fid: idValue(file.file_id), name, folder, size: Number(file.size) || 0, owner: owner(req), expires: Date.now() + 8 * 60 * 60_000, share, account: a?.id, drive: text(file.drive_id) || a?.drive, ancestors };
    const metadata = file.video_media_metadata as { width?: number; height?: number } | undefined; ref.width = Number(metadata?.width) || undefined; ref.height = Number(metadata?.height) || undefined;
    const key = randomUUID(); registry.files.set(key, ref); items.push({ key, identity: createHash('sha256').update('aliyun:' + (share?.id || a!.id) + ':' + ref.fid).digest('hex').slice(0, 32), name, folder, size: ref.size, width: ref.width, height: ref.height });
  }
  return { title: share ? '阿里云盘分享' : '我的阿里云盘', items, total: items.length, hasMore: Boolean(data.next_marker), page: 1, marker: text(data.next_marker), shareUrl: share?.url || '' };
}
export async function aliStorageAdapter(value?: AliAccount): Promise<CleanupAdapter> {
  const a = value || await account();
  const list = async (drive: string, parent: string, recycle = false) => {
    const rows: Record<string, unknown>[] = []; let marker = '';
    for (let page = 0; page < 8; page++) { const data = await api(recycle ? '/v2/recyclebin/list' : '/v2/file/list', { drive_id: drive, parent_file_id: parent, marker, limit: 100, order_by: 'updated_at', order_direction: 'ASC' }, a); rows.push(...(Array.isArray(data.items) ? data.items as Record<string, unknown>[] : [])); marker = text(data.next_marker); if (!marker) break; }
    return rows;
  };
  return {
    provider: 'aliyun', account: a.id,
    quota: async () => { const v = await api('/adrive/v1/user/driveCapacityDetails', {}, a); return diskQuota(v.drive_total_size, v.drive_used_size); },
    candidates: async () => {
      const profile = await api('/v2/user/get', {}, a);
      const drives = [...new Set([a.drive, text(profile.resource_drive_id), text(profile.backup_drive_id), text(profile.default_drive_id)].filter(Boolean))]; const out: CleanupEntry[] = [];
      const add = (rows: Record<string, unknown>[], drive: string, parent: string, priority: number, recycle = false) => { for (const v of rows) if (text(v.file_id) && v.file_id !== a.folder) out.push({ id: idValue(v.file_id), drive, parent, size: Number(v.size) || 0, modified: Date.parse(text(v.updated_at)) || 0, priority, recycle }); };
      for (const drive of drives) {
        const roots = await list(drive, 'root');
        if (drive === a.drive && a.folder && roots.some((v) => v.file_id === a.folder)) add(await list(drive, a.folder), drive, a.folder, 1);
        add(roots, drive, 'root', 2); add(await list(drive, 'root', true), drive, 'root', 0, true);
      }
      return out;
    },
    remove: async (entry) => {
      if (storageProtected('aliyun', a.id, entry.id)) throw new PanError('该文件正在播放，已保留', 409, 'FILE_ACTIVE');
      const v = await api('/v3/file/delete', { drive_id: entry.drive || a.drive, file_id: idValue(entry.id) }, a);
      if (text(v.async_task_id)) {
        let done = false;
        for (let n = 0; n < 8; n++) { const t = await api('/v2/async_task/get', { async_task_id: v.async_task_id }, a); if (t.state === 'Succeed' || t.status === 'Succeed') { done = true; break; } if (t.state === 'Failed') throw new PanError('阿里云盘清理失败，请稍后重试', 409); await new Promise((r) => setTimeout(r, 300)); }
        if (!done) throw new PanError('阿里云盘仍在清理，请稍后重试', 409, 'CLEANUP_PENDING');
      }
      const latest = currentAccount(); if (latest.id !== a.id) throw new PanError('网盘账号已更改', 409);
      for (const [key, fid] of Object.entries(latest.saved)) if (fid === entry.id) delete latest.saved[key];
      aliVault().write(latest, a.id); a.saved = latest.saved;
    },
  };
}
async function ensureSaved(a: AliAccount, ref: AliFile, progress?: PanProgressFn) {
  if (!ref.share) { if (ref.account !== a.id) throw new PanError('网盘账号已更改', 409); return { fid: ref.fid, cleaned: 0 }; }
  const mapping = ref.share.id + ':' + ref.fid; if (a.saved[mapping]) return { fid: a.saved[mapping], cleaned: 0 };
  if (a.tasks[mapping]) throw new PanError('上次转存结果尚未确认，请先在阿里云盘查看「JjBiTV 追剧」，避免重复转存', 409, 'TRANSFER_UNCERTAIN');
  const space = await ensureDiskSpace(ref.size, { ...await aliStorageAdapter(a), protectedIds: [ref.fid, ...(ref.ancestors || [])] }, progress);
  progress?.({ stage: 'saving', message: '空间已就绪，正在转存选中的视频' });
  if (!a.folder) {
    const folders = await api('/v2/file/list', { drive_id: a.drive, parent_file_id: 'root', limit: 100, order_by: 'name', order_direction: 'ASC' }, a);
    const existing = (folders.items as Record<string, unknown>[] | undefined)?.find((v) => v.type === 'folder' && v.name === 'JjBiTV 追剧');
    const result = existing || await api('/adrive/v2/file/createWithFolders', { drive_id: a.drive, parent_file_id: 'root', name: 'JjBiTV 追剧', type: 'folder', check_name_mode: 'refuse' }, a);
    a.folder = idValue(result.file_id); persist(a);
  }
  const token = await shareAccess(ref.share); a.tasks[mapping] = 'uncertain'; persist(a);
  try {
    const data = await api('/v3/batch', { requests: [{ body: { share_id: ref.share.id, file_id: ref.fid, to_drive_id: a.drive, to_parent_file_id: a.folder, auto_rename: true }, headers: { 'Content-Type': 'application/json' }, id: '0', method: 'POST', url: '/file/copy' }], resource: 'file' }, a, token);
    const response = (data.responses as { status?: number; body?: Record<string, unknown> }[] | undefined)?.[0]; const result = response?.body;
    if (result?.code || (response?.status && response.status >= 400)) throw new AliReject(text(result?.code) || 'COPY_REJECTED');
    if (!text(result?.file_id)) throw new PanError('阿里云盘已接收转存，请先在官方客户端确认结果', 502, 'TRANSFER_UNCERTAIN');
    const fid = idValue(result!.file_id); a.saved[mapping] = fid; delete a.tasks[mapping]; persist(a); return { fid, cleaned: space.deleted };
  } catch (e) { if (e instanceof AliReject) { delete a.tasks[mapping]; persist(a); } throw e; }
}
async function playback(a: AliAccount, ref: AliFile, save: boolean, progress?: PanProgressFn): Promise<PanPlayback> {
  if (ref.folder) throw new PanError('请选择视频文件');
  const saved = save ? await ensureSaved(a, ref, progress) : { fid: ref.fid, cleaned: 0 }; const fid = saved.fid;
  const token = !save && ref.share ? await shareAccess(ref.share) : '';
  const body = !save && ref.share ? { share_id: ref.share.id, file_id: fid, drive_id: ref.drive } : { drive_id: a.drive, file_id: fid };
  progress?.({ stage: 'resolving', message: '正在获取原文件地址和完整转码画质' });
  const [preview, original] = await Promise.allSettled([
    api(!save && ref.share ? '/v2/file/get_share_link_video_preview_play_info' : '/v2/file/get_video_preview_play_info', { ...body, category: 'live_transcoding', url_expire_sec: 14400, get_preview_url: true, template_id: '' }, a, token),
    api(!save && ref.share ? '/v2/file/get_share_link_download_url' : '/v2/file/get_download_url', { ...body, expire_sec: 14400 }, a, token),
  ]);
  const qualities: PanQuality[] = []; let sourceDuration: number | undefined;
  if (preview.status === 'fulfilled') {
    const info = preview.value.video_preview_play_info as { live_transcoding_task_list?: Record<string, unknown>[]; meta?: { duration?: number } } | undefined;
    sourceDuration = Number(info?.meta?.duration) || undefined;
    for (const row of info?.live_transcoding_task_list || []) if (row.status === 'finished' && (text(row.url) || text(row.preview_url)).startsWith('https://')) {
      if (save && !text(row.url)) continue;
      const height = Number(row.template_height) || undefined;
      qualities.push({ label: `${height ? height + 'P' : text(row.template_id)} · 转码`, url: issueAliMedia(text(row.url) || text(row.preview_url), a.id, true), kind: 'hls', width: Number(row.template_width) || undefined, height, limited: !text(row.url) });
    }
    qualities.sort((x, y) => (y.height || 0) - (x.height || 0));
  }
  if (original.status === 'fulfilled') { const url = text(original.value.url) || text(original.value.download_url); if (url.startsWith('https://')) qualities.push({ label: '原画 · 原文件', url: issueAliMedia(url, a.id) + '&direct=1&original=1', kind: 'video', original: true, container: ref.name.split('.').pop()?.toLowerCase(), width: ref.width, height: ref.height }); }
  if (!qualities.length) throw new PanError('阿里云盘暂未返回可播放地址，可尝试转存后播放或在官方客户端查看', 409, 'PLAYBACK_UNAVAILABLE');
  if (currentAccount().id !== a.id) throw new PanError('网盘连接已更改', 409);
  await Promise.all(qualities.filter((q) => q.kind === 'hls').map(async (q) => {
    try {
      const response = await aliMedia(new Request('https://cinema.invalid/api/alipan/media'), new URL(q.url, 'https://cinema.invalid').searchParams.get('id')!);
      const manifest = await response.text(); const parts = [...manifest.matchAll(/^#EXTINF:([\d.]+)/gm)];
      if (manifest.includes('#EXT-X-ENDLIST') && parts.length) q.duration = Math.round(parts.reduce((sum, m) => sum + Number(m[1]), 0));
      if (q.duration && sourceDuration) q.limited = q.duration + 3 < sourceDuration;
    } catch { /* Keep the provider's preview flag when the manifest cannot be verified yet. */ }
    if (q.limited) q.label = q.label.replace(' · 转码', ' · 限时试看');
  }));
  // A full 720P stream is preferable to a 1080P two-minute sample.
  qualities.sort((x, y) => Number(Boolean(x.limited)) - Number(Boolean(y.limited)) || Number(x.kind === 'video') - Number(y.kind === 'video') || (y.height || 0) - (x.height || 0));
  const duration = qualities[0].duration, limited = qualities[0].limited;
  if (save && !qualities.some((q) => !q.limited)) throw new PanError('文件已转存，但阿里云盘没有提供完整播放线路，请换一个资源或在官方 App 查看', 409, 'FULL_PLAYBACK_UNAVAILABLE');
  return { qualities: save ? qualities.filter((q) => !q.limited) : qualities, saved: save || !ref.share, duration, sourceDuration, limited, cleaned: saved.cleaned, original: { width: ref.width, height: ref.height, size: ref.size }, notice: limited ? '阿里云盘当前只提供限时预览。页面显示的是实际播放清单时长，不代表可以完整播放。' : undefined };
}
export async function playAliFile(req: Request, key: string, save = false, progress?: PanProgressFn) {
  const ref = reference(req, key); const a = await account();
  if (!save) return playback(a, ref, false);
  progress?.({ stage: 'queued', message: '已加入播放准备队列，正在连接阿里云盘' });
  const previous = registry.locks.get(a.id); const task = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => { const latest = await account(); if (latest.id !== a.id) throw new PanError('网盘连接已更改', 409); const result = await playback(latest, ref, true, progress); const fid = ref.share ? latest.saved[ref.share.id + ':' + ref.fid] : ref.fid; return { ...result, lease: startPlaybackLease(req, 'aliyun', latest.id, fid, ref.share ? [latest.folder || ''] : ref.ancestors) }; });
  registry.locks.set(a.id, task); try { return await task; } finally { if (registry.locks.get(a.id) === task) registry.locks.delete(a.id); }
}
function mediaUrl(raw: string) { const u = new URL(raw); if (u.protocol !== 'https:' || u.username || u.password || !['aliyundrive.net', 'aliyundrive.com', 'alipan.com', 'aliyuncs.com'].some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) throw new PanError('阿里云盘播放地址不受支持', 502); return u; }
export function issueAliMedia(url: string, account: string, playlist = false) {
  mediaUrl(url); const now = Date.now(), index = registry.mediaIndex ??= new Map<string, string>();
  if (now - (registry.prunedAt || 0) > 60_000) { for (const [id, t] of registry.media) if (t.expires < now) { registry.media.delete(id); index.delete(t.account + '\n' + t.url); } registry.prunedAt = now; }
  const key = account + '\n' + url, existing = index.get(key);
  if (existing && (registry.media.get(existing)?.expires || 0) > now) return '/api/alipan/media?id=' + existing;
  if (registry.media.size > 12_000) throw new PanError('播放请求较多，请稍后重试', 429);
  const id = randomUUID(); registry.media.set(id, { url, account, playlist, expires: now + 3 * 60 * 60_000 }); index.set(key, id); return '/api/alipan/media?id=' + id;
}
export function extendAliMedia(id: string) { const ticket = registry.media.get(id); if (!ticket || ticket.account !== currentAccount().id || ticket.expires < Date.now()) throw new PanError('播放地址已过期，请重新准备', 410); ticket.expires = Date.now() + 4 * 60 * 60_000; }
export async function aliMedia(req: Request, id: string) {
  const ticket = registry.media.get(id); if (!ticket || ticket.account !== currentAccount().id || ticket.expires < Date.now()) throw new PanError('播放地址已过期，请刷新', 410);
  let url = ticket.url;
  for (let i = 0; i < 4; i++) {
    mediaUrl(url); if (!(await checkUpstreamAllowed(url)).ok) throw new PanError('播放地址不可用', 502);
    if (!ticket.playlist && !/\.m3u8(?:[?#]|$)/i.test(url) && new URL(req.url).searchParams.get('direct') === '1' && await canDeliverDirect(url, new URL(req.url).searchParams.get('original') !== '1')) return directMediaResponse(url);
    const headers = new Headers({ 'User-Agent': UA, Referer: 'https://www.alipan.com/' }); const range = req.headers.get('range'); if (range && /^bytes=\d*-\d*$/.test(range)) headers.set('Range', range);
    const connection = new AbortController(); const timeout = setTimeout(() => connection.abort(), 20_000); let res: Response;
    try { res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.any([req.signal, connection.signal]), cache: 'no-store' }); } finally { clearTimeout(timeout); }
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.has('location')) { url = new URL(res.headers.get('location')!, url).href; await res.body?.cancel(); continue; }
    if (res.status === 416) { await res.body?.cancel(); return new Response(null, { status: 416, headers: { 'Content-Range': res.headers.get('content-range') || 'bytes */*', 'Cache-Control': 'no-store' } }); }
    if (!res.ok) { await res.body?.cancel(); throw new PanError('阿里云盘播放地址暂不可用，请刷新', 502); }
    if (/mpegurl/i.test(res.headers.get('content-type') || '') || /\.m3u8(?:[?#]|$)/i.test(url)) {
      const body = await bounded(res); if (!body.trimStart().startsWith('#EXTM3U')) throw new PanError('播放清单无效', 502);
      const rewrite = (uri: string) => { const playlist = /\.m3u8(?:[?#]|$)/i.test(uri); const path = issueAliMedia(new URL(uri, url).href, ticket.account, playlist); return playlist ? path : preferDirectMedia(path); };
      return new Response(body.split('\n').map((line) => !line.trim() ? line : line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${rewrite(uri)}"`) : rewrite(line.trim())).join('\n'), { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, no-store' } });
    }
    const out = new Headers({ 'Content-Type': res.headers.get('content-type') || 'video/mp4', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' });
    for (const name of ['content-range', 'content-length', 'accept-ranges']) { const v = res.headers.get(name); if (v) out.set(name, v); }
    return new Response(res.body, { status: res.status, headers: out });
  }
  throw new PanError('播放重定向次数过多', 502);
}
