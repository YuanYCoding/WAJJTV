import { libraryGuard } from '@/lib/library-api-server';
import { libraryBody } from '@/lib/library-api-server';
import { panFailure } from '@/lib/netdisk-http';
import { resourceSources, saveResourceSources, resourceHealth, recordResourceHealth, validateResourceSources } from '@/lib/resource-source-store';
import { DEFAULT_RESOURCE_SOURCES } from '@/lib/resource-source-defaults';
import { inspectHls, hlsEpisodes } from '@/lib/hls-resources';
import { panGet } from '@/lib/pan-public-fetch';
import { testPanSource } from '@/lib/netdisk-search';
import { customPanSearch } from '@/lib/resource-pan-adapter';
import { PanError } from '@/lib/netdisk-utils';
export const runtime = 'nodejs';
let tests = 0;
export async function GET(req: Request) { const guard = libraryGuard(req); if (guard) return guard; try { const c = resourceSources(); return Response.json({ ...c, health: Object.fromEntries(c.sources.map((s) => [s.id, resourceHealth(s)])), defaults: DEFAULT_RESOURCE_SOURCES }, { headers: { 'Cache-Control': 'private, no-store' } }); } catch (e) { return panFailure(e); } }
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  try {
    const b = await libraryBody(req);
    if (b.action === 'save') return Response.json(await saveResourceSources(b.revision, b.sources));
    if (b.action !== 'test') throw new PanError('无效操作');
    if (tests >= 2) throw new PanError('测试任务较多，请稍后重试', 429);
    const source = validateResourceSources([b.source])[0], keyword = typeof b.keyword === 'string' ? b.keyword.trim().slice(0, 100) : '星际穿越'; if (!keyword) throw new PanError('请填写测试片名');
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(25_000)]), started = Date.now(); tests++;
    try {
      let count = 0, sample;
      if (source.kind === 'hls') {
        const u = new URL(source.url); u.searchParams.set('ac', 'detail'); u.searchParams.set('wd', keyword);
        const data = JSON.parse(await panGet(u.href, signal)); if (!Array.isArray(data.list)) throw new Error('目录格式无效'); count = data.list.length;
        const movie = data.list.find((v: Record<string, unknown>) => hlsEpisodes(v.vod_play_url).length);
        if (movie) { const ep = hlsEpisodes(movie.vod_play_url)[0]; sample = await inspectHls(ep.url, signal); }
      } else if (['pansou', 'pan-json', 'pan-cms'].includes(source.adapter)) await customPanSearch(source, keyword, 1, signal, async () => { count++; });
      else {
        count = await testPanSource(source, keyword, signal);
      }
      const ms = Date.now() - started; recordResourceHealth(source, true, ms, undefined, sample);
      return Response.json({ ok: true, ms, count, sample, message: sample ? '目录与样本检测完成，画质仅代表本次样本' : count ? '目录返回结果；可播放性需打开资源进一步确认' : '接口可响应，本次关键词没有结果' });
    } catch (e) { const error = e instanceof Error ? e.message : '测试失败'; recordResourceHealth(source, false, Date.now() - started, error); return Response.json({ ok: false, error }); } finally { tests--; }
  } catch (e) { return panFailure(e); }
}
