import { libraryGuard } from '@/lib/library-api-server';
import { panBody, panFailure } from '@/lib/netdisk-http';
import { inspectHls } from '@/lib/hls-resources';
import { PanError } from '@/lib/netdisk-utils';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  try { const b = await panBody(req); const url = typeof b.url === 'string' ? b.url.trim() : '';
    if (url.length > 4000 || !/^https?:\/\//i.test(url)) throw new PanError('请输入公网 http/https m3u8 地址');
    const u = new URL(url); if (u.username || u.password) throw new PanError('不支持带账号密码的链接');
    const info = await inspectHls(url, AbortSignal.any([req.signal, AbortSignal.timeout(20_000)])); return Response.json({ ...info, url }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { return panFailure(e instanceof PanError ? e : new PanError(e instanceof Error ? e.message : '清单检测失败', 502)); }
}
