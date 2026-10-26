import { libraryGuard } from '@/lib/library-api-server';
import { quarkMedia } from '@/lib/quark-server';
import { panFailure } from '@/lib/netdisk-http';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guard = libraryGuard(req); if (guard) return guard;
  try { return await quarkMedia(req, new URL(req.url).searchParams.get('id') || ''); }
  catch (error) { return panFailure(error); }
}
