import { guardRequest } from '@/lib/api-guard';
import { searchMusic, groupMusicCandidates, verifyMusicGroup } from '@/lib/music-server';
import { MUSIC_SOURCES, type MusicSearchEvent } from '@/lib/music-types';
export const runtime = 'nodejs';
let active = 0;
export async function GET(req: Request) {
  const guard = guardRequest(req); if (guard) return guard;
  const u = new URL(req.url), q = (u.searchParams.get('q') || '').trim().slice(0, 100);
  const page = Math.min(100, Math.max(1, Math.floor(Number(u.searchParams.get('page')) || 1)));
  const wanted = (u.searchParams.get('sources') || MUSIC_SOURCES.map(s => s.id).join(',')).split(',');
  const sources = MUSIC_SOURCES.filter(s => s.id !== 'apple' && wanted.includes(s.id));
  if (!q || !sources.length) return Response.json({ error: '请输入歌曲、歌手或专辑，并启用音源' }, { status: 400 });
  if (active >= 2) return Response.json({ error: '搜索较多，请稍后重试' }, { status: 429 });
  active++;
  const control = new AbortController(), signal = AbortSignal.any([req.signal, control.signal, AbortSignal.timeout(30_000)]), encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const send = (row: MusicSearchEvent) => { if (!control.signal.aborted && !req.signal.aborted) c.enqueue(encoder.encode(JSON.stringify(row) + '\n')); };
      try {
        send({ tracks: [], checked: 0 });
        const catalogPage = Math.floor((page - 1) / 10) + 1, offset = ((page - 1) % 10) * 10;
        const outcomes = await Promise.all(sources.map(s => searchMusic(s.id, q, catalogPage, AbortSignal.any([signal, AbortSignal.timeout(4000)]))));
        const mixed = Array.from({ length: 20 }, (_, i) => outcomes.flatMap(o => o.tracks[i] ? [o.tracks[i]] : [])).flat();
        const normalize = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
        const query = normalize(q), score = (t: typeof mixed[number]) => (normalize(t.title) === query ? 100 : normalize(t.title).includes(query) ? 60 : 0) + (normalize(t.artist) === query ? 90 : normalize(t.artist).includes(query) ? 40 : 0);
        const groups = groupMusicCandidates(mixed).sort((a, b) => score(b[0]) - score(a[0]));
        const batch = groups.slice(offset, offset + 10); let cursor = 0, checked = 0;
        send({ tracks: [], checked, total: batch.length });
        await Promise.all(Array.from({ length: Math.min(3, batch.length) }, async () => {
          while (cursor < batch.length && !signal.aborted) {
            const index = cursor++, group = batch[index];
            const track = await verifyMusicGroup(group, AbortSignal.any([signal, AbortSignal.timeout(11_000)])); checked++;
            send({ tracks: track ? [{ ...track, searchRank: offset + index }] : [], checked, total: batch.length });
          }
        }));
        const nextPage = checked < batch.length ? page : offset + 10 < groups.length ? page + 1 : outcomes.some(o => o.tracks.length >= 20) ? catalogPage * 10 + 1 : null;
        send({ tracks: [], checked, total: batch.length, done: true, nextPage: nextPage && nextPage <= 100 ? nextPage : null });
      } catch { send({ tracks: [], done: true, error: '本次查找未完成，请重试' }); }
      finally { active--; if (!control.signal.aborted && !req.signal.aborted) c.close(); }
    },
    cancel() { control.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
}
