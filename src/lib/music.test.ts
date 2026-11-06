import { describe, expect, it, vi, beforeEach } from 'vitest';
import { musicTime, musicKey, parseMusicJson, validMusicIdentity, type MusicTrack } from './music-types';
import { validateFullMusic } from './music-audio-probe';
const mocks = vi.hoisted(() => ({ data: vi.fn(), probe: vi.fn() }));
vi.mock('./music-http', () => ({ musicData: mocks.data }));
vi.mock('./music-audio-probe', async importOriginal => ({ ...await importOriginal<typeof import('./music-audio-probe')>(), probeMusicAudio: mocks.probe }));
import { resolveMusic, musicTicket, groupMusicCandidates } from './music-server';
const track = (id: string, source: MusicTrack['source'] = 'tx'): MusicTrack => ({ source, id, title: '测试歌曲', artist: '同一歌手', album: '专辑', duration: 269, cover: '' });
const audio = { duration: 269, codec: 'FLAC', kbps: 1600, sampleRate: 44100, bits: 24, lossless: true, size: 55000000, mimeType: 'audio/flac' };
describe('music contracts', () => {
  it('normalizes standard and legacy catalog JSON without executing code', () => {
    expect(parseMusicJson('{"list":[1]}')).toEqual({ list: [1] });
    expect(parseMusicJson("{'title':'Rock \\'n\\' Roll','name':'say \"hello\"','path':'a\\\\b'}")).toEqual({ title: "Rock 'n' Roll", name: 'say "hello"', path: 'a\\b' });
    expect(() => parseMusicJson("process.exit(1)")).toThrow();
  });
  it('separates provider IDs and rejects URL-shaped identifiers', () => {
    expect(musicKey({ source: 'wy', id: '123' })).not.toBe(musicKey({ source: 'tx', id: '123' }));
    expect(validMusicIdentity('wy', '123')).toBe(true);
    expect(validMusicIdentity('wy', '../api')).toBe(false);
    expect(validMusicIdentity('other', '123')).toBe(false);
    expect(validMusicIdentity('tx', 'https://localhost')).toBe(false);
  });
  it('handles invalid or missing media duration', () => {
    expect(musicTime(269)).toBe('4:29'); expect(musicTime(Infinity)).toBe('--:--'); expect(musicTime(-1)).toBe('--:--');
  });
});
describe('verified music and quality', () => {
  beforeEach(() => { mocks.data.mockReset(); mocks.probe.mockReset(); });
  it('rejects short previews even if the upstream reports success', async () => {
    mocks.data.mockResolvedValue({ code: 200, url: 'https://audio.example/short.mp3', data: { url: 'https://audio.example/short.mp3' } });
    mocks.probe.mockResolvedValue({ ...audio, duration: 30 });
    await expect(resolveMusic('tx', 'short13', new AbortController().signal, { track: track('short13') })).rejects.toThrow('没有通过');
  });
  it('rejects an error recording and unknown reference duration', () => {
    expect(() => validateFullMusic({ ...audio, duration: 4 }, 269, 'auto')).toThrow();
    expect(() => validateFullMusic(audio, 0, 'auto')).toThrow();
  });
  it('verifies lossless using the codec and bit depth, not requested labels', () => {
    expect(validateFullMusic(audio, 269, 'flac24bit').bits).toBe(24);
    expect(() => validateFullMusic({ ...audio, codec: 'AAC', lossless: false, kbps: 48, bits: 0 }, 269, 'flac')).toThrow('无损');
    expect(() => validateFullMusic({ ...audio, bits: 16 }, 269, 'flac24bit')).toThrow('24bit');
    expect(() => validateFullMusic({ ...audio, codec: 'APE' }, 269, 'auto')).toThrow('不支持');
  });
  it('returns opaque reusable tickets and separates quality cache entries', async () => {
    mocks.data.mockResolvedValue({ code: 200, url: 'https://audio.example/full.flac' }); mocks.probe.mockResolvedValue(audio);
    const t = track('full13'), signal = new AbortController().signal;
    const r = await resolveMusic('tx', t.id, signal, { track: t, quality: 'flac' });
    expect(r.url).toMatch(/^\/api\/music\/stream\?ticket=[a-f0-9]{48}$/); expect(r.codec).toBe('FLAC'); expect(r.preview).toBe(false);
    expect(musicTicket(r.url.split('=')[1])?.mimeType).toBe('audio/flac');
    expect((await resolveMusic('tx', t.id, signal, { track: t, quality: 'flac' })).url).toBe(r.url);
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    await resolveMusic('tx', t.id, signal, { track: t, quality: 'flac24bit' }); expect(mocks.probe).toHaveBeenCalledTimes(1);
    expect(musicTicket('forged')).toBeNull();
  });
  it('does not admit legacy Apple previews', async () => {
    await expect(resolveMusic('apple', '123', new AbortController().signal)).rejects.toThrow('试听'); expect(mocks.data).not.toHaveBeenCalled();
  });
  it('merges exact recordings while preserving covers, live versions and different durations', () => {
    const a = track('a'), b = { ...track('b', 'wy'), duration: 271 }, live = { ...track('c'), title: '测试歌曲 (Live)' }, cover = { ...track('d'), artist: '另一歌手' }, different = { ...track('e'), duration: 330 };
    const groups = groupMusicCandidates([a, b, a, live, cover, different, { ...track('preview'), preview: true }, { ...track('unknown'), duration: 0 }]);
    expect(groups).toHaveLength(4); expect(groups[0]).toHaveLength(2);
  });
});
