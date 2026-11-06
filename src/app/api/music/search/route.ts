import { guardRequest } from '@/lib/api-guard';
import { searchMusic } from '@/lib/music-server';
import { MUSIC_SOURCES } from '@/lib/music-types';
export const runtime = 'nodejs';
let active = 0;
export async function GET(req: Request) {
  const guard = guardRequest(req); if (guard) return guard;
  const u = new URL(req.url), q = (u.searchParams.get('q') || '').trim().slice(0, 100), page = Math.min(10, Math.max(1, Number(u.searchParams.get('page')) || 1));
  const wanted = (u.searchParams.get('sources') || MUSIC_SOURCES.map(s => s.id).join(',')).split(',');
  const sources = MUSIC_SOURCES.filter(s => wanted.includes(s.id));
  if (!q || !sources.length) return Response.json({ error: '请输入歌曲、歌手或专辑，至少选择一个音源' }, { status: 400 });
  if (active >= 4) return Response.json({ error: '搜索较多，请稍后再试' }, { status: 429 });
  active++;
  const controller = new AbortController(), signal = AbortSignal.any([req.signal, controller.signal, AbortSignal.timeout(8000)]), encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      try {
        await Promise.all(sources.map(async s => {
          const row = await searchMusic(s.id, q, page, signal);
          if (!controller.signal.aborted) c.enqueue(encoder.encode(JSON.stringify(row) + '\n'));
        }));
        if (!controller.signal.aborted) c.close();
      } catch { if (!controller.signal.aborted) c.error(new Error('搜索已中断')); }
      finally { active--; }
    },
    cancel() { controller.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
}
