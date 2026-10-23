import { NextResponse } from 'next/server';
import { CloudError } from './cloud-server';
export function cloudFailure(err: unknown) {
  return NextResponse.json({ error: err instanceof CloudError ? err.message : '网盘服务暂时不可用，请稍后重试' }, { status: err instanceof CloudError ? err.status : 503, headers: { 'Cache-Control': 'no-store' } });
}
