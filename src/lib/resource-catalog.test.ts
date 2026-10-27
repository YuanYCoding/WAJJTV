import { afterEach, describe, expect, it, vi } from 'vitest';
import { aipanCatalog, validMagnet } from './resource-catalog';
import { fetchUpstream } from './fetch-utils';
vi.mock('./fetch-utils', () => ({ fetchUpstream: vi.fn() }));
afterEach(() => vi.clearAllMocks());
describe('public resource catalog', () => {
  it('accepts BT links and rejects script URLs or invalid hashes', () => {
    expect(validMagnet('magnet:?xt=urn:btih:' + 'a'.repeat(40))).toContain('magnet:');
    expect(validMagnet('javascript:alert(1)')).toBe(''); expect(validMagnet('magnet:?xt=urn:btih:bad')).toBe('');
  });
  it('keeps public pan and magnet links, avoids unrelated movies and never sends cloud credentials', async () => {
    vi.mocked(fetchUpstream).mockImplementation(async (url, options) => {
      const headers = new Headers(options?.headers); expect(headers.has('Cookie')).toBe(false); expect(headers.has('Authorization')).toBe(false);
      return new Response(JSON.stringify(String(url).includes('/search?') ? { movies: [{ id: '1', title: '目录测试电影' }, { id: '2', title: '其他影片' }] } : { panLinks: [{ kind: 'quark', url: 'https://pan.quark.cn/s/catalogtest123', title: '4K' }], resources: [{ kind: 'magnet', url: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), name: '2160P' }] }));
    });
    const movies = await aipanCatalog('目录测试电影', 1, new AbortController().signal); expect(movies).toHaveLength(1); expect(movies[0].links).toHaveLength(2);
    await aipanCatalog('目录测试电影', 1, new AbortController().signal); expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });
});
