import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { probeSource } from '@/lib/source-health-server';

export const runtime = 'nodejs';

/** 点播源探活：以搜索 "test" 的响应耗时与结果量衡量可用性 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let url = '';
  try {
    const body = (await req.json()) as { url?: string };
    url = (body.url || '').trim().replace(/\/+$/, '');
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: '无效的源地址' }, { status: 400 });
  }

  const verdict = await checkUpstreamAllowed(url);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, ms: 0, error: verdict.reason });
  }

  const health = await probeSource(url);
  return NextResponse.json({ ok: health.status === 'healthy', ms: health.ms, error: health.error, count: 0 });
}
