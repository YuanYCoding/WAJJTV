import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { guardRequest } from '@/lib/api-guard';

export const runtime = 'nodejs';
let cached: { path: string; mtime: number; size: number; etag: string; data: Buffer } | undefined;
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  try {
    const file = path.join(process.env.PRIVATE_ASSETS_DIR || path.join(process.cwd(), 'private'), 'mascots.png');
    const info = await stat(file);
    if (!cached || cached.path !== file || cached.mtime !== info.mtimeMs || cached.size !== info.size) {
      const data = await readFile(file);
      cached = { path: file, mtime: info.mtimeMs, size: info.size, data, etag: '"' + createHash('sha256').update(data).digest('hex') + '"' };
    }
    // Store bytes locally but revalidate authentication before reuse; never place private artwork in a shared CDN cache.
    const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-cache', ETag: cached.etag, Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
    if (req.headers.get('if-none-match')?.split(',').map((value) => value.trim().replace(/^W\//, '')).includes(cached.etag)) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(cached.data), { headers });
  } catch {
    return new Response(null, { status: 404 });
  }
}
