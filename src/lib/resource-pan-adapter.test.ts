import { afterEach, expect, it, vi } from 'vitest';
import { customPanSearch } from './resource-pan-adapter';
import { panGet } from './pan-public-fetch';
vi.mock('./pan-public-fetch', () => ({ panGet: vi.fn() }));
const base = { id: 'test', name: 'test', url: 'https://public.example/api/search', kind: 'pan' as const, enabled: true, adapter: 'pansou' };
afterEach(() => vi.clearAllMocks());
it('supports PanSou merged_by_type without forwarding any cloud account credentials', async () => { vi.mocked(panGet).mockResolvedValueOnce(JSON.stringify({ data: { merged_by_type: { quark: [{ note: '测试片', url: 'https://pan.quark.cn/s/abc123456789', password: 'abcd' }] } } })); const add = vi.fn(async () => {}); await customPanSearch(base, '测试片', 1, new AbortController().signal, add); expect(add).toHaveBeenCalledWith('测试片', expect.stringContaining('abcd')); expect(vi.mocked(panGet).mock.calls[0][2]).toEqual({ kw: '测试片', src: 'all', res: 'merge', refresh: false }); });
it('supports JSON rows and CMS-embedded share links with bounded public requests', async () => { for (const adapter of ['pan-json', 'pan-cms']) { vi.mocked(panGet).mockResolvedValueOnce(JSON.stringify({ list: [{ vod_name: '电影', vod_play_url: '正片$https://www.alipan.com/s/abc123456789' }] })); const add = vi.fn(async () => {}); await customPanSearch({ ...base, adapter }, '电影', 2, new AbortController().signal, add); expect(add).toHaveBeenCalledWith('电影', expect.stringContaining('alipan.com')); } });
