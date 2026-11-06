import { libraryGuard } from '@/lib/library-api-server';
import { panFailure } from '@/lib/netdisk-http';
import { aliMedia } from '@/lib/alipan-server';
export const runtime = 'nodejs';
export async function GET(req: Request) { const guard = libraryGuard(req); if (guard) return guard; try { return await aliMedia(req, new URL(req.url).searchParams.get('id') || ''); } catch (e) { return panFailure(e); } }
