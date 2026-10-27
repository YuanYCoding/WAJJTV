import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import type { SearchResponse, SearchStreamEvent, SourceConfig } from '@/lib/types';
import { recordSourceResult } from '@/lib/source-health-server';

/**
 * 聚合搜索接口单测：跨源聚合、同源去重、精确命中置顶、成人内容过滤、
 * 失败源不影响整体、SSRF 字面量拒绝。上游一律 mock fetch，无真实网络。
 */

function cmsList(items: Array<Record<string, unknown>>, pagecount = 1): string {
  return JSON.stringify({ code: 1, pagecount, list: items });
}

/** 按 URL 分发的上游 mock：cms-a 正常、cms-b 500、cms-c 与 a 有重叠条目 */
function mockUpstream(): void {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('cms-a.example')) {
      return new Response(
        cmsList([
          { vod_id: 1, vod_name: '测试剧', type_name: '国产剧' },
          { vod_id: 2, vod_name: '测试剧外传', type_name: '国产剧' },
          { vod_id: 3, vod_name: '福利速递', type_name: '福利视频' },
          // 同源同 vod_id 的重复条目：聚合时须按 sourceKey_vodId 去重
          { vod_id: 1, vod_name: '测试剧', type_name: '国产剧' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('cms-b.example')) {
      return new Response('server error', { status: 500 });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
}

function makeRequest(body: unknown, stream = false): Request {
  const { token } = signSession();
  return new Request(`https://local.test/api/search${stream ? '?stream=1' : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `${SESSION_COOKIE}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

const SOURCES = [
  { key: 'a', name: '源A', url: 'https://cms-a.example.com/api.php' },
  { key: 'b', name: '源B', url: 'https://cms-b.example.com/api.php' },
];

beforeAll(() => {
  process.env.PASSWORD = 'test-password-123';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/search', () => {
  it('retries a transient first-page 503 once within the source deadline', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(cmsList([{ vod_id: 1, vod_name: '临时恢复' }])));
    vi.stubGlobal('fetch', fetchSpy);
    const source = { key: 'retry-503', name: '暂时繁忙', url: 'https://cms.example.com/retry-503' };
    const data = await (await POST(makeRequest({ wd: '临时恢复', sources: [source] }))).json();
    expect(data.list).toHaveLength(1);
    expect(data.failures).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('searches every distinct endpoint beyond fifty and reports unmatched sources separately', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(cmsList(new URL(String(input)).pathname.endsWith('/empty') ? [] : [{vod_id:1,vod_name:'全源覆盖'}]))));
    const sources = Array.from({length:61}, (_,i)=>({key:`coverage-${i}`,name:`源${i}`,url:`https://cms.example.com/coverage-${i}${i===60?'/empty':''}`}));
    const res=await POST(makeRequest({wd:'全源覆盖',sources}));
    const data=await res.json();
    expect(data.list).toHaveLength(60);
    expect(data.stats).toEqual({queried:61,matched:60,empty:1,failed:0});
  });
  it('第一页立即显示，第二页失败也保留第一页且只结算一次健康度', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input)).searchParams.get('pg') === '2') { await pending; return new Response('failed', { status: 502 }); }
      return new Response(cmsList([{ vod_id: 1, vod_name: '分页体验' }], 2));
    }));
    const source = { key: 'paging', name: '分页源', url: 'https://cms.example.com/partial-first' };
    const response = await POST(makeRequest({ wd: '分页体验', sources: [source] }, true));
    const reader = response.body!.getReader();
    try {
      const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).trim());
      expect(first).toMatchObject({ type: 'source', partial: true, ok: true, list: [{ name: '分页体验' }] });
    } finally { release(); }
    let remaining = '';
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; remaining += new TextDecoder().decode(chunk.value); }
    const events = remaining.trim().split('\n').map((s) => JSON.parse(s));
    expect(events[0]).toMatchObject({ type: 'source', ok: true, incomplete: true, list: [{ name: '分页体验' }] });
    expect(events.at(-1).list).toHaveLength(1);
  });

  it('缓存不会让后台已判失效的线路重新参加搜索', async () => {
    const source = { key: 'cached-health', name: '源', url: 'https://cms.example.com/cached-health' };
    const fetchSpy = vi.fn(async () => new Response(cmsList([{ vod_id: 1, vod_name: '缓存健康' }])));
    vi.stubGlobal('fetch', fetchSpy);
    await (await POST(makeRequest({ wd: '缓存健康', sources: [source] }))).json();
    recordSourceResult(source.url, false); recordSourceResult(source.url, false);
    const res = await POST(makeRequest({ wd: '缓存健康', sources: [source] }));
    expect((await res.json()).list).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
  it('失效源即使被客户端提交也不发请求，复检成功后才重新搜索', async () => {
    const source = { key: 'circuit', name: '复检源', url: 'https://cms.example.com/circuit-recovery-test' };
    recordSourceResult(source.url, false, 100, 'HTTP 500');
    recordSourceResult(source.url, false, 100, 'HTTP 500');
    const upstream = vi.fn(async () => new Response(cmsList([{ vod_id: 1, vod_name: '恢复' }])));
    vi.stubGlobal('fetch', upstream);
    const blocked = await POST(makeRequest({ wd: '停用', sources: [source] }, true));
    const first = JSON.parse((await blocked.text()).split('\n')[0]);
    expect(first).toMatchObject({ skipped: true, ok: false });
    expect(upstream).not.toHaveBeenCalled();
    recordSourceResult(source.url, true, 100);
    const recovered = await POST(makeRequest({ wd: '恢复', sources: [source] }));
    expect((await recovered.json()).list).toHaveLength(1);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it('快源结果先送达，慢源未完成时仍能读取首个事件', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/slow-stream')) await pending;
      return new Response(cmsList([{ vod_id: 1, vod_name: '流式验证' }]));
    }));
    const sources = [{ key: 'fast', name: '快源', url: 'https://cms.example.com/fast-stream' }, { key: 'slow', name: '慢源', url: 'https://cms.example.com/slow-stream' }];
    const response = await POST(makeRequest({ wd: '流式验证', sources }, true));
    const reader = response.body!.getReader();
    try {
      const chunk = await reader.read();
      expect(JSON.parse(new TextDecoder().decode(chunk.value).trim())).toMatchObject({ type: 'source', sourceKey: 'fast', ok: true });
    } finally { release(); }
    while (!(await reader.read()).done) { /* Drain the completed slow source and final event. */ }
  });

  it('相同 URL 的不同本地 key 不会命中错误的结果映射', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(cmsList([{ vod_id: 9, vod_name: '缓存映射' }]))));
    const source = { key: 'old-key', name: '源', url: 'https://cms.example.com/cache-identity' };
    await (await POST(makeRequest({ wd: '缓存映射', sources: [source] }))).json();
    const response = await POST(makeRequest({ wd: '缓存映射', sources: [{ ...source, key: 'new-key' }] }));
    expect((await response.json()).list[0].sourceKey).toBe('new-key');
  });

  it('聚合多源结果：同源去重、成人内容过滤、失败源进 failures', async () => {
    mockUpstream();
    const res = await POST(makeRequest({ wd: '测试剧', sources: SOURCES, filterAdult: true }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      list: Array<{ sourceKey: string; vodId: string; name: string }>;
      failures: Array<{ sourceKey: string; error: string }>;
    };

    // 源A 的 4 条 → 去重后 2 条有效 + 成人条目被过滤
    const aItems = data.list.filter((i) => i.sourceKey === 'a');
    expect(aItems).toHaveLength(2);
    expect(aItems.map((i) => i.vodId).sort()).toEqual(['1', '2']);

    // 源B 500 → 记入 failures，不影响源A 的结果
    expect(data.failures).toHaveLength(1);
    expect(data.failures[0].sourceKey).toBe('b');
    expect(data.failures[0].error).toContain('500');
  });

  it('精确命中（忽略标点差异）排在最前', async () => {
    mockUpstream();
    const res = await POST(makeRequest({ wd: '测试剧', sources: [SOURCES[0]], filterAdult: true }));
    const data = (await res.json()) as { list: Array<{ name: string }> };
    expect(data.list[0]?.name).toBe('测试剧');
  });

  it('内网字面量地址在发起请求前被 SSRF 校验拒绝', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(
      makeRequest({
        wd: 'x',
        sources: [{ key: 'evil', name: '内网', url: 'http://192.168.1.100/api.php' }],
        filterAdult: false,
      })
    );
    const data = (await res.json()) as { failures: Array<{ sourceKey: string; error: string }> };
    expect(data.failures[0]?.sourceKey).toBe('evil');
    // 上游一次请求都不应发生
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stream=1 以 NDJSON 逐源推送并以 done 事件收尾', async () => {
    mockUpstream();
    // 用不同源地址避开同键短缓存，保留有实际匹配结果的关键词。
    const sourcesForStream = SOURCES.map((source) => ({ ...source, url: source.url + '/stream' }));
    const res = await POST(makeRequest({ wd: '测试剧', sources: sourcesForStream, filterAdult: true }, true));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; sourceKey?: string });
    const sources = lines.filter((l) => l.type === 'source');
    const done = lines.filter((l) => l.type === 'done');
    // 每个源恰好一条 source 事件（含失败的源B），最后一条是 done
    expect(sources.map((l) => l.sourceKey).sort()).toEqual(['a', 'b']);
    expect(done).toHaveLength(1);
    expect(lines[lines.length - 1].type).toBe('done');
  });

  it.each([true, false])('逐源、最终与缓存结果使用相同过滤规则（成人过滤：%s）', async (filterAdult) => {
    const sources: SourceConfig[] = [
      { key: 'good', name: '有效源', url: `https://cms.example.com/consistent-${filterAdult}` },
      { key: 'bad', name: '失败源', url: `https://cms.example.com/failed-${filterAdult}` },
    ];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/failed-')) return new Response('unavailable', { status: 500 });
      return new Response(cmsList([
        { vod_id: 1, vod_name: '赛博朋克：边缘行者第二季', type_name: '动漫' },
        { vod_id: 1, vod_name: '赛博朋克：边缘行者第二季', type_name: '动漫' },
        { vod_id: 2, vod_name: '10月17日德甲联赛', type_name: '足球' },
        { vod_id: 3, vod_name: '', type_name: '动漫' },
        { vod_id: 4, vod_name: '赛博朋克：边缘行者第二季', type_name: '福利视频' },
      ]), { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const body = { wd: '赛博朋克：边缘行者 2', sources, filterAdult };
    const stream = await POST(makeRequest(body, true));
    const events = (await stream.text()).trim().split('\n').map((line) => JSON.parse(line) as SearchStreamEvent);
    const good = events.find((event) => event.type === 'source' && event.sourceKey === 'good');
    const failed = events.find((event) => event.type === 'source' && event.sourceKey === 'bad');
    const done = events.find((event) => event.type === 'done');
    const ids = filterAdult ? ['1'] : ['1', '4'];
    expect(good?.list.map((item) => item.vodId)).toEqual(ids);
    expect(good).toMatchObject({ type: 'source', sourceKey: 'good', ok: true, ms: expect.any(Number) });
    expect(failed).toMatchObject({ type: 'source', sourceKey: 'bad', ok: false, list: [], error: 'HTTP 500' });
    expect(done).toMatchObject({ type: 'done', list: good?.list, failures: [{ sourceKey: 'bad', error: 'HTTP 500' }] });

    // 同一缓存同时服务 JSON 和流式客户端，不能重新引入原始杂项。
    const calls = fetchSpy.mock.calls.length;
    const json = await POST(makeRequest(body));
    const cached = await json.json() as SearchResponse;
    expect(cached.list).toEqual(good?.list);
    expect(cached.failures).toEqual(done?.type === 'done' ? done.failures : undefined);
    const cachedStream = await POST(makeRequest(body, true));
    const cachedEvents = (await cachedStream.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(cachedEvents.at(-1).list).toEqual(good?.list);
    expect(cachedEvents.find((e) => e.sourceKey === 'good')).toMatchObject({ ok: true, cached: true });
    expect(cachedEvents.find((e) => e.sourceKey === 'bad')).toMatchObject({ ok: false, skipped: true });
    // 成功源单独缓存；失败不缓存，第二次真实失败后进入复检，不再拖慢第三次搜索。
    expect(fetchSpy).toHaveBeenCalledTimes(calls + 1);

    // 新地址走非缓存 JSON 分支，仍须得到相同的筛选结果。
    const fresh = await POST(makeRequest({ ...body, sources: sources.map((source) => ({ ...source, url: source.url + '/fresh' })) }));
    const freshData = await fresh.json() as SearchResponse;
    expect(freshData.list.map((item) => item.vodId)).toEqual(ids);
    expect(freshData.failures).toEqual(cached.failures);
  });

  it('没有相关结果时，各响应模式均保留空列表', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(cmsList([
      { vod_id: 1, vod_name: '10月17日德甲联赛', type_name: '足球' },
      { vod_id: 2, vod_name: '', type_name: '动漫' },
    ]))));
    const body = {
      wd: '赛博朋克：边缘行者 2',
      sources: [{ key: 'empty', name: '不相关源', url: 'https://cms.example.com/no-relevant-results' }],
    };
    const res = await POST(makeRequest(body, true));
    const events = (await res.text()).trim().split('\n').map((line) => JSON.parse(line) as SearchStreamEvent);
    expect(events).toHaveLength(2);
    for (const event of events) expect(event.list).toEqual([]);
    expect(events[0]).toMatchObject({ type: 'source', ok: true });
    expect(events[1]).toMatchObject({ type: 'done', failures: [] });
    const cached = await POST(makeRequest(body));
    expect(await cached.json()).toMatchObject({ list: [], failures: [] });
    const cachedStream = await POST(makeRequest(body, true));
    expect(JSON.parse((await cachedStream.text()).trim())).toMatchObject({ type: 'done', list: [], failures: [] });
    const fresh = await POST(makeRequest({ ...body, sources: [{ ...body.sources[0], url: body.sources[0].url + '/fresh' }] }));
    expect(await fresh.json()).toMatchObject({ list: [], failures: [] });
  });

  it('未登录返回 401，未配置密码返回 503', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const saved = process.env.PASSWORD;
    delete process.env.PASSWORD;
    try {
      const noPassword = await POST(makeRequest({ wd: 'x', sources: SOURCES }));
      expect(noPassword.status).toBe(503);
    } finally {
      process.env.PASSWORD = saved;
    }
    const noCookie = new Request('https://local.test/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wd: 'x', sources: SOURCES }),
    });
    const unauthorized = await POST(noCookie);
    expect(unauthorized.status).toBe(401);
  });
});
