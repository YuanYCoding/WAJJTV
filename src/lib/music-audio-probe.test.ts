import { describe, expect, it, vi } from 'vitest';
const fetchers = vi.hoisted(() => ({ first: vi.fn(), range: vi.fn() }));
vi.mock('./fetch-utils', () => ({ fetchUpstreamWithMeta: fetchers.first, fetchUpstream: fetchers.range }));
import { probeMusicAudio, validateFullMusic } from './music-audio-probe';
import { MusicRangeTokenizer } from './music-range-tokenizer';
function flac(duration: number, bits = 24) {
  const b = Buffer.alloc(42); b.write('fLaC'); b[4] = 0x80; b[7] = 34;
  b.writeUInt16BE(4096, 8); b.writeUInt16BE(4096, 10);
  b.writeBigUInt64BE((44100n << 44n) | (1n << 41n) | (BigInt(bits - 1) << 36n) | BigInt(Math.round(duration * 44100)), 18); return b;
}
describe('bounded music metadata', () => {
  it('uses actual FLAC bytes despite an incorrect HTTP MIME type', async () => {
    const b = flac(269);
    fetchers.range.mockImplementation(async (_url: string, options: { headers: { Range: string } }) => {
      const [start, end] = options.headers.Range.slice(6).split('-').map(Number);
      return new Response(new Uint8Array(end - start + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/55000000` } });
    });
    fetchers.first.mockResolvedValue({ res: new Response(b, { status: 206, headers: { 'Content-Type': 'audio/x-ogg', 'Content-Range': 'bytes 0-41/55000000' } }), finalUrl: 'https://audio.example/full.flac' });
    const info = await probeMusicAudio('https://audio.example/input', new AbortController().signal);
    expect(info.codec).toBe('FLAC'); expect(info.bits).toBe(24); expect(info.duration).toBe(269); expect(info.mimeType).toBe('audio/flac');
    expect(validateFullMusic(info, 269, 'flac').lossless).toBe(true);
  });
  it('rejects an HTML response masquerading as a player', async () => {
    fetchers.first.mockResolvedValue({ res: new Response('<html>', { headers: { 'Content-Type': 'text/html' } }), finalUrl: 'https://audio.example/challenge' });
    await expect(probeMusicAudio('https://audio.example/input', new AbortController().signal)).rejects.toThrow('不是音频');
  });
  it('can seek to tail metadata without downloading the middle of a large file', async () => {
    const load = vi.fn(async (start: number, end: number) => new Uint8Array(end - start + 1).fill(37));
    const t = new MusicRangeTokenizer(80_000_000, new Uint8Array(131072), load);
    t.setPosition(79_999_968); const b = new Uint8Array(32); await t.readBuffer(b);
    expect([...b]).toEqual(Array(32).fill(37)); expect(load).toHaveBeenCalledTimes(1); expect(load.mock.calls[0][0]).toBeGreaterThan(79_000_000); expect(t.position).toBe(80_000_000);
    await t.close();
  });
});
