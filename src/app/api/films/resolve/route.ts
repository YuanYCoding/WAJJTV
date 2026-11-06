import { NextResponse } from 'next/server';
import { getLibrary } from '@/lib/library-store';
import { libraryBody, libraryFailure, libraryGuard, requireProfile, validateFilm } from '@/lib/library-api-server';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const denied = libraryGuard(req, true); if (denied) return denied;
  try {
    requireProfile(req);
    const body = await libraryBody(req);
    if (body.decision !== undefined && body.decision !== 'link' && body.decision !== 'separate') return NextResponse.json({ error: '确认方式无效' }, { status: 400 });
    return NextResponse.json({ item: getLibrary().resolve(validateFilm(body.film), body.decision as 'link' | 'separate' | undefined, typeof body.existingId === 'string' ? body.existingId : undefined) });
  } catch (err) { return libraryFailure(err); }
}
