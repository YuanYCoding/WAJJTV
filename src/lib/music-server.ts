import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { musicData as data, type MusicRow as Row } from './music-http';
import { MUSIC_SOURCES, musicText, musicKey, type MusicSource, type MusicTrack, type MusicOutcome, type MusicPlayback, type MusicQuality } from './music-types';
import { probeMusicAudio, validateFullMusic } from './music-audio-probe';
import { LX_MUSIC_RESOLVERS, musicCandidates } from './music-resolvers';
type PlaybackResult = MusicPlayback & { preview: false; origin: string };
interface ResolverHealth { ok?: boolean; failures: number; retryAt: number; ms?: number; codec?: string; kbps?: number; error?: string }
interface MusicState {
  cache: Map<string, { at: number; value: MusicOutcome }>;
  health: Map<MusicSource, { failures: number; retryAt: number; ms?: number; error?: string }>;
  tracks: Map<string, MusicTrack>;
  playback: Map<string, PlaybackResult>;
  negative: Map<string, number>;
  tickets: Map<string, { url: string; expires: number; mimeType?: string }>;
  resolverHealth: Map<string, ResolverHealth>;
  slots: Map<string, number>;
  gdBudget: number[];
  priorityWaiters: number;
}
const globalMusic = globalThis as typeof globalThis & { jjbitvMusic13?: MusicState };
const state: MusicState = globalMusic.jjbitvMusic13 ??= { cache: new Map(), health: new Map(), tracks: new Map(), playback: new Map(), negative: new Map(), tickets: new Map(), resolverHealth: new Map(), slots: new Map(), gdBudget: [], priorityWaiters: 0 };
state.priorityWaiters ??= 0;
const { cache, health, tickets } = state;
async function gd(params: Record<string, string>, signal: AbortSignal): Promise<Row> {
  const now = Date.now(); while (state.gdBudget.length && state.gdBudget[0] < now - 300_000) state.gdBudget.shift();
  if (state.gdBudget.length >= 35) throw new Error('备用来源正在休息');
  state.gdBudget.push(now); return data('https://music-api.gdstudio.xyz/api.php?' + new URLSearchParams(params), signal);
}
function remember(track: MusicTrack) { if (state.tracks.size >= 1600) state.tracks.delete(state.tracks.keys().next().value!); state.tracks.set(musicKey(track), track); }
const image = (u: unknown) => typeof u === 'string' && /^https?:\/\//.test(u) ? u.replace(/^http:/, 'https:') : '';
async function catalog(source: MusicSource, query: string, page: number, signal: AbortSignal): Promise<MusicTrack[]> {
  const q = encodeURIComponent(query); let rows: Row[]; const base = { source, preview: source === 'apple' };
  switch (source) {
    case 'wy': {
      const results = await Promise.allSettled([
        gd({ types: 'search', source: 'netease', name: query, count: '20', pages: String(page) }, signal),
        data(`https://music.163.com/api/search/get?s=${q}&type=1&limit=20&offset=${(page - 1) * 20}`, signal),
      ]);
      const items: MusicTrack[] = [];
      if (results[0].status === 'fulfilled' && Array.isArray(results[0].value)) {
        for (const s of results[0].value as Row[]) items.push({ ...base, id: String(s.id), title: musicText(s.name), artist: (s.artist || []).map(musicText).join(' / '), album: musicText(s.album), duration: 0, cover: '' });
      }
      if (results[1].status === 'fulfilled') {
        rows = results[1].value.result?.songs || [];
        for (const s of rows) items.push({ ...base, id: String(s.id), title: musicText(s.name), artist: (s.artists || []).map((a: Row) => musicText(a.name)).join(' / '), album: musicText(s.album?.name), duration: Number(s.duration) / 1000 || 0, cover: image(s.album?.picUrl) });
      }
      if (results.every(r => r.status === 'rejected')) throw new Error('目录暂不可用');
      const unknown = items.filter(t => !t.duration && /^\d+$/.test(t.id)).slice(0, 20);
      if (unknown.length) try {
        const details = await data('https://music.163.com/api/song/detail?ids=' + encodeURIComponent(JSON.stringify(unknown.map(t => t.id))), signal);
        for (const t of unknown) { const d = details.songs?.find((s: Row) => String(s.id) === t.id); if (d) { t.duration = Number(d.duration || d.dt) / 1000; t.cover = image(d.album?.picUrl || d.al?.picUrl); } }
      } catch { /* entries without reference duration will be excluded by verification */ }
      const ids = new Set<string>(); return items.filter(t => { if (ids.has(t.id)) return false; ids.add(t.id); return true; });
    }
    case 'tx': {
      const d = await data(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${q}&format=json&n=20&p=${page}`, signal);
      rows = d.data?.song?.list || [];
      return rows.map(s => ({ ...base, id: String(s.songmid), title: musicText(s.songname), artist: (s.singer || []).map((a: Row) => musicText(a.name)).join(' / '), album: musicText(s.albumname), duration: Number(s.interval) || 0, cover: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${encodeURIComponent(s.albummid)}.jpg` : '' }));
    }
    case 'kw': {
      if (page === 1) try {
        const d = await data(`https://xiaoapi.cn/v1/music_kw.php?action=search&msg=${q}`, signal);
        if (!Array.isArray(d.data?.list) || d.code !== 200) throw new Error('备用目录');
        // This API has no documented paging parameter; use the native catalog on subsequent pages.
        if (page === 1) return d.data.list.slice(0, 20).map((s: Row) => ({ ...base, id: String(s.rid), title: musicText(s.song_name || s.name), artist: musicText(s.artist), album: musicText(s.album), duration: Number(s.duration) || 0, cover: image(s.pic) }));
      } catch { /* native catalog fallback */ }
      const d = await data(`https://search.kuwo.cn/r.s?all=${q}&ft=music&client=kt&pn=${page - 1}&rn=20&rformat=json&encoding=utf8`, signal);
      rows = d.abslist || [];
      return rows.map(s => ({ ...base, id: String(s.MUSICRID).replace(/^MUSIC_/, ''), title: musicText(s.SONGNAME || s.NAME), artist: musicText(s.ARTIST), album: musicText(s.ALBUM), duration: Number(s.DURATION) || 0, cover: '' }));
    }
    case 'kg': {
      const d = await data(`https://songsearch.kugou.com/song_search_v2?keyword=${q}&page=${page}&pagesize=20&platform=WebFilter`, signal);
      rows = d.data?.lists || [];
      return rows.map(s => ({ ...base, id: String(s.FileHash), title: musicText(s.SongName), artist: musicText(s.SingerName), album: musicText(s.AlbumName), duration: Number(s.Duration) || 0, cover: '' }));
    }
    case 'audius': {
      const d = await data(`https://api.audius.co/v1/tracks/search?query=${q}&limit=20&offset=${(page - 1) * 20}&app_name=JjBiTV`, signal);
      rows = d.data || [];
      return rows.filter(s => s.is_streamable !== false && !s.is_stream_gated).map(s => ({ ...base, id: String(s.id), title: musicText(s.title), artist: musicText(s.user?.name), album: musicText(s.genre), duration: Number(s.duration) || 0, cover: image(s.artwork?.['150x150']) }));
    }
    case 'apple': {
      const d = await data(`https://itunes.apple.com/search?term=${q}&entity=song&country=us&limit=20&offset=${(page - 1) * 20}`, signal);
      rows = d.results || [];
      return rows.filter(s => s.previewUrl).map(s => ({ ...base, id: String(s.trackId), title: musicText(s.trackName), artist: musicText(s.artistName), album: musicText(s.collectionName), duration: Number(s.trackTimeMillis) / 1000 || 0, cover: image(s.artworkUrl100) }));
    }
  }
}

export function musicHealth() { return MUSIC_SOURCES.filter(s => s.id !== 'apple').map(s => ({ ...s, ...(health.get(s.id) || { failures: 0, retryAt: 0 }) })); }
export function musicResolverHealth() { return LX_MUSIC_RESOLVERS.map(r => ({ ...r, health: state.resolverHealth.get(r.id) || { failures: 0, retryAt: 0 } })); }
export async function searchMusic(source: MusicSource, query: string, page: number, signal: AbortSignal): Promise<MusicOutcome> {
  if (source === 'apple') return { source, tracks: [], ms: 0 };
  const key = `${source}:${page}:${query.toLowerCase()}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 300_000) return { ...hit.value, cached: true };
  const h = health.get(source);
  if (h && h.retryAt > Date.now()) return { source, tracks: [], ms: 0, error: '接口暂时休息' };
  const start = Date.now();
  try {
    const tracks = (await catalog(source, query, page, signal)).filter(t => /^[a-zA-Z0-9_-]{1,80}$/.test(t.id) && t.title).slice(0, 20);
    tracks.forEach(remember); const value = { source, tracks, ms: Date.now() - start };
    health.set(source, { failures: 0, retryAt: 0, ms: value.ms });
    if (cache.size >= 160) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), value }); return value;
  } catch {
    const failures = (h?.failures || 0) + 1;
    if (!signal.aborted) health.set(source, { failures, retryAt: failures >= 3 ? Date.now() + 60_000 : 0, error: '目录接口暂不可用' });
    return { source, tracks: [], ms: Date.now() - start, error: '目录接口暂不可用' };
  }
}
export function musicTicket(token: string) { const t = tickets.get(token); return t && t.expires > Date.now() ? t : null; }
export function knownMusicTrack(source: MusicSource, id: string) { return state.tracks.get(`${source}:${id}`); }
async function lookupTrack(source: MusicSource, id: string, signal: AbortSignal): Promise<MusicTrack> {
  const base: MusicTrack = { source, id, title: '', artist: '', album: '', cover: '', duration: 0 };
  if (source === 'wy') { const d = await data('https://music.163.com/api/song/detail?ids=' + encodeURIComponent(JSON.stringify([id])), signal); const s = d.songs?.[0]; if (s) Object.assign(base, { title: musicText(s.name), duration: Number(s.duration || s.dt) / 1000 }); }
  else if (source === 'tx') { const d = await data(`https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${id}&format=json`, signal); const s = d.data?.[0]; if (s) Object.assign(base, { title: musicText(s.name || s.title), duration: Number(s.interval) }); }
  else if (source === 'kw') { const d = await data(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${id}`, signal); const s = d.data?.songinfo; if (s) Object.assign(base, { title: musicText(s.songName), duration: Number(s.duration) }); }
  else if (source === 'kg') { const d = await data(`https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${id}`, signal); Object.assign(base, { title: musicText(d.songName), duration: Number(d.timeLength) }); }
  else if (source === 'audius') { const d = await data(`https://api.audius.co/v1/tracks/${id}?app_name=JjBiTV`, signal); if (d.data) Object.assign(base, { title: musicText(d.data.title), duration: Number(d.data.duration) }); }
  if (!(base.duration > 0)) throw new Error('无法确认原曲时长'); remember(base); return base;
}
export async function resolveMusic(source: MusicSource, id: string, signal: AbortSignal, options: { quality?: MusicQuality; track?: MusicTrack; fresh?: boolean; background?: boolean } = {}): Promise<PlaybackResult> {
  if (source === 'apple') throw new Error('试听不进入播放列表');
  const quality = options.quality || 'auto', key = `${source}:${id}:${quality}`;
  if (options.fresh) { state.playback.delete(key); state.negative.delete(key); }
  const track = options.track?.source === source && options.track.id === id ? options.track : knownMusicTrack(source, id) || await lookupTrack(source, id, signal);
  const hit = state.playback.get(key);
  if (!options.fresh && hit && hit.expires > Date.now() + 15_000 && musicTicket(hit.url.split('=')[1])) return hit;
  // Reuse an already checked file for another label only if its REAL codec/bitrate meets that choice.
  if (!options.fresh) for (const [cachedKey, value] of state.playback) {
    if (!cachedKey.startsWith(`${source}:${id}:`) || value.expires <= Date.now() + 15000 || !musicTicket(value.url.split('=')[1])) continue;
    try {
      validateFullMusic({ ...value, size: 1, lossless: /FLAC|PCM/.test(value.codec) }, track.duration, quality);
      const reused = { ...value, quality }; state.playback.set(key, reused); return reused;
    } catch { /* a different quality really needs a different file */ }
  }
  if (!options.fresh && (state.negative.get(key) || 0) > Date.now()) throw new Error('本次未找到完整音频');
  for (const candidate of musicCandidates(track, quality, signal, params => gd(params, signal))) {
    signal.throwIfAborted(); const h = state.resolverHealth.get(candidate.via);
    if (h && h.retryAt > Date.now()) continue;
    if (!options.background) state.priorityWaiters++;
    try { while ((state.slots.get(candidate.via) || 0) >= 2 || options.background && state.priorityWaiters > 0) await delay(50, undefined, { signal }); }
    finally { if (!options.background) state.priorityWaiters--; }
    state.slots.set(candidate.via, (state.slots.get(candidate.via) || 0) + 1); const started = Date.now();
    try {
      const url = await candidate.url(); if (!url) throw new Error('未返回音频');
      const info = validateFullMusic(await probeMusicAudio(url, signal), track.duration, quality);
      const token = randomBytes(24).toString('hex'), now = Date.now();
      for (const [k, v] of tickets) if (v.expires < now) tickets.delete(k);
      if (tickets.size >= 1200) tickets.delete(tickets.keys().next().value!);
      tickets.set(token, { url: info.finalUrl || url, expires: now + 2 * 60 * 60_000, mimeType: info.mimeType });
      const via = LX_MUSIC_RESOLVERS.find(r => r.id === candidate.via)?.name || candidate.via;
      const result: PlaybackResult = { url: `/api/music/stream?ticket=${token}`, expires: now + 180_000, quality, duration: info.duration, codec: info.codec, kbps: info.kbps, sampleRate: info.sampleRate, bits: info.bits, via, preview: false, origin: via };
      if (state.playback.size >= 1000) state.playback.delete(state.playback.keys().next().value!);
      state.playback.set(key, result); state.negative.delete(key);
      state.resolverHealth.set(candidate.via, { ok: true, failures: 0, retryAt: 0, ms: Date.now() - started, codec: info.codec, kbps: info.kbps });
      return result;
    } catch (e) {
      if (signal.aborted) throw e;
      const msg = e instanceof Error ? e.message : '取链失败', failures = (h?.failures || 0) + 1;
      state.resolverHealth.set(candidate.via, { ok: false, failures, retryAt: /HTTP 429/.test(msg) ? Date.now() + 300_000 : failures >= 3 && /HTTP 403|HTTP 5|fetch failed|timeout/i.test(msg) ? Date.now() + 60_000 : 0, error: msg.slice(0, 120) });
    } finally { state.slots.set(candidate.via, Math.max(0, (state.slots.get(candidate.via) || 1) - 1)); }
  }
  if (state.negative.size >= 1000) state.negative.delete(state.negative.keys().next().value!);
  state.negative.set(key, Date.now() + 20_000); throw new Error('没有通过完整音频验证的所选音质');
}
export function canonicalMusicKey(track: MusicTrack) {
  const normalize = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
  return normalize(track.title) + '\u0000' + normalize(track.artist);
}
export function groupMusicCandidates(tracks: MusicTrack[]) {
  const groups: MusicTrack[][] = [], seen = new Set<string>();
  for (const t of tracks) {
    if (seen.has(musicKey(t)) || t.preview || !(t.duration > 0)) continue; seen.add(musicKey(t));
    const found = groups.find(g => canonicalMusicKey(g[0]) === canonicalMusicKey(t) && Math.abs(g[0].duration - t.duration) <= 4);
    if (found) found.push(t); else groups.push([t]);
  }
  return groups;
}
export async function verifyMusicGroup(group: MusicTrack[], signal: AbortSignal): Promise<MusicTrack | null> {
  for (const t of group) {
    if (signal.aborted) return null;
    try { const playback = await resolveMusic(t.source, t.id, signal, { track: t, background: true }); return { ...t, duration: playback.duration, playback, preview: false }; }
    catch { if (signal.aborted) return null; }
  }
  return null;
}
