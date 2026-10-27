import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { readSourceHealth, startSourceMonitor } from '@/lib/source-health-server';

export const runtime = 'nodejs';
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  startSourceMonitor();
  try {
    const body = await req.json();
    if (!Array.isArray(body.sources) || body.sources.length > 100) return NextResponse.json({ error: '源列表无效' }, { status: 400 });
    const entries = body.sources.filter((s: {key?: unknown; url?: unknown}) => typeof s?.key === 'string' && typeof s?.url === 'string')
      .map((s: { key: string; url: string }) => ({ key: s.key, health: readSourceHealth(s.url) || null }));
    return NextResponse.json({ entries }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: '请求无效' }, { status: 400 }); }
}
