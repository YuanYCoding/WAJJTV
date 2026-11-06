import { expect, it, vi } from 'vitest';
const data = vi.hoisted(() => vi.fn());
vi.mock('./music-http', () => ({ musicData: data }));
import { musicCandidates } from './music-resolvers';
it('unwraps Sixyin/Kuwo JSON into an audio URL instead of treating JSON as audio', async () => {
  data.mockResolvedValue({ code: 200, data: { url: 'https://cdn.example/full.mp3', bitrate: 320 } });
  const candidates = musicCandidates({ source: 'kw', id: '51685512', title: '晴天', artist: '周杰伦', album: '', duration: 269, cover: '' }, '320k', new AbortController().signal, async () => ({}));
  expect(candidates[0].via).toBe('sixyin'); expect(await candidates[0].url()).toBe('https://cdn.example/full.mp3');
  expect(data.mock.calls[0][0]).toContain('br=320kmp3');
});
