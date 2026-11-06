import { guardRequest } from '@/lib/api-guard';
import verified4k from '@/lib/verified-4k.json';
import { enabledResourceSources } from '@/lib/resource-source-store';
export async function GET(req: Request) {
  const guard = guardRequest(req); if (guard) return guard;
  const enabled = enabledResourceSources('hls').some((s) => s.id === 'hls-zuid' && new URL(s.url).hostname === 'api.zuidapi.com');
  return Response.json({ count: enabled ? verified4k.length : 0, items: enabled ? verified4k.map((v) => ({ title: v.title, width: v.width, height: v.height, checkedAt: v.checkedAt })) : [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}
