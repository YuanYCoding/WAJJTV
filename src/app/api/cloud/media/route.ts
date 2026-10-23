import { libraryGuard } from '@/lib/library-api-server';
import { cloudMedia } from '@/lib/cloud-server';
import { cloudFailure } from '@/lib/cloud-http';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guard = libraryGuard(req); if (guard) return guard;
  try { return await cloudMedia(new URL(req.url).searchParams.get('id') || '', req); }
  catch (err) { return cloudFailure(err); }
}
