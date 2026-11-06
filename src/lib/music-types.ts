export const MUSIC_SOURCES = [
  { id: 'tx', name: 'QQ音乐', description: '歌曲搜索 · 公开音频' },
  { id: 'wy', name: '网易云', description: '歌曲搜索 · 公开音频' },
  { id: 'kw', name: '酷我', description: '歌曲搜索 · 公开音频' },
  { id: 'kg', name: '酷狗', description: '歌曲搜索 · 按单曲检测可用性' },
  { id: 'audius', name: 'Audius', description: '独立音乐 · 艺术家公开上传' },
  { id: 'apple', name: 'Apple试听', description: '仅试听片段，非完整歌曲' },
] as const;
export type MusicSource = typeof MUSIC_SOURCES[number]['id'];
export const MUSIC_QUALITIES = [{ id: 'auto', name: '自动' }, { id: '128k', name: '标准' }, { id: '320k', name: '高品质' }, { id: 'flac', name: '无损' }, { id: 'flac24bit', name: '24bit' }] as const;
export type MusicQuality = typeof MUSIC_QUALITIES[number]['id'];
export interface MusicPlayback { url: string; expires: number; quality: MusicQuality; duration: number; codec: string; kbps: number; sampleRate: number; bits: number; via: string }
export interface MusicTrack {
  source: MusicSource; id: string; title: string; artist: string; album: string;
  duration: number; cover: string; preview?: boolean;
  playback?: MusicPlayback;
  searchRank?: number;
}
export interface MusicSearchEvent { tracks: MusicTrack[]; checked?: number; total?: number; done?: boolean; nextPage?: number | null; error?: string }
export interface MusicOutcome { source: MusicSource; tracks: MusicTrack[]; ms: number; error?: string; cached?: boolean }
export const musicKey = (t: Pick<MusicTrack, 'source' | 'id'>) => `${t.source}:${t.id}`;
export const musicSourceName = (id: string) => MUSIC_SOURCES.find(s => s.id === id)?.name || id;
export function musicCodecName(codec = '') { return /AAC/i.test(codec) ? 'AAC' : /MPEG.*Layer.*3|MP3/i.test(codec) ? 'MP3' : codec; }
export function musicTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
export function validMusicIdentity(source: unknown, id: unknown): source is MusicSource {
  return MUSIC_SOURCES.some(s => s.id === source) && typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
}

// Kuwo's legacy catalog uses single-quoted JSON strings. Parse data only; never eval source scripts.
export function parseMusicJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* legacy data below */ }
  let out = '', quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "'") { quoted = !quoted; out += '"'; }
    else if (quoted && c === '"') out += '\\"';
    else if (quoted && c === '\\' && raw[i + 1] === "'") { out += "'"; i++; }
    else if (quoted && c === '\\') { out += c + (raw[++i] || ''); }
    else out += c;
  }
  return JSON.parse(out);
}
export const musicText = (value: unknown) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim().slice(0, 240);
