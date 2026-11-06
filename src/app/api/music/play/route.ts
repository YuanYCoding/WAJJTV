import { libraryGuard, libraryBody } from '@/lib/library-api-server';
import { resolveMusic } from '@/lib/music-server';
import { validMusicIdentity, MUSIC_QUALITIES, type MusicQuality, type MusicTrack } from '@/lib/music-types';
export const runtime = 'nodejs';
let active = 0;
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  if (active >= 3) return Response.json({ error: '正在准备其他歌曲，请稍后重试' }, { status: 429 });
  active++;
  try {
    const body = await libraryBody(req);
    if (!validMusicIdentity(body.source, body.id)) return Response.json({ error: '歌曲标识无效' }, { status: 400 });
    const quality = String(body.quality || 'auto') as MusicQuality;
    if (!MUSIC_QUALITIES.some(q => q.id === quality)) return Response.json({ error: '音质选项无效' }, { status: 400 });
    const t = body.track as Partial<MusicTrack> | undefined;
    const track = t && typeof t.duration === 'number' && Number.isFinite(t.duration) && t.duration > 0 && t.duration <= 21600
      ? { source: body.source, id: String(body.id), duration: t.duration, title: '', artist: '', album: '', cover: '' } as MusicTrack : undefined;
    const result = await resolveMusic(body.source, String(body.id), AbortSignal.any([req.signal, AbortSignal.timeout(24_000)]), { quality, track, fresh: body.fresh === true });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return Response.json({ error: '当前没有通过完整音频检测的所选音质，请重试或选择其他音质。' }, { status: 502 }); }
  finally { active--; }
}
