import { libraryGuard } from '@/lib/library-api-server';
import { panBody, panFailure } from '@/lib/netdisk-http';
import { externalTicket, readExternalTicket } from '@/lib/netdisk-external';
import { reserveExternalLease } from '@/lib/netdisk-storage';
import { aliMedia, extendAliMedia } from '@/lib/alipan-server';
import { quarkMedia, extendQuarkMedia } from '@/lib/quark-server';
import { PanError } from '@/lib/netdisk-utils';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  try {
    const b = await panBody(req); if (!['aliyun', 'quark'].includes(String(b.provider)) || typeof b.url !== 'string' || typeof b.lease !== 'string') throw new PanError('播放地址无效');
    const u = new URL(b.url, req.url), provider = b.provider as 'aliyun' | 'quark';
    if (u.origin !== new URL(req.url).origin || u.pathname !== (provider === 'aliyun' ? '/api/alipan/media' : '/api/netdisk/media')) throw new PanError('播放地址无效');
    const mediaId = u.searchParams.get('id') || ''; if (provider === 'aliyun') extendAliMedia(mediaId); else extendQuarkMedia(mediaId);
    const token = externalTicket(provider, mediaId);
    const lease = reserveExternalLease(req, b.lease);
    return Response.json({ url: new URL('/api/netdisk/external?t=' + token, process.env.SITE_ORIGIN || req.url).href, lease, expiresIn: 14400 }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { return panFailure(e); }
}
export async function GET(req: Request) {
  try {
    const v = readExternalTicket(new URL(req.url).searchParams.get('t') || '');
    const target = new URL(req.url); target.search = new URLSearchParams({ id: v.mediaId, direct: '1', original: '1' }).toString();
    const forwarded = new Request(target, { headers: req.headers, signal: req.signal });
    const result = v.provider === 'aliyun' ? await aliMedia(forwarded, v.mediaId) : await quarkMedia(forwarded, v.mediaId);
    result.headers.set('Referrer-Policy', 'no-referrer'); return result;
  } catch (e) { return panFailure(e); }
}
