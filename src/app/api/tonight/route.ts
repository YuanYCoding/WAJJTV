import { NextResponse } from 'next/server';
import { getLibrary } from '@/lib/library-store';
import { libraryBody, libraryFailure, libraryGuard, requireProfile } from '@/lib/library-api-server';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const denied = libraryGuard(req); if (denied) return denied;
  try { return NextResponse.json(getLibrary().getTonight(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (err) { return libraryFailure(err); }
}
export async function POST(req: Request) {
  const denied = libraryGuard(req, true); if (denied) return denied;
  try {
    requireProfile(req);
    const body = await libraryBody(req);
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0 || (body.reset !== undefined && typeof body.reset !== 'boolean')) return NextResponse.json({ error: '选片版本无效' }, { status: 400 });
    return NextResponse.json(getLibrary().draw(Number(body.expectedVersion), body.reset === true));
  } catch (err) { return libraryFailure(err); }
}
