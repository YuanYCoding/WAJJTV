import { NextResponse } from 'next/server';
import { getLibrary } from '@/lib/library-store';
import { libraryBody, libraryFailure, libraryGuard, requireProfile } from '@/lib/library-api-server';
import type { Preference } from '@/lib/library-types';
export const runtime = 'nodejs';
export async function PUT(req: Request) {
  const denied = libraryGuard(req, true); if (denied) return denied;
  try {
    const profile = requireProfile(req);
    const body = await libraryBody(req);
    if (body.profile !== profile) return NextResponse.json({ error: '当前档案已经切换，请重新操作', code: 'PROFILE_CHANGED' }, { status: 409 });
    if (typeof body.filmId !== 'string' || ![null, 'want', 'watched', 'dismissed'].includes(body.status as Preference) || !Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) return NextResponse.json({ error: '片单状态无效' }, { status: 400 });
    return NextResponse.json({ item: getLibrary().setPreference(profile, body.filmId, body.status as Preference, Number(body.expectedRevision)) });
  } catch (err) { return libraryFailure(err); }
}
