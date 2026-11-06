import { describe, expect, it, vi, beforeEach } from 'vitest';
import { musicTime, musicKey, parseMusicJson, validMusicIdentity } from './music-types';
const upstream = vi.hoisted(() => vi.fn());
vi.mock('./fetch-utils', () => ({ fetchUpstream: upstream }));
import { resolveMusic, musicTicket, searchMusic } from './music-server';

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
describe('music upstream validation', () => {
  beforeEach(() => { upstream.mockReset(); });
  it('never presents a tiny error MP3 as a playable song', async () => {
    upstream.mockImplementation(async (url: string) => url.includes('/url/') ? Response.json({ code: 0, url: 'https://audio.example/error.mp3' }) : new Response('fake audio', { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-9/158253' } }));
    await expect(resolveMusic('kg', 'abc', new AbortController().signal)).rejects.toThrow('没有可用音频');
  });
  it('does not accept an HTML challenge as audio', async () => {
    upstream.mockImplementation(async (url: string) => url.includes('/url/') ? Response.json({ code: 0, url: 'https://audio.example/captcha' }) : new Response('<html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(resolveMusic('tx', 'abc', new AbortController().signal)).rejects.toThrow();
  });
  it('issues bounded opaque stream tickets only after audio validation', async () => {
    upstream.mockImplementation(async (url: string) => url.includes('/url/') ? Response.json({ code: 0, url: 'https://audio.example/song.mp3' }) : new Response('ID3', { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-2/10000000' } }));
    const r = await resolveMusic('tx', 'abc', new AbortController().signal);
    expect(r.url).toMatch(/^\/api\/music\/stream\?ticket=[a-f0-9]{48}$/);
    expect(r.preview).toBe(false); expect(musicTicket(r.url.split('=')[1])?.url).toBe('https://audio.example/song.mp3');
    expect(musicTicket('forged')).toBeNull();
  });
  it('labels Apple as preview even when the file is valid', async () => {
    upstream.mockImplementation(async (url: string) => url.includes('/lookup') ? Response.json({ results: [{ previewUrl: 'https://audio.example/preview.m4a' }] }) : new Response('audio', { status: 206, headers: { 'Content-Type': 'audio/mp4', 'Content-Range': 'bytes 0-4/500000' } }));
    expect((await resolveMusic('apple', '123', new AbortController().signal)).preview).toBe(true);
  });
  it('falls back to the independent Kuwo resolver after an invalid main response', async () => {
    upstream.mockImplementation(async (url: string) => {
      if (url.includes('onrender.com')) return Response.json({ code: 2 });
      if (url.includes('xiaoapi.cn')) return Response.json({ code: 200, data: { url: 'https://audio.example/kuwo.mp3' } });
      return new Response('ID3', { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-2/5000000' } });
    });
    expect((await resolveMusic('kw', '123', new AbortController().signal)).origin).toContain('慕名API');
  });
  it('uses the GD fallback only when it returns validated audio', async () => {
    upstream.mockImplementation(async (url: string) => {
      if (url.includes('onrender.com')) return Response.json({ code: 2 });
      if (url.includes('gdstudio.xyz')) return Response.json({ url: 'https://audio.example/song.flac', br: 1600 });
      return new Response('fLaC', { status: 206, headers: { 'Content-Type': 'audio/flac', 'Content-Range': 'bytes 0-3/64000000' } });
    });
    expect((await resolveMusic('wy', '123', new AbortController().signal)).origin).toContain('GD音乐台');
  });
  it('does not promote a fallback preview into a full song', async () => {
    upstream.mockImplementation(async (url: string) => {
      if (url.includes('onrender.com')) return Response.json({ code: 2 });
      if (url.includes('vkeys.cn')) return Response.json({ code: 200, data: { url: 'https://audio.example/preview.mp3', quality: '音乐试听', ekey: '' } });
      return new Response('ID3', { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-2/960887' } });
    });
    expect((await resolveMusic('tx', 'mid', new AbortController().signal)).preview).toBe(true);
  });
  it('keeps different years and versions as provider entries and caches successful searches', async () => {
    upstream.mockResolvedValue(Response.json({ data: { song: { list: [
      { songmid: 'mid1', songname: '同名歌', singer: [{ name: '甲' }], albumname: '2000', interval: 200 },
      { songmid: 'mid2', songname: '同名歌', singer: [{ name: '乙' }], albumname: '2026', interval: 210 },
    ] } } }));
    const signal = new AbortController().signal, one = await searchMusic('tx', 'cache-test-music', 1, signal), two = await searchMusic('tx', 'cache-test-music', 1, signal);
    expect(one.tracks).toHaveLength(2); expect(one.tracks[0].id).not.toBe(one.tracks[1].id); expect(two.cached).toBe(true); expect(upstream).toHaveBeenCalledTimes(1);
  });
});
