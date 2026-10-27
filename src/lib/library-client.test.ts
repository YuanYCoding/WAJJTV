import { afterEach, expect, it, vi } from 'vitest';
import { libraryApi } from './library-client';
afterEach(() => vi.unstubAllGlobals());
it('turns a proxy HTML failure into a readable error instead of exposing a JSON parser exception', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<h1>Bad gateway</h1>', { status: 502 })));
  await expect(libraryApi.list()).rejects.toThrow('片单服务响应异常，请刷新后重试');
});
