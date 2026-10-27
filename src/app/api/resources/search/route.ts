import { libraryGuard } from '@/lib/library-api-server';
import { panBody, panFailure } from '@/lib/netdisk-http';
import { aipanCatalog, validMagnet } from '@/lib/resource-catalog';
import { PanError } from '@/lib/netdisk-utils';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  try {
    const b = await panBody(req), keyword = typeof b.keyword === 'string' ? b.keyword.trim() : '';
    if (!keyword || keyword.length > 100) throw new PanError('请输入 1–100 字的影片名');
    const movies = await aipanCatalog(keyword, 1, AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]));
    const seen = new Set<string>(), magnets = movies.flatMap((movie) => movie.links.flatMap((link) => { const url = validMagnet(link.url); if (!url || seen.has(url)) return []; seen.add(url); return [{ title: movie.title, name: link.name, url, source: '爱盼影视' }]; }));
    return Response.json({ magnets }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { return panFailure(e); }
}
