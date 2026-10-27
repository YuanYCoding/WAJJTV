import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type Hls from 'hls.js';
import { createHlsLoader } from './hls-loader';
import { readCachedSegment } from './video-cache';
vi.mock('./video-cache', () => ({ buildSegmentCacheKey: (v: string) => v, readCachedSegment: vi.fn(), touchMeta: vi.fn() }));
const load = vi.fn();
class Base { stats = {}; load = load; abort() {} destroy() {} }
const make = () => new (createHlsLoader({ DefaultConfig: { loader: Base } } as unknown as typeof Hls))({});
beforeEach(() => { vi.useFakeTimers(); load.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it('falls back immediately when browser cache storage rejects instead of leaving playback waiting', async () => { vi.mocked(readCachedSegment).mockRejectedValueOnce(new Error('storage unavailable')); const loader = make(); loader.load({ url: 'https://video.test/a.ts' }, {}, {}); await vi.runAllTimersAsync(); expect(load).toHaveBeenCalledTimes(1); });
it('does not let stalled cache access delay the foreground video request indefinitely', async () => { let resolve!: (v: null) => void; vi.mocked(readCachedSegment).mockReturnValueOnce(new Promise((r) => { resolve = r; })); const loader = make(); loader.load({ url: 'https://video.test/a.ts' }, {}, {}); await vi.advanceTimersByTimeAsync(121); expect(load).toHaveBeenCalledTimes(1); resolve(null); await vi.runAllTimersAsync(); expect(load).toHaveBeenCalledTimes(1); });
it('does not start a network request after the player has been destroyed', async () => { vi.mocked(readCachedSegment).mockReturnValueOnce(new Promise(() => {})); const loader = make(); loader.load({ url: 'https://video.test/a.ts' }, {}, {}); loader.destroy(); await vi.runAllTimersAsync(); expect(load).not.toHaveBeenCalled(); });
