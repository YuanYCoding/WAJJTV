import type { MusicTrack, MusicQuality } from './music-types';
import { musicData } from './music-http';

export const LX_MUSIC_RESOLVERS = [
  { id: 'hello', name: 'Hello World / HYW', platforms: ['tx', 'wy', 'kw', 'kg'], qualities: ['128k', '320k', 'flac', 'flac24bit'], url: 'http://103.79.184.97/api/music/url?source={source}&songId={id}&quality={quality}', reference: 'https://github.com/wzh15802/lxmusic', file: '洛雪音源最新支持，文件夹外原文件敬请忽略/hello world 260925.js' },
  { id: 'tang', name: 'Hello World / 唐音', platforms: ['tx'], qualities: ['128k', '320k', 'flac', 'flac24bit'], url: 'https://tang.api.s01s.cn/music_open_api.php?mid={id}', reference: 'https://github.com/wzh15802/lxmusic', file: '洛雪音源最新支持，文件夹外原文件敬请忽略/hello world 260925.js' },
  { id: 'sixyin', name: '六音 / 酷我公开接口', platforms: ['kw'], qualities: ['128k', '320k', 'flac'], url: 'https://nmobi.kuwo.cn/mobi.s?type=convert_url_with_sign&rid={id}&br={quality}', reference: 'https://github.com/xzh767/lxmusic-source-all', file: 'sixyin1.2.1.js' },
  { id: 'haitang', name: '非常刀 / 海棠', platforms: ['kw'], qualities: ['128k', '320k', 'flac'], url: 'https://musicapi.haitangw.net/music/kw.php?type=mp3&id={id}&level={quality}', reference: 'https://github.com/guoyue2010/lxmusic-', file: 'V260907/非常刀 v5.js' },
  { id: 'huibq', name: 'Huibq', platforms: ['tx', 'wy', 'kw', 'kg'], qualities: ['128k', '320k'], url: 'https://lxmusicapi.onrender.com/url/{source}/{id}/{quality}', reference: 'https://github.com/Huibq/keep-alive', file: 'render_api.js' },
  { id: 'gd', name: '星海 / GD音乐台', platforms: ['wy'], qualities: ['128k', '320k', 'flac', 'flac24bit'], url: 'https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id={id}&br={quality}', reference: 'https://github.com/guoyue2010/lxmusic-', file: 'V260907/gdstudio音乐源 v1.0.1（仅支持网易）.js' },
  { id: 'muming', name: '慕名 / 酷我', platforms: ['kw'], qualities: ['128k', '320k', 'flac'], url: 'https://xiaoapi.cn/v1/music_kw.php?action=play&rid={id}&br={quality}', reference: 'https://xiaoapi.cn/detail/7', file: '' },
  { id: 'vkeys', name: '落月 / QQ备用', platforms: ['tx'], qualities: ['128k', '320k', 'flac', 'flac24bit'], url: 'https://api.vkeys.cn/v2/music/tencent/geturl?mid={id}&quality={quality}', reference: 'https://github.com/lvluoyue/api-doc', file: 'src/v2/音乐模块/QQ音乐/2-geturl.md' },
] as const;
export type MusicResolverId = typeof LX_MUSIC_RESOLVERS[number]['id'] | 'audius' | 'native';
export interface MusicCandidate { via: string; url: () => Promise<string> }
const field = (d: unknown): string => {
  if (typeof d === 'string') return /^https?:\/\//.test(d) ? d : '';
  if (!d || typeof d !== 'object') return '';
  const r = d as Record<string, unknown>;
  if (r.ekey || /试听|preview/i.test(String(r.quality || ''))) return '';
  for (const k of ['url', 'music_url', 'data']) { const u = field(r[k]); if (u) return u; }
  return '';
};
export function musicCandidates(track: MusicTrack, requested: MusicQuality, signal: AbortSignal, gd: (params: Record<string, string>) => Promise<unknown>): MusicCandidate[] {
  const q = requested === 'auto' ? '320k' : requested, { source: s, id } = track, out: MusicCandidate[] = [];
  const json = (via: string, url: string, headers?: Record<string, string>) => out.push({ via, url: async () => { const d = await musicData(url, signal, headers); if (d.code === 429 || via === 'huibq' && d.code === 5) throw new Error('HTTP 429'); const u = field(d); if (!u) throw new Error('未返回完整歌曲'); return u; } });
  const hello = (quality: string) => json('hello', `http://103.79.184.97/api/music/url?source=${s}&platform=${s}&songId=${id}&quality=${quality}&key=6C1F-53W0-GRKI-EVFG`, { 'X-Card-Key': '6C1F-53W0-GRKI-EVFG' });
  const huibq = () => { if (q === '128k' || q === '320k') json('huibq', `https://lxmusicapi.onrender.com/url/${s}/${id}/${q}`, { 'X-Request-Key': 'share-v3' }); };
  const tang = () => out.push({ via: 'tang', url: async () => { const d = await musicData(`https://tang.api.s01s.cn/music_open_api.php?mid=${id}`, signal, {}, 7500); const k = requested === 'auto' || q === 'flac' ? 'song_play_url_sq' : q === 'flac24bit' ? 'song_play_url_pq' : q === '128k' ? 'song_play_url_standard' : 'song_play_url_hq'; const u = field(d[k]); if (!u) throw new Error('所选音质未提供'); return u; } });
  if (s === 'tx') {
    if (requested === 'auto' || q === 'flac' || q === 'flac24bit') { hello(requested === 'auto' ? 'flac' : q); tang(); huibq(); }
    else { huibq(); tang(); hello(q); }
    json('vkeys', `https://api.vkeys.cn/v2/music/tencent/geturl?mid=${id}&quality=${q === '128k' ? 7 : q === 'flac' ? 10 : q === 'flac24bit' ? 11 : 8}`);
  } else if (s === 'wy') {
    huibq(); hello(requested === 'auto' ? 'flac' : q);
    out.push({ via: 'gd', url: async () => { const u = field(await gd({ types: 'url', source: 'netease', id, br: q === '128k' ? '128' : q === '320k' ? requested === 'auto' ? '999' : '320' : q === 'flac' ? '740' : '999' })); if (!u) throw new Error('未返回音频'); return u; } });
    if (q === '128k' || q === '320k') out.push({ via: 'native', url: async () => { const d = await musicData(`https://music.163.com/api/song/enhance/player/url?ids=%5B${id}%5D&br=${q === '128k' ? 128000 : 320000}`, signal); if (d.data?.[0]?.freeTrialInfo) throw new Error('试听已过滤'); return field(d.data?.[0]); } });
  } else if (s === 'kw') {
    const br = q === '128k' ? '128kmp3' : q === '320k' ? '320kmp3' : '2000kflac';
    json('sixyin', `https://nmobi.kuwo.cn/mobi.s?f=web&source=kwplayer_ar_1.1.9_oppo_118980_320.apk&type=convert_url_with_sign&rid=${id}&br=${br}`);
    out.push({ via: 'haitang', url: async () => `https://musicapi.haitangw.net/music/kw.php?type=mp3&id=${id}&level=${q === '128k' ? 'standard' : q === '320k' ? 'exhigh' : 'lossless'}` });
    huibq(); json('muming', `https://xiaoapi.cn/v1/music_kw.php?action=play&rid=${id}&br=${q === '128k' ? 'h' : q === '320k' ? 'p' : 'ff'}`);
  } else if (s === 'kg') { hello(requested === 'auto' ? 'flac' : q); huibq(); }
  else if (s === 'audius') out.push({ via: 'audius', url: async () => { const d = await musicData(`https://api.audius.co/v1/tracks/${id}?app_name=JjBiTV`, signal); if (d.data?.is_stream_gated || d.data?.is_streamable === false) throw new Error('未公开播放'); return `https://api.audius.co/v1/tracks/${id}/stream?app_name=JjBiTV`; } });
  return out;
}
