import { NextResponse } from 'next/server';
import { libraryGuard, libraryBody } from '@/lib/library-api-server';
import { beginCloudLogin, finishCloudLogin, cloudStatus, cloudFiles, cloudPlayback, disconnectCloud, CloudError } from '@/lib/cloud-server';
import { cloudFailure } from '@/lib/cloud-http';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guard = libraryGuard(req); if (guard) return guard;
  try {
    const params = new URL(req.url).searchParams;
    const value = params.get('action') === 'files'
      ? await cloudFiles(params.get('drive') || '', params.get('folder') || 'root', params.get('marker') || '')
      : cloudStatus();
    return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) { return cloudFailure(err); }
}
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  try {
    const body = await libraryBody(req);
    const value = body.action === 'login' ? await beginCloudLogin(req)
      : body.action === 'finish' ? await finishCloudLogin(req, String(body.id || ''))
      : body.action === 'disconnect' ? disconnectCloud()
      : body.action === 'play' ? await cloudPlayback(String(body.drive || ''), String(body.file || ''))
      : null;
    if (!value) throw new CloudError('未知的网盘操作');
    return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) { return cloudFailure(err); }
}
