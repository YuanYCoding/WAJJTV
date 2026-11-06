'use client';
/* eslint-disable @next/next/no-img-element -- bounded remote album covers with error fallback; no image optimizer fetch. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Icon } from './icon';
import { MUSIC_SOURCES, musicKey, musicSourceName, musicTime, validMusicIdentity, type MusicSource, type MusicTrack } from '@/lib/music-types';

interface MusicContextValue {
  track: MusicTrack | null; queue: MusicTrack[]; favorites: MusicTrack[]; playing: boolean; loading: boolean; error: string; notice: string;
  enabled: MusicSource[]; mode: 'sequence' | 'repeat' | 'shuffle';
  audio: RefObject<HTMLAudioElement | null>;
  play: (track: MusicTrack, queue?: MusicTrack[]) => Promise<void>; toggle: () => void; next: (direction?: number) => void;
  enqueue: (track: MusicTrack) => void; favorite: (track: MusicTrack) => void; setEnabled: (ids: MusicSource[]) => void;
  setMode: (mode: 'sequence' | 'repeat' | 'shuffle') => void; clearQueue: () => void;
}
const MusicContext = createContext<MusicContextValue | null>(null);
const STORAGE = 'jjbitv-music-v1';
const validTracks = (items: unknown): MusicTrack[] => Array.isArray(items) ? items.filter(t => t && validMusicIdentity(t.source, t.id) && typeof t.title === 'string' && typeof t.artist === 'string' && typeof t.album === 'string' && typeof t.cover === 'string' && Number.isFinite(t.duration)).slice(0, 200) : [];
export function useMusic() { const value = useContext(MusicContext); if (!value) throw new Error('MusicProvider missing'); return value; }
export function MusicProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null), request = useRef<AbortController | null>(null), sequence = useRef(0);
  const [track, setTrack] = useState<MusicTrack | null>(null), [queue, setQueue] = useState<MusicTrack[]>([]), [favorites, setFavorites] = useState<MusicTrack[]>([]);
  const [playing, setPlaying] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [enabled, setEnabled] = useState<MusicSource[]>(MUSIC_SOURCES.map(s => s.id));
  const [mode, setMode] = useState<'sequence' | 'repeat' | 'shuffle'>('sequence'), [ready, setReady] = useState(false);
  useEffect(() => {
    try { const d = JSON.parse(localStorage.getItem(STORAGE) || '{}'); setFavorites(validTracks(d.favorites)); setQueue(validTracks(d.queue)); if (Array.isArray(d.enabled)) setEnabled(MUSIC_SOURCES.filter(s => d.enabled.includes(s.id)).map(s => s.id)); } catch { /* corrupted local data does not stop listening */ }
    setReady(true);
    return () => request.current?.abort();
  }, []);
  useEffect(() => { if (ready) try { localStorage.setItem(STORAGE, JSON.stringify({ favorites, queue, enabled })); } catch { /* storage unavailable */ } }, [favorites, queue, enabled, ready]);
  useEffect(() => {
    const pauseForVideo = (e: Event) => { if (e.target instanceof HTMLVideoElement) audio.current?.pause(); };
    document.addEventListener('play', pauseForVideo, true); return () => document.removeEventListener('play', pauseForVideo, true);
  }, []);
  const play = useCallback(async (item: MusicTrack, list?: MusicTrack[]) => {
    request.current?.abort(); const seq = ++sequence.current, controller = new AbortController(); request.current = controller;
    audio.current?.pause(); if (audio.current) { audio.current.removeAttribute('src'); audio.current.load(); }
    setTrack(item); setLoading(true); setError(''); setNotice('正在获取音频…');
    if (list?.length) setQueue(list.slice(0, 200)); else setQueue(q => q.some(t => musicKey(t) === musicKey(item)) ? q : [...q.slice(-199), item]);
    try {
      const res = await fetch('/api/music/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: item.source, id: item.id }), signal: controller.signal });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || '音频获取失败');
      if (seq !== sequence.current || !audio.current) return;
      setTrack({ ...item, preview: data.preview }); setNotice(data.preview ? '试听片段 · 非完整歌曲' : '');
      audio.current.src = data.url; audio.current.load();
      try { await audio.current.play(); } catch { if (seq === sequence.current) setNotice('音频已就绪，点击播放继续'); }
    } catch (e) { if (!controller.signal.aborted && seq === sequence.current) { setError(e instanceof Error ? e.message : '播放失败'); setNotice(''); } }
    finally { if (seq === sequence.current) setLoading(false); }
  }, []);
  const next = useCallback((direction = 1) => {
    if (!queue.length) return;
    const index = track ? queue.findIndex(t => musicKey(t) === musicKey(track)) : -1;
    const target = mode === 'shuffle' && queue.length > 1 ? (Math.max(0, index) + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length : (index + direction + queue.length) % queue.length;
    void play(queue[target]);
  }, [queue, track, mode, play]);
  const toggle = useCallback(() => {
    if (!track) return;
    if (error || !audio.current?.getAttribute('src')) { void play(track); return; }
    if (audio.current.paused) void audio.current.play().catch(() => setError('浏览器未开始播放，请再次点击播放')); else audio.current.pause();
  }, [track, error, play]);
  const favorite = useCallback((item: MusicTrack) => setFavorites(items => items.some(t => musicKey(t) === musicKey(item)) ? items.filter(t => musicKey(t) !== musicKey(item)) : [item, ...items].slice(0, 200)), []);
  const enqueue = useCallback((item: MusicTrack) => setQueue(items => items.some(t => musicKey(t) === musicKey(item)) ? items : [...items, item].slice(-200)), []);
  useEffect(() => {
    if (!track || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album });
    navigator.mediaSession.setActionHandler('play', toggle); navigator.mediaSession.setActionHandler('pause', () => audio.current?.pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => next()); navigator.mediaSession.setActionHandler('previoustrack', () => next(-1));
    navigator.mediaSession.setActionHandler('seekto', e => { if (audio.current && typeof e.seekTime === 'number') audio.current.currentTime = e.seekTime; });
    return () => { for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto'] as const) navigator.mediaSession.setActionHandler(action, null); };
  }, [track, toggle, next]);
  return <MusicContext.Provider value={{ track, queue, favorites, playing, loading, error, notice, audio, play, toggle, next, favorite, enqueue, enabled, setEnabled, mode, setMode, clearQueue: () => setQueue([]) }}>
    <audio ref={audio} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { if (audio.current?.getAttribute('src') && !request.current?.signal.aborted) { setError('这条音频线路播放失败，可重试或更换来源'); setLoading(false); } }} onEnded={() => { if (mode === 'repeat' && audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => {}); } else if (queue.length > 1) next(); }} />
    {children}<MusicDock />
  </MusicContext.Provider>;
}
export function MusicArt({ track, className = '' }: { track?: MusicTrack | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [track?.cover]);
  return <span className={`music-art ${className}`} aria-hidden="true">{track?.cover && !failed ? <img src={track.cover} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} /> : <span>♫</span>}</span>;
}
function MusicProgress() {
  const { audio, track } = useMusic(), [time, setTime] = useState(0), [duration, setDuration] = useState(0), [volume, setVolume] = useState(.7), [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const a = audio.current; if (!a) return; a.volume = volume;
    const update = () => { setTime(a.currentTime || 0); setDuration(Number.isFinite(a.duration) ? a.duration : 0); };
    const wait = () => setWaiting(true), go = () => setWaiting(false);
    for (const event of ['timeupdate', 'durationchange', 'emptied']) a.addEventListener(event, update);
    a.addEventListener('waiting', wait); a.addEventListener('playing', go); a.addEventListener('canplay', go);
    return () => { for (const event of ['timeupdate', 'durationchange', 'emptied']) a.removeEventListener(event, update); a.removeEventListener('waiting', wait); a.removeEventListener('playing', go); a.removeEventListener('canplay', go); };
  // Volume is applied by the control, not by resubscribing to audio events.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio]);
  const short = !track?.preview && duration > 0 && track && track.duration > 60 && duration < track.duration * .65;
  return <div className="music-progress"><span className="music-clock">{musicTime(time)}</span><input aria-label="音乐播放进度" type="range" min="0" max={duration || 1} step="1" value={Math.min(time, duration || 1)} disabled={!duration} onChange={e => { if (audio.current) audio.current.currentTime = Number(e.target.value); setTime(Number(e.target.value)); }} /><span className="music-clock">{duration ? musicTime(duration) : '--:--'}</span><label className="music-volume">音量<input aria-label="音乐音量" type="range" min="0" max="1" step="0.05" value={volume} onChange={e => { const v = Number(e.target.value); setVolume(v); if (audio.current) audio.current.volume = v; }} /></label>{(waiting || short) && <span className="music-stream-hint" role="status">{waiting ? '正在缓冲…' : '来源返回片段，可换其他版本'}</span>}</div>;
}
function MusicDock() {
  const m = useMusic(), path = usePathname();
  if (!m.track) return null;
  return <><div className="music-dock-spacer" /><section className="music-dock" aria-label="音乐播放器"><div className="music-now"><MusicArt track={m.track} /><div><Link href="/music">{m.track.title}</Link><p>{m.track.artist || '未知歌手'} · {musicSourceName(m.track.source)}</p></div></div><div className="music-controls"><button aria-label="上一首" onClick={() => m.next(-1)}><Icon name="skipPrevious" /></button><button className="music-play-main" aria-label={m.playing ? '暂停音乐' : '播放音乐'} disabled={m.loading} onClick={m.toggle}>{m.loading ? '…' : <Icon name={m.playing ? 'pause' : 'play'} />}</button><button aria-label="下一首" onClick={() => m.next()}><Icon name="skipNext" /></button></div><MusicProgress /><button className="music-dock-favorite" aria-label={m.favorites.some(t => musicKey(t) === musicKey(m.track!)) ? '取消喜欢当前歌曲' : '喜欢当前歌曲'} onClick={() => m.favorite(m.track!)}>{m.favorites.some(t => musicKey(t) === musicKey(m.track!)) ? '♥' : '♡'}</button>{path !== '/music' && <Link href="/music" className="music-dock-link">听歌</Link>}<div className={`music-dock-message ${m.error ? 'music-error' : ''}`} role={m.error ? 'alert' : 'status'}>{m.error || m.notice}</div></section></>;
}
