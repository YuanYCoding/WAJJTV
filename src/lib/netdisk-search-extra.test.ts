import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchNetdisk } from './netdisk-search';
import { fetchUpstream } from './fetch-utils';
import type { PanSearchEvent } from './netdisk-types';
vi.mock('./fetch-utils', () => ({ fetchUpstream: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('expanded cloud search', () => {
  it('streams Aliyun results, deduplicates domains, caches per page, and does not send account credentials to search providers', async () => {
    const calls: string[] = [];
    vi.mocked(fetchUpstream).mockImplementation(async (url, options) => {
      const u = new URL(String(url)); calls.push(u.href); expect(new Headers(options?.headers).has('Cookie')).toBe(false); expect(new Headers(options?.headers).has('Authorization')).toBe(false);
      const suffix = u.searchParams.get('page') === '2' ? 'two' : 'one';
      return new Response(JSON.stringify({ code: 0, data: `<a url="https://www.aliyundrive.com/s/abcdef${suffix}" pa="abcd">战狼2测试</a><a url="https://www.alipan.com/s/abcdef${suffix}" pa="abcd">战狼2测试</a>` }));
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ share_token: 'private-proof' }))));
    const first: PanSearchEvent[] = []; await searchNetdisk('战狼2测试', ['yunso'], (v) => first.push(v), new AbortController().signal, { provider: 'aliyun' });
    const results = first.flatMap((v) => v.type === 'results' ? v.list : []); expect(results).toHaveLength(1); expect(results[0].provider).toBe('aliyun'); expect(JSON.stringify(first)).not.toContain('private-proof');
    await searchNetdisk('战狼2测试', ['yunso'], () => {}, new AbortController().signal, { provider: 'aliyun' }); expect(calls).toHaveLength(1);
    const second: PanSearchEvent[] = []; await searchNetdisk('战狼2测试', ['yunso'], (v) => second.push(v), new AbortController().signal, { provider: 'aliyun', page: 2 }); expect(calls).toHaveLength(2); expect(second.flatMap((v) => v.type === 'results' ? v.list : [])[0].shareUrl).toContain('two');
  });
  it('a failed source does not hide another source and known canceled shares are excluded', async () => {
    vi.mocked(fetchUpstream).mockImplementation(async (url) => {
      if (String(url).includes('yunso.net')) throw new Error('offline');
      return new Response(JSON.stringify({ code: 200, data: { list: [{ disk_name: '血战钢锯岭测试', link: 'https://pan.quark.cn/s/abc123456789' }, { disk_name: '血战钢锯岭测试', link: 'https://pan.quark.cn/s/def123456789' }] } }));
    });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify(String(init.body).includes('abc123') ? { code: 41012 } : { data: { stoken: 'private' } }))));
    const events: PanSearchEvent[] = []; await searchNetdisk('血战钢锯岭测试', ['yunso', 'melost'], (v) => events.push(v), new AbortController().signal, { provider: 'quark' });
    expect(events.flatMap((v) => v.type === 'results' ? v.list : []).map((v) => v.shareUrl)).toEqual(['https://pan.quark.cn/s/def123456789']); expect(events.at(-1)).toMatchObject({ type: 'done', count: 1, failures: 1 });
  });
});
