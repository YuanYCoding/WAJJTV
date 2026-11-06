import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverPanVideo, scanVideoTree } from './netdisk-discovery';
import { isVideoFile } from './netdisk-utils';
afterEach(() => vi.unstubAllGlobals());
const signal = () => new AbortController().signal;
describe('recursive video proof', () => {
  it('releases every queued request when a search is already cancelled', async () => {
    const c = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { const sig = init.signal!; if (sig.aborted) throw new DOMException('Aborted', 'AbortError'); return new Promise<Response>((_resolve, reject) => sig.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })); }));
    const tasks = Array.from({ length: 8 }, (_, i) => discoverPanVideo('https://www.alipan.com/s/cancelledscan0' + i, '', c.signal)); c.abort();
    expect((await Promise.all(tasks)).every((v) => v.status === 'unknown')).toBe(true);
    expect((await discoverPanVideo('https://www.alipan.com/s/cancelledafter001', '', c.signal)).status).toBe('unknown');
  });
  it('never exceeds two simultaneous directory probes for one provider', async () => {
    let active = 0, max = 0; vi.stubGlobal('fetch', vi.fn(async (url: string) => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 3)); active--; return new Response(JSON.stringify(url.includes('get_share_token') ? { share_token: 'proof' } : { items: [{ file_id: 'movie', type: 'file', name: 'movie.mp4' }] })); }));
    const result = await Promise.all(Array.from({ length: 8 }, (_, i) => discoverPanVideo('https://www.alipan.com/s/concurrentscan0' + i, '', signal())));
    expect(result.every((v) => v.status === 'video')).toBe(true); expect(max).toBeLessThanOrEqual(2);
  });
  it.each(['A.MKV', 'a.M2TS', 'a.rmvb', 'a.vob', 'a.MOV', 'a.ts', 'a.webm'])('recognizes %s', (name) => expect(isVideoFile(name)).toBe(true));
  it.each(['movie.zip', 'movie.srt', 'movie.mp4.exe', 'movie.iso', 'cover.jpg'])('does not call %s a video', (name) => expect(isVideoFile(name)).toBe(false));
  it('walks nested folders and stops after finding a video', async () => {
    const read = vi.fn(async (parent: string) => ({ files: parent === 'root' ? [{ id: 's1', name: 'season', folder: true }] : [{ id: 'v1', name: '01.m2ts', folder: false }] }));
    expect(await scanVideoTree(read, 'root', signal())).toMatchObject({ status: 'video', sample: '01.m2ts', visited: 2 });
  });
  it('examines pagination before proving an empty directory', async () => {
    const read = vi.fn(async (_parent: string, page: string) => page ? { files: [{ id: 'v', name: 'film.mp4', folder: false }] } : { files: [{ id: 'n', name: 'readme.txt', folder: false }], next: '2' });
    expect((await scanVideoTree(read, 'root', signal())).status).toBe('video'); expect(read).toHaveBeenCalledTimes(2);
  });
  it('does not promote a directory containing only archives or subtitle files', async () => {
    expect(await scanVideoTree(async () => ({ files: [{ id: 'a', name: 'movie.zip', folder: false }, { id: 'b', name: 'movie.srt', folder: false }] }), 'root', signal())).toMatchObject({ status: 'empty' });
  });
  it('reports a scan limit or cancellation as unknown, never as empty or playable', async () => {
    const read = async (id: string) => ({ files: [{ id: id + 'x', name: 'nested', folder: true }] });
    expect((await scanVideoTree(read, 'root', signal(), 2)).status).toBe('unknown');
    const c = new AbortController(); c.abort(); expect((await scanVideoTree(read, 'root', c.signal)).status).toBe('unknown');
  });
  it('uses provider directory evidence, caches the proof and never emits share tokens', async () => {
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('get_share_token') ? { share_token: 'sensitive-proof' } : { items: [{ file_id: 'f', type: 'file', name: 'episode.mkv' }] })));
    vi.stubGlobal('fetch', fetch);
    const first = await discoverPanVideo('https://www.alipan.com/s/discoverytest01', '', signal());
    expect(first.status).toBe('video'); expect(JSON.stringify(first)).not.toContain('sensitive-proof');
    expect(await discoverPanVideo('https://www.alipan.com/s/discoverytest01', '', signal())).toEqual(first); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not reuse evidence for another extraction code', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 'ShareLinkPwdNotMatch' }))); vi.stubGlobal('fetch', fetch);
    expect((await discoverPanVideo('https://www.alipan.com/s/discoverytest01', 'abcd', signal())).status).toBe('unknown'); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
