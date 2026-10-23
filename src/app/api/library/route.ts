import { NextResponse } from 'next/server';
import { getLibrary } from '@/lib/library-store';
import { libraryFailure, libraryGuard } from '@/lib/library-api-server';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const denied = libraryGuard(req); if (denied) return denied;
  try { return NextResponse.json({ items: getLibrary().list() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (err) { return libraryFailure(err); }
}
