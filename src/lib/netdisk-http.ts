import { NextResponse } from 'next/server';
import { PanError } from './netdisk-utils';
export function panFailure(err: unknown) {
  return NextResponse.json({ error: err instanceof PanError ? err.message : '网盘服务暂时不可用，请稍后重试', code: err instanceof PanError ? err.code : 'SERVICE_UNAVAILABLE' }, { status: err instanceof PanError ? err.status : 503, headers: { 'Cache-Control': 'no-store' } });
}
export async function panBody(req: Request): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader(); if (!reader) throw new PanError('缺少请求内容');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 32_768) { await reader.cancel(); throw new PanError('请求内容过大', 413); } chunks.push(value); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw new PanError('请求格式错误'); }
}
