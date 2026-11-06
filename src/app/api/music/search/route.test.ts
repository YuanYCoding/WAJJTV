import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ search: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/api-guard', () => ({ guardRequest: () => null }));
vi.mock('@/lib/music-server', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/music-server')>(), searchMusic: mocks.search, verifyMusicGroup: mocks.verify }));
import { GET } from './route';
describe('verified search wire contract', () => {
  it('streams only verified full tracks and never raw catalog or preview rows', async () => {
    const base = { source: 'tx', artist: '歌手', album: '', duration: 269, cover: '' };
    const good = { ...base, id: 'good', title: '晴天' }, bad = { ...base, id: 'bad', title: '不可用歌曲' }, preview = { ...base, id: 'preview', title: '试听', preview: true };
    mocks.search.mockResolvedValue({ source: 'tx', tracks: [good, bad, preview], ms: 1 });
    mocks.verify.mockImplementation(async group => group[0].id === 'good' ? { ...group[0], playback: { url: '/api/music/stream?ticket=test', expires: Date.now() + 60000, quality: 'auto', duration: 269, codec: 'FLAC' } } : null);
    const res = await GET(new Request('https://example.test/api/music/search?q=晴天&sources=tx'));
    const events = (await res.text()).trim().split('\n').map(s => JSON.parse(s)), tracks = events.flatMap(e => e.tracks);
    expect(res.headers.get('content-type')).toContain('ndjson'); expect(tracks).toHaveLength(1); expect(tracks[0].id).toBe('good'); expect(tracks.every(t => t.playback && !t.preview)).toBe(true); expect(events.at(-1).done).toBe(true);
  });
  it('does not accept a preview-only provider selection', async () => {
    expect((await GET(new Request('https://example.test/api/music/search?q=晴天&sources=apple'))).status).toBe(400);
  });
});
