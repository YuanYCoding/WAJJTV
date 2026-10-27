import { NextResponse } from 'next/server';
import { libraryGuard } from '@/lib/library-api-server';
import { panBody, panFailure } from '@/lib/netdisk-http';
import { reserveExternalLease, touchPlaybackLease } from '@/lib/netdisk-storage';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  try { const body = await panBody(req); const id = typeof body.id === 'string' ? body.id : ''; return NextResponse.json(body.external === true ? { active: true, id: reserveExternalLease(req, id) } : touchPlaybackLease(req, id, body.release === true), { headers: { 'Cache-Control': 'no-store' } }); } catch (e) { return panFailure(e); }
}
