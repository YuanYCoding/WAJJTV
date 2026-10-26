export class PanError extends Error {
  constructor(message: string, public status = 400, public code = 'PAN_ERROR') { super(message); }
}
export function parseQuarkShare(raw: string, passcode = '') {
  if (raw.length > 3000) throw new PanError('分享链接过长');
  if (/[\r\n]/.test(passcode)) throw new PanError('提取码格式不正确');
  const match = raw.match(/https:\/\/pan\.quark\.cn\/s\/[A-Za-z\d]{6,32}(?:\?[^\s<>"'，。]*)?/);
  if (!match) throw new PanError('请输入有效的夸克分享链接，例如 https://pan.quark.cn/s/…');
  const url = new URL(match[0]);
  const id = url.pathname.split('/').pop()!;
  const code = passcode.trim() || url.searchParams.get('pwd') || url.searchParams.get('password') || raw.match(/(?:提取码|提取碼|密码)\s*[:：]?\s*([A-Za-z\d]{4,8})/)?.[1] || '';
  if (code && !/^[A-Za-z\d]{1,8}$/.test(code)) throw new PanError('提取码格式不正确');
  return { id, passcode: code, url: `https://pan.quark.cn/s/${id}` };
}
export function plainText(raw: unknown, max = 300) {
  return String(raw ?? '').replace(/<[^>]*>/g, '').replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, (m) => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }[m] || m)).replace(/\s+/g, ' ').trim().slice(0, max);
}
export function qualityHint(text: string) {
  if (/\b(?:4k|2160p)\b|杜比视界|蓝光原盘|蓝光原碟/i.test(text)) return '标注 4K / 原盘';
  if (/1080p|1080i|全高清/i.test(text)) return '标注 1080P';
  if (/720p/i.test(text)) return '标注 720P';
  return '画质待检测';
}
export function isRelevantPanTitle(title: string, keyword: string) {
  const normalize = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const a = normalize(title); const b = normalize(keyword);
  return a.includes(b) && !/成人|色情|情色|成人视频|无码|番号|av合集|福利姬|里番|🔞/i.test(title);
}
export function mergeCookies(previous: string, additions: string[]): string {
  const cookies = new Map<string, string>();
  for (const piece of [...previous.split(';'), ...additions.map((v) => v.split(';')[0])]) {
    const pair = piece.trim(); const split = pair.indexOf('=');
    if (split < 1 || /[\r\n]/.test(pair)) continue;
    const name = pair.slice(0, split); const value = pair.slice(split + 1);
    if (/^[\w-]+$/.test(name)) cookies.set(name, value);
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}
export function idValue(raw: unknown, fallback?: string) {
  const value = String(raw || fallback || '');
  if (!/^[A-Za-z\d_-]{1,128}$/.test(value)) throw new PanError('文件标识无效');
  return value;
}
