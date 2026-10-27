import { libraryGuard } from '@/lib/library-api-server';
import { panBody, panFailure } from '@/lib/netdisk-http';
import { searchHlsResources } from '@/lib/hls-resources';
import { PanError } from '@/lib/netdisk-utils';
import { enabledResourceSources } from '@/lib/resource-source-store';
export const runtime = 'nodejs';
let activeSearches = 0;
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  try {
    const b = await panBody(req), keyword = typeof b.keyword === 'string' ? b.keyword.trim() : '';
    if (!keyword || keyword.length > 100) throw new PanError('请输入 1–100 字的影片名');
    if (activeSearches >= 3) throw new PanError('高清搜索任务较多，请稍后重试', 429);
    activeSearches++;
    const encoder = new TextEncoder(), controller = new AbortController();
    const body = new ReadableStream({ async start(stream) { const send = (v: unknown) => { if (!controller.signal.aborted) try { stream.enqueue(encoder.encode(JSON.stringify(v) + '\n')); } catch { controller.abort(); } }; send({ type: 'progress', sources: 0, total: enabledResourceSources('hls').length, checked: 0, candidates: 0 }); const timer = setInterval(() => send({ type: 'heartbeat' }), 8000); try { await searchHlsResources(keyword, AbortSignal.any([req.signal, controller.signal]), send); } finally { activeSearches--; clearInterval(timer); try { stream.close(); } catch { /* disconnected */ } } }, cancel() { controller.abort(); } });
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
  } catch (e) { return panFailure(e); }
}
