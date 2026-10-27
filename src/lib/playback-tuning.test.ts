import { expect, it } from 'vitest';
import { bufferTarget, bufferedAhead, playbackDiagnosis } from './playback-tuning';
it('keeps high bitrate buffering within a budget instead of forcing several minutes into memory', () => { expect(bufferTarget(1024 * 1024)).toBe(90); expect(bufferTarget(8 * 1024 * 1024)).toBe(15); expect(bufferTarget(0, true)).toBe(35); expect(bufferTarget(1024 * 1024, true)).toBe(45); });
it('counts only the range covering the playhead, not disconnected future ranges', () => { const buffered = { length: 2, start: (i: number) => i ? 100 : 0, end: (i: number) => i ? 200 : 20 }; expect(bufferedAhead({ currentTime: 10, buffered })).toBe(10); expect(bufferedAhead({ currentTime: 30, buffered })).toBe(0); });
it('distinguishes starvation from decode/render drops while data is buffered', () => { expect(playbackDiagnosis(30, .2, true)).toContain('解码'); expect(playbackDiagnosis(0, 0, true)).toContain('缓冲不足'); expect(playbackDiagnosis(30, 0, false)).toContain('正常'); });
