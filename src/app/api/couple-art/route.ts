import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { guardRequest } from '@/lib/api-guard';

export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  try {
    const data = await readFile(path.join(process.env.PRIVATE_ASSETS_DIR || path.join(process.cwd(), 'private'), 'mascots.png'));
    return new Response(data, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
