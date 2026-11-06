import { randomBytes } from 'node:crypto';
import { fetchUpstream } from './fetch-utils';
import { MUSIC_SOURCES, musicText, parseMusicJson, type MusicSource, type MusicTrack, type MusicOutcome } from './music-types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
// Next may bundle route handlers separately. Share ephemeral tickets across handlers in this process.
const globalMusic = globalThis as typeof globalThis & { jjbitvMusic?: {
  cache: Map<string, { at: number; value: MusicOutcome }>;
  health: Map<MusicSource, { failures: number; retryAt: number; ms?: number; error?: string }>;
  tickets: Map<string, { url: string; expires: number }>;
  gdBudget: number[];
} };
const state = globalMusic.jjbitvMusic ??= { cache: new Map(), health: new Map(), tickets: new Map(), gdBudget: [] as number[] };
const { cache, health, tickets } = state;
const gdBudget = state.gdBudget ??= [];
async function gd(params: Record<string, string>, signal: AbortSignal): Promise<Row> {
  const now = Date.now(); while (gdBudget.length && gdBudget[0] < now - 300_000) gdBudget.shift();
  // The public GD service documents 50 requests / 5 minutes. Leave headroom.
  if (gdBudget.length >= 35) throw new Error('备用来源正在休息');
  gdBudget.push(now);
  return data('https://music-api.gdstudio.xyz/api.php?' + new URLSearchParams(params), signal);
}
// Provider catalogs are untyped external data; normalize to MusicTrack before returning to clients.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
async function data(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<Row> {
  const res = await fetchUpstream(url, { signal, timeoutMs: 6500, headers: { 'User-Agent': UA, Referer: new URL(url).origin + '/', ...headers } });
  if (!res.ok || !res.body) throw new Error(`接口暂不可用（HTTP ${res.status}）`);
  const reader = res.body.getReader(); let total = 0; const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length; if (total > 1_500_000) { await reader.cancel(); throw new Error('接口数据过大'); } parts.push(value);
  }
  return parseMusicJson(Buffer.concat(parts).toString('utf8')) as Row;
}
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
export function musicHealth() { return MUSIC_SOURCES.map(s => ({ ...s, ...(health.get(s.id) || { failures: 0, retryAt: 0 }) })); }
export async function searchMusic(source: MusicSource, query: string, page: number, signal: AbortSignal): Promise<MusicOutcome> {
  const key = `${source}:${page}:${query.toLowerCase()}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 120_000) return { ...hit.value, cached: true };
  const h = health.get(source);
  if (h && h.retryAt > Date.now()) return { source, tracks: [], ms: 0, error: '接口暂时休息，稍后自动重试' };
  const start = Date.now();
  try {
    const tracks = (await catalog(source, query, page, signal)).filter(t => /^[a-zA-Z0-9_-]{1,80}$/.test(t.id) && t.title).slice(0, 20);
    const value = { source, tracks, ms: Date.now() - start };
    health.set(source, { failures: 0, retryAt: 0, ms: value.ms });
    if (cache.size >= 160) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), value }); return value;
  } catch {
    const failures = (h?.failures || 0) + 1;
    if (!signal.aborted) health.set(source, { failures, retryAt: failures >= 3 ? Date.now() + 60_000 : 0, error: '目录接口暂不可用' });
    return { source, tracks: [], ms: Date.now() - start, error: '目录接口暂不可用，可换其他来源' };
  }
}

async function checkAudio(url: string, signal: AbortSignal): Promise<void> {
  const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('音频地址无效');
  const r = await fetchUpstream(url, { signal, timeoutMs: 7000, headers: { Range: 'bytes=0-4095', 'User-Agent': UA } });
  try {
    if (!r.ok || !r.body) throw new Error('音频线路未响应');
    const type = r.headers.get('content-type') || '';
    if (!/audio|octet-stream|video\/mp4/i.test(type)) throw new Error('音源未返回音频');
    const total = Number(r.headers.get('content-range')?.split('/')[1] || r.headers.get('content-length') || 0);
    // Some resolvers return a tiny spoken error MP3 with HTTP 200. Do not present it as a song.
    if (total > 0 && total < 256_000) throw new Error('来源返回了无效的短音频');
  } finally { await r.body?.cancel(); }
}
export async function resolveMusic(source: MusicSource, id: string, signal: AbortSignal) {
  let url = '', preview = source === 'apple', checked = false; let origin = '';
  if (source === 'apple') {
    const d = await data(`https://itunes.apple.com/lookup?id=${id}&country=us`, signal);
    url = d.results?.[0]?.previewUrl || ''; origin = 'Apple 官方试听';
  } else if (source === 'audius') {
    const d = await data(`https://api.audius.co/v1/tracks/${id}?app_name=JjBiTV`, signal);
    if (d.data?.is_stream_gated || d.data?.is_streamable === false) throw new Error('该歌曲未公开播放');
    url = `https://api.audius.co/v1/tracks/${id}/stream?app_name=JjBiTV`; origin = 'Audius 公开音频';
  } else {
    // Adapt the documented Huibq HTTP protocol, not downloaded/evaluated LX JavaScript.
    try {
      const d = await data(`https://lxmusicapi.onrender.com/url/${source}/${id}/320k`, signal, { 'X-Request-Key': 'share-v3' });
      if (d.code !== 0 || typeof d.url !== 'string') throw new Error('未返回歌曲');
      await checkAudio(d.url, signal); checked = true; url = d.url; origin = 'Huibq 公开音源';
    } catch {
      if (source === 'tx') {
        try {
          const d = await data(`https://api.vkeys.cn/v2/music/tencent/geturl?mid=${id}&quality=8`, signal);
          if (d.code === 200 && d.data?.url && !d.data.ekey) {
            await checkAudio(d.data.url, signal); checked = true; url = d.data.url;
            preview = /试听|preview/i.test(String(d.data.quality)); origin = '落月API · QQ音乐' + (preview ? '试听' : '公开音频');
          }
        } catch { /* never decrypt protected files */ }
      }
      if (source === 'kw') {
        try { const d = await data(`https://xiaoapi.cn/v1/music_kw.php?action=play&rid=${id}&br=p`, signal); if (d.code === 200 && d.data?.url) { await checkAudio(d.data.url, signal); checked = true; url = d.data.url; origin = '慕名API · 酷我公开音频'; } } catch { /* no playable fallback */ }
      }
      if (source === 'wy') {
        try { const d = await gd({ types: 'url', source: 'netease', id, br: '999' }, signal); if (d.url) { await checkAudio(d.url, signal); checked = true; url = d.url; origin = 'GD音乐台 · 公开音频'; } } catch { /* official fallback below */ }
        if (!url) {
          const d = await data(`https://music.163.com/api/song/enhance/player/url?ids=%5B${id}%5D&br=320000`, signal);
          url = d.data?.[0]?.url || ''; preview = Boolean(d.data?.[0]?.freeTrialInfo); origin = '网易云公开音频';
        }
      }
    }
  }
  if (!url) throw new Error('这首歌当前没有可用音频，请试试同名歌曲的其他来源');
  if (!checked) await checkAudio(url, signal);
  for (const [key, value] of tickets) if (value.expires < Date.now()) tickets.delete(key);
  if (tickets.size >= 300) tickets.delete(tickets.keys().next().value!);
  const token = randomBytes(24).toString('hex'); tickets.set(token, { url, expires: Date.now() + 2 * 60 * 60_000 });
  return { url: `/api/music/stream?ticket=${token}`, preview, origin };
}
export function musicTicket(token: string) { const t = tickets.get(token); return t && t.expires > Date.now() ? t : null; }
