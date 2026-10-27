import { createHmac, timingSafeEqual } from 'node:crypto';
import { connectionId } from './netdisk-prepare';
import { PanError } from './netdisk-utils';
import type { PanProvider } from './netdisk-types';
const sign = (value: string) => createHmac('sha256', process.env.CLOUD_ENCRYPTION_KEY || '').update('external-v9:' + value).digest('base64url');
export function externalTicket(provider: PanProvider, mediaId: string) {
  if (!/^[\w-]{16,80}$/.test(mediaId)) throw new PanError('播放地址无效');
  const payload = Buffer.from(JSON.stringify({ provider, mediaId, account: connectionId(provider), expires: Date.now() + 4 * 60 * 60_000 })).toString('base64url');
  return payload + '.' + sign(payload);
}
export function readExternalTicket(raw: string) {
  if (raw.length > 1800) throw new PanError('播放链接无效', 403);
  const [value, signature] = raw.split('.'), expected = sign(value || '');
  if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new PanError('播放链接无效', 403);
  let data: { provider: PanProvider; mediaId: string; account: string; expires: number }; try { data = JSON.parse(Buffer.from(value, 'base64url').toString()); } catch { throw new PanError('播放链接无效', 403); }
  if (!['quark', 'aliyun'].includes(data.provider) || !/^[\w-]{16,80}$/.test(data.mediaId) || data.expires < Date.now() || data.account !== connectionId(data.provider)) throw new PanError('外部播放链接已过期，请重新获取', 410);
  return data;
}
