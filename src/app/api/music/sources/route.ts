import { guardRequest } from '@/lib/api-guard';
import { musicHealth, musicResolverHealth } from '@/lib/music-server';
import { MUSIC_INTERFACES } from '@/lib/music-interfaces';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guard = guardRequest(req); if (guard) return guard;
  return Response.json({ sources: musicHealth(), interfaces: MUSIC_INTERFACES, resolvers: musicResolverHealth() }, { headers: { 'Cache-Control': 'private, no-store' } });
}
