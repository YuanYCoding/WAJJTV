import { guardRequest } from '@/lib/api-guard';
import { musicTicket } from '@/lib/music-server';
import { fetchWithSafeRedirects } from '@/lib/fetch-utils';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guard = guardRequest(req); if (guard) return guard;
  const ticket = musicTicket(new URL(req.url).searchParams.get('ticket') || '');
  if (!ticket) return Response.json({ error: '音频地址已过期，请重新点击播放' }, { status: 410 });
  const range = req.headers.get('range');
  if (range && !/^bytes=\d*-\d*$/.test(range)) return new Response(null, { status: 416 });
  try {
    const { res } = await fetchWithSafeRedirects(ticket.url, { signal: req.signal, headers: { ...(range ? { Range: range } : {}), 'User-Agent': 'Mozilla/5.0' } }, { headerTimeoutMs: 10_000 });
    if (![200, 206, 416].includes(res.status)) { await res.body?.cancel(); return new Response(null, { status: 502 }); }
    const headers = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const value = res.headers.get(name); if (value) headers.set(name, value); }
    if (ticket.mimeType) headers.set('content-type', ticket.mimeType);
    if (res.status !== 416 && !/audio|octet-stream|video\/mp4/i.test(headers.get('content-type') || '')) { await res.body?.cancel(); return new Response(null, { status: 502 }); }
    return new Response(res.body, { status: res.status, headers });
  } catch { return new Response(null, { status: 502 }); }
}
