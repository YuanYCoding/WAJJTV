import { NextResponse } from 'next/server';
import { isProfile, PROFILES } from '@/lib/library-types';
import { cookieIsSecure } from '@/lib/auth';
import { libraryBody, libraryFailure, libraryGuard, PROFILE_COOKIE, requestProfile } from '@/lib/library-api-server';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const denied = libraryGuard(req); if (denied) return denied;
  return NextResponse.json({ profile: requestProfile(req), profiles: PROFILES }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function PUT(req: Request) {
  const denied = libraryGuard(req, true); if (denied) return denied;
  try {
    const body = await libraryBody(req);
    if (!isProfile(body.profile)) return NextResponse.json({ error: '档案无效' }, { status: 400 });
    const response = NextResponse.json({ profile: body.profile, profiles: PROFILES });
    response.cookies.set(PROFILE_COOKIE, body.profile, { httpOnly: true, sameSite: 'lax', secure: cookieIsSecure(req), path: '/', maxAge: 90 * 86400 });
    return response;
  } catch (err) { return libraryFailure(err); }
}
