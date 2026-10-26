import { libraryGuard } from '@/lib/library-api-server';
import { panBody, panFailure } from '@/lib/netdisk-http';
import { PanError } from '@/lib/netdisk-utils';
import { searchNetdisk } from '@/lib/netdisk-search';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  try {
    const body = await panBody(req); const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
    if ((!keyword && body.mode !== 'latest') || keyword.length > 60) throw new PanError('请输入 1–60 字的影片名');
    const selected = body.mode === 'latest' ? ['quark4k'] : Array.isArray(body.sources) ? body.sources.filter((v): v is string => typeof v === 'string').slice(0, 5) : [];
    const encoder = new TextEncoder(); const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        const signal = AbortSignal.any([req.signal, controller.signal]);
        try { await searchNetdisk(keyword, selected, (event) => { if (!signal.aborted) output.enqueue(encoder.encode(JSON.stringify(event) + '\n')); }, signal); }
        catch { if (!signal.aborted) output.enqueue(encoder.encode(JSON.stringify({ type: 'done', count: 0, failures: 1 }) + '\n')); }
        finally { try { output.close(); } catch { /* disconnected */ } }
      }, cancel() { controller.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  } catch (error) { return panFailure(error); }
}
