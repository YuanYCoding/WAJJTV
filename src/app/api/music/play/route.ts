import { libraryGuard, libraryBody } from '@/lib/library-api-server';
import { resolveMusic } from '@/lib/music-server';
import { validMusicIdentity } from '@/lib/music-types';
export const runtime = 'nodejs';
let active = 0;
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  if (active >= 3) return Response.json({ error: '正在准备其他歌曲，请稍后重试' }, { status: 429 });
  active++;
  try {
    const body = await libraryBody(req);
    if (!validMusicIdentity(body.source, body.id)) return Response.json({ error: '歌曲标识无效' }, { status: 400 });
    const result = await resolveMusic(body.source, String(body.id), AbortSignal.any([req.signal, AbortSignal.timeout(22_000)]));
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return Response.json({ error: '该歌曲暂时无法播放。可试试同名歌曲的其他来源；会员或地区限制可能影响播放。' }, { status: 502 }); }
  finally { active--; }
}
