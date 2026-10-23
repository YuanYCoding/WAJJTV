import { createHash, randomUUID } from 'node:crypto';
import { cloudVault, type CloudCredentials } from './cloud-vault';
import { fetchUpstreamWithMeta } from './fetch-utils';

const OPEN_API = 'https://openapi.alipan.com';
const AUTH_SERVICE = 'https://api.oplist.org';
export class CloudError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Login = { sid: string; owner: string; expiresAt: number };
type MediaTicket = { url: string; account: string; expiresAt: number };
const state = globalThis as unknown as {
  wajjtvCloud?: { logins: Map<string, Login>; tickets: Map<string, MediaTicket>; refresh?: Promise<CloudCredentials>; mediaIndex?: Map<string, string>; prunedAt?: number };
};
const shared: NonNullable<typeof state.wajjtvCloud> = state.wajjtvCloud ??= { logins: new Map(), tickets: new Map() };
const ownerOf = (req: Request) => createHash('sha256').update(req.headers.get('cookie') || '').digest('hex');
const str = (v: unknown) => typeof v === 'string' ? v : '';

async function jsonRequest(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12_000), cache: 'no-store' }); }
  catch { throw new CloudError('网盘服务连接超时，请稍后重试', 502); }
  let data: Record<string, unknown>;
  try { data = await response.json(); } catch { throw new CloudError('网盘服务返回异常，请稍后重试', 502); }
  if (!response.ok || data.code) {
    const code = str(data.code);
    if (/token|Unauthorized|AccessToken/i.test(code)) throw new CloudError('阿里云盘授权已失效，请重新连接', 409);
    if (/capacity/i.test(code)) throw new CloudError('阿里云盘提示容量超限，请先整理网盘空间', 409);
    if (/forbidden|notallowed/i.test(code)) throw new CloudError('阿里云盘暂未允许播放此文件，请在官方客户端检查文件状态或账号权益', 403);
    throw new CloudError('网盘暂未完成请求；请确认扫码授权已完成后重试', 502);
  }
  return data;
}
const withToken = (path: string, accessToken: string, body: unknown) => jsonRequest(OPEN_API + path, {
  method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function account(): Promise<CloudCredentials> {
  const vault = cloudVault();
  const saved = vault.read();
  if (!saved) throw new CloudError('请先连接阿里云盘', 409);
  if (saved.expiresAt > Date.now() + 60_000) return saved;
  if (!shared.refresh) {
    shared.refresh = (async () => {
      const query = new URLSearchParams({ refresh_ui: saved.refreshToken, server_use: 'true', driver_txt: 'alicloud_qr' });
      const data = await jsonRequest(`${AUTH_SERVICE}/alicloud/renewapi?${query}`);
      if (!str(data.access_token) || !str(data.refresh_token)) throw new CloudError('阿里云盘授权已失效，请重新连接', 409);
      const next = { ...saved, accessToken: str(data.access_token), refreshToken: str(data.refresh_token), expiresAt: Date.now() + 30 * 60_000 };
      if (!vault.write(next, saved.id)) throw new CloudError('网盘连接已更改，请刷新页面', 409);
      return next;
    })().finally(() => { shared.refresh = undefined; });
  }
  return shared.refresh;
}
export function cloudStatus() {
  const vault = cloudVault();
  if (!vault.configured) return { configured: false, connected: false };
  const saved = vault.read();
  return { configured: true, connected: Boolean(saved), name: saved?.name, drives: saved?.drives ?? [] };
}
export async function beginCloudLogin(req: Request) {
  if (!cloudVault().configured) throw new CloudError('网盘功能尚未配置，请联系部署者', 503);
  for (const [key, value] of shared.logins) if (value.expiresAt < Date.now()) shared.logins.delete(key);
  if (shared.logins.size > 8) throw new CloudError('授权请求较多，请稍后重试', 429);
  const data = await jsonRequest(`${AUTH_SERVICE}/alicloud/requests?client_uid=&client_key=&driver_txt=alicloud_qr&server_use=true`);
  const qr = str(data.text);
  if (!/^https:\/\/openapi\.alipan\.com\/oauth\/qrcode\/[\w-]+$/.test(qr) || !str(data.sid)) throw new CloudError('暂时无法生成二维码，请重试', 502);
  const id = randomUUID();
  // A newer connection request supersedes an older pending login, preventing a late scan from replacing the account.
  shared.logins.clear();
  shared.logins.set(id, { sid: str(data.sid), owner: ownerOf(req), expiresAt: Date.now() + 5 * 60_000 });
  return { id, qr, expiresAt: Date.now() + 5 * 60_000 };
}
export async function finishCloudLogin(req: Request, id: string) {
  const login = shared.logins.get(id);
  if (!login || login.owner !== ownerOf(req) || login.expiresAt < Date.now()) throw new CloudError('二维码已失效，请重新获取', 409);
  const query = new URLSearchParams({ client_id: '', client_secret: '', server_use: 'true', grant_type: 'authorization_code', code: login.sid, sid: login.sid });
  const tokens = await jsonRequest(`${AUTH_SERVICE}/alicloud/callback?${query}`);
  if (!str(tokens.access_token) || !str(tokens.refresh_token)) throw new CloudError('尚未完成授权，请先使用阿里云盘 App 扫码并确认');
  const info = await withToken('/adrive/v1.0/user/getDriveInfo', str(tokens.access_token), {});
  const drives = [
    { id: str(info.resource_drive_id), name: '资源库' },
    { id: str(info.backup_drive_id), name: '备份盘' },
    { id: str(info.default_drive_id), name: '默认网盘' },
  ].filter((d, i, arr) => d.id && arr.findIndex((x) => x.id === d.id) === i);
  if (!drives.length) throw new CloudError('未获取到可用网盘，请重新授权', 502);
  if (shared.logins.get(id) !== login) throw new CloudError('本次授权已取消，请重新连接', 409);
  cloudVault().write({ id: randomUUID(), accessToken: str(tokens.access_token), refreshToken: str(tokens.refresh_token), expiresAt: Date.now() + 30 * 60_000, name: str(info.name) || '阿里云盘', drives });
  shared.logins.clear(); shared.tickets.clear(); shared.mediaIndex?.clear();
  return cloudStatus();
}
export function disconnectCloud() { shared.logins.clear(); shared.tickets.clear(); shared.mediaIndex?.clear(); cloudVault().clear(); return { connected: false }; }

function checkId(value: string) {
  if (!/^[\w-]{1,200}$/.test(value)) throw new CloudError('文件或目录标识无效');
  return value;
}
function checkDrive(credentials: CloudCredentials, drive: string) {
  if (!credentials.drives.some((d) => d.id === drive)) throw new CloudError('网盘不存在', 404);
  return drive;
}
export async function cloudFiles(drive: string, folder: string, marker: string) {
  if (marker.length > 1024) throw new CloudError('分页标识无效');
  const credentials = await account();
  const data = await withToken('/adrive/v1.0/openFile/list', credentials.accessToken, {
    drive_id: checkDrive(credentials, drive), parent_file_id: checkId(folder || 'root'), marker, limit: 100,
    order_by: 'name', order_direction: 'ASC',
  });
  const items = Array.isArray(data.items) ? data.items as Record<string, unknown>[] : [];
  return { items: items.filter((v) => v.type === 'folder' || v.category === 'video' || /\.(mp4|mkv|mov|ts|m4v|webm|avi)$/i.test(str(v.name))).map((v) => ({ id: str(v.file_id), name: str(v.name), folder: v.type === 'folder', size: Number(v.size) || 0 })), marker: str(data.next_marker) };
}
export function issueCloudMedia(url: string, accountId: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new CloudError('网盘播放地址无效', 502);
  const now = Date.now();
  const index = shared.mediaIndex ??= new Map();
  const cacheKey = accountId + '\n' + url;
  const existing = index.get(cacheKey);
  if (existing && (shared.tickets.get(existing)?.expiresAt || 0) > now) return '/api/cloud/media?id=' + existing;
  if (now - (shared.prunedAt || 0) > 60_000) {
    for (const [key, value] of shared.tickets) if (value.expiresAt < now) { shared.tickets.delete(key); index.delete(value.account + '\n' + value.url); }
    shared.prunedAt = now;
  }
  if (shared.tickets.size >= 12_000) throw new CloudError('播放请求较多，请稍后重试', 429);
  const id = randomUUID();
  shared.tickets.set(id, { url, account: accountId, expiresAt: now + 3 * 60 * 60_000 });
  index.set(cacheKey, id);
  return '/api/cloud/media?id=' + id;
}
export async function cloudPlayback(drive: string, file: string) {
  const credentials = await account();
  const data = await withToken('/adrive/v1.0/openFile/getVideoPreviewPlayInfo', credentials.accessToken, {
    drive_id: checkDrive(credentials, drive), file_id: checkId(file), category: 'live_transcoding', url_expire_sec: 14400,
  });
  const info = data.video_preview_play_info as Record<string, unknown> | undefined;
  const tasks = Array.isArray(info?.live_transcoding_task_list) ? info.live_transcoding_task_list as Record<string, unknown>[] : [];
  const available = tasks.filter((v) => v.status === 'finished' && str(v.url).startsWith('https://'));
  const qualities = available.map((v) => ({ label: str(v.template_id), width: Number(v.template_width) || 0, height: Number(v.template_height) || 0, url: issueCloudMedia(str(v.url), credentials.id) })).sort((a, b) => b.height - a.height);
  if (!qualities.length) throw new CloudError('此视频暂未就绪，可能正在转码或受账号权益限制。请在阿里云盘官方客户端确认后重试', 409);
  return { qualities };
}

export async function cloudMedia(id: string, req: Request): Promise<Response> {
  const ticket = shared.tickets.get(id);
  if (!ticket || ticket.expiresAt < Date.now() || cloudVault().read()?.id !== ticket.account) throw new CloudError('播放地址已过期，请重新打开影片', 410);
  const range = req.headers.get('range');
  const { res, finalUrl } = await fetchUpstreamWithMeta(ticket.url, { headers: { Referer: 'https://www.alipan.com/', ...(range && /^bytes=\d*-\d*$/.test(range) ? { Range: range } : {}) }, signal: req.signal, timeoutMs: 20_000 });
  if (!res.ok) { await res.body?.cancel(); throw new CloudError('网盘播放链路暂时不可用，请重新打开影片', 502); }
  const type = res.headers.get('content-type') || '';
  if (/mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(finalUrl)) {
    const text = await res.text();
    if (text.length > 2_000_000 || !text.trimStart().startsWith('#EXTM3U')) throw new CloudError('网盘播放清单无效', 502);
    const rewrite = (uri: string) => issueCloudMedia(new URL(uri, finalUrl).href, ticket.account);
    const content = text.split('\n').map((line) => {
      const value = line.trim();
      if (!value) return line;
      if (value.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${rewrite(uri)}"`);
      return rewrite(value);
    }).join('\n');
    return new Response(content, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' } });
  }
  const headers = new Headers({ 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-store' });
  for (const key of ['content-range', 'content-length', 'accept-ranges']) { const value = res.headers.get(key); if (value) headers.set(key, value); }
  return new Response(res.body, { status: res.status, headers });
}
