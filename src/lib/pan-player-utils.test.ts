import { describe, expect, it } from 'vitest';
import { chooseFullQuality, lowerFullQuality, proxyFallbackUrl, seekPosition } from './pan-player-utils';
import type { PanQuality } from './netdisk-types';
const q = (height: number, kind: 'hls' | 'video' = 'hls', limited = false): PanQuality => ({ height, kind, limited, label: String(height), url: '/video-' + height + '-' + kind });
describe('cloud playback policies', () => {
  it('prioritizes an explicitly returned complete original without mistaking a limited preview for original quality', () => { const original = { ...q(2160, 'video'), original: true }; expect(chooseFullQuality([q(720), original])).toBe(original); expect(chooseFullQuality([{ ...original, limited: true }, q(720)])?.height).toBe(720); });
  it('prefers complete transcoded playback over a huge original or a short high-resolution sample', () => { expect(chooseFullQuality([q(2160, 'video'), q(1080, 'hls', true), q(720), q(540)])?.height).toBe(720); expect(chooseFullQuality([q(2160), q(1080), q(720)])?.height).toBe(1080); expect(chooseFullQuality([q(1080, 'hls', true)])).toBeUndefined(); });
  it('downgrades within complete streams and can replace an original with an equivalent-resolution transcode', () => { expect(lowerFullQuality([q(720), q(540), q(1080, 'hls', true)], q(720))?.height).toBe(540); expect(lowerFullQuality([q(720)], q(720, 'video'))?.kind).toBe('hls'); expect(lowerFullQuality([q(720)], q(720))).toBeUndefined(); });
  it('supports predictable fast-forward, rewind and boundary clamping', () => { expect(seekPosition(60, 10, 120)).toBe(70); expect(seekPosition(5, -10, 120)).toBe(0); expect(seekPosition(110, 60, 120)).toBeCloseTo(119.9); expect(seekPosition(30, 10, NaN)).toBe(30); });
  it('falls back only for same-origin opaque media tickets', () => { expect(proxyFallbackUrl('/api/alipan/media?id=opaque&direct=1')).toBe('https://cinema.test/api/alipan/media?id=opaque&direct=0'); expect(proxyFallbackUrl('https://other.test/api/alipan/media?id=x&direct=1')).toBeNull(); expect(proxyFallbackUrl('/api/alipan/media?id=x&direct=0')).toBeNull(); });
});
