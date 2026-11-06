"use client";
/* eslint-disable @next/next/no-img-element -- bounded remote album covers with fallback. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { Icon } from './icon';
import { Drawer } from './drawer';
import { MUSIC_SOURCES, MUSIC_QUALITIES, musicKey, musicTime, musicCodecName, validMusicIdentity, type MusicSource, type MusicTrack, type MusicQuality, type MusicPlayback } from '@/lib/music-types';
interface MusicContextValue {
  track: MusicTrack | null; queue: MusicTrack[]; favorites: MusicTrack[]; playing: boolean; loading: boolean; error: string; notice: string;
  enabled: MusicSource[]; mode: 'sequence' | 'repeat' | 'shuffle'; quality: MusicQuality; unavailable: Set<string>;
  audio: RefObject<HTMLAudioElement | null>;
  play: (track: MusicTrack, queue?: MusicTrack[]) => Promise<void>; toggle: () => void; next: (direction?: number) => void;
  enqueue: (track: MusicTrack) => void; favorite: (track: MusicTrack) => void; setEnabled: (ids: MusicSource[]) => void;
  setMode: (mode: 'sequence' | 'repeat' | 'shuffle') => void; clearQueue: () => void;
  changeQuality: (quality: MusicQuality) => Promise<void>; clearUnavailable: () => void;
}
const MusicContext = createContext<MusicContextValue | null>(null), STORAGE = 'jjbitv-music-v1';
const validTracks = (v: unknown): MusicTrack[] => Array.isArray(v) ? v.filter(t => t && validMusicIdentity(t.source, t.id) && !t.preview && typeof t.title === 'string' && typeof t.artist === 'string' && typeof t.album === 'string' && typeof t.cover === 'string' && Number.isFinite(t.duration)).slice(0, 200) : [];
const durable = (t: MusicTrack): MusicTrack => ({ source: t.source, id: t.id, title: t.title, artist: t.artist, album: t.album, cover: t.cover, duration: t.duration });
export function useMusic() { const value = useContext(MusicContext); if (!value) throw new Error('MusicProvider missing'); return value; }
export function MusicProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null), request = useRef<AbortController | null>(null), sequence = useRef(0), metadataCleanup = useRef<(() => void) | null>(null), retried = useRef(false);
  const [track, setTrack] = useState<MusicTrack | null>(null), [queue, setQueue] = useState<MusicTrack[]>([]), [favorites, setFavorites] = useState<MusicTrack[]>([]);
  const [playing, setPlaying] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [enabled, setEnabled] = useState<MusicSource[]>(MUSIC_SOURCES.filter(s => s.id !== 'apple').map(s => s.id));
  const [mode, setMode] = useState<'sequence' | 'repeat' | 'shuffle'>('sequence'), [quality, setQuality] = useState<MusicQuality>('auto'), [ready, setReady] = useState(false), [unavailable, setUnavailable] = useState(new Set<string>());
  const playbackRef = useRef({ track, quality, loading }); playbackRef.current = { track, quality, loading };
  useEffect(() => {
    try { const d = JSON.parse(localStorage.getItem(STORAGE) || '{}'); setFavorites(validTracks(d.favorites)); setQueue(validTracks(d.queue)); if (Array.isArray(d.enabled)) setEnabled(MUSIC_SOURCES.filter(s => s.id !== 'apple' && d.enabled.includes(s.id)).map(s => s.id)); if (MUSIC_QUALITIES.some(q => q.id === d.quality)) setQuality(d.quality); } catch { /* local storage unavailable */ }
    setReady(true); return () => { request.current?.abort(); metadataCleanup.current?.(); };
  }, []);
  useEffect(() => { if (ready) try { localStorage.setItem(STORAGE, JSON.stringify({ favorites: favorites.map(durable), queue: queue.map(durable), enabled, quality })); } catch { /* local storage full */ } }, [favorites, queue, enabled, quality, ready]);
  useEffect(() => { const pauseForVideo = (e: Event) => { if (e.target instanceof HTMLVideoElement) audio.current?.pause(); }; document.addEventListener('play', pauseForVideo, true); return () => document.removeEventListener('play', pauseForVideo, true); }, []);
  const start = useCallback(async (item: MusicTrack, list: MusicTrack[] | undefined, targetQuality: MusicQuality, flags: { switching?: boolean; retry?: boolean; resumeAt?: number } = {}) => {
    request.current?.abort(); metadataCleanup.current?.();
    const seq = ++sequence.current, controller = new AbortController(); request.current = controller;
    const a = audio.current; if (!a) return;
    const keep = flags.switching && Boolean(a.getAttribute('src')), wasPlaying = !a.paused;
    const originalSrc = a.getAttribute('src'), originalTrack = playbackRef.current.track, originalQuality = playbackRef.current.quality;
    let originalPosition = a.currentTime;
    if (!flags.retry) retried.current = false;
    if (!keep) { a.pause(); a.removeAttribute('src'); a.load(); setTrack(item); }
    setLoading(true); setError(''); setNotice(keep ? '正在切换音质…' : '正在准备播放…');
    if (list?.length) setQueue(list.slice(0, 200)); else setQueue(q => q.some(t => musicKey(t) === musicKey(item)) ? q : [...q.slice(-199), item]);
    try {
      let playback: MusicPlayback, effectiveQuality = targetQuality, fallbackNotice = '';
      if (!flags.retry && !flags.switching && item.playback && item.playback.quality === targetQuality && item.playback.expires > Date.now() + 15000) playback = item.playback;
      else {
        const r = await fetch('/api/music/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: item.source, id: item.id, quality: targetQuality, track: durable(item), fresh: Boolean(flags.retry) }), signal: controller.signal });
        const d = await r.json();
        if (!r.ok && !flags.switching && targetQuality !== 'auto') {
          if (item.playback && item.playback.expires > Date.now() + 15000) playback = item.playback;
          else { const fallback = await fetch('/api/music/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: item.source, id: item.id, quality: 'auto', track: durable(item), fresh: Boolean(flags.retry) }), signal: controller.signal }); const ready = await fallback.json(); if (!fallback.ok) throw new Error(ready.error || '歌曲暂不可用'); playback = ready; }
          effectiveQuality = 'auto'; fallbackNotice = '此歌曲未提供所选档位，已使用自动音质';
        } else { if (!r.ok) throw new Error(d.error || '所选音质暂不可用'); playback = d; }
      }
      if (seq !== sequence.current) return;
      const resume = keep ? a.currentTime : flags.resumeAt || 0;
      originalPosition = resume;
      const restore = () => { if (seq !== sequence.current) return; if (resume > 0 && Number.isFinite(a.duration)) a.currentTime = Math.min(resume, Math.max(0, a.duration - 1)); };
      a.addEventListener('loadedmetadata', restore, { once: true }); metadataCleanup.current = () => a.removeEventListener('loadedmetadata', restore);
      a.pause(); a.src = playback.url; a.load(); setTrack({ ...item, preview: false, duration: playback.duration, playback }); setQuality(effectiveQuality);
      setUnavailable(old => { const copy = new Set(old); copy.delete(musicKey(item)); return copy; }); setNotice(fallbackNotice);
      if (!keep || wasPlaying) try { await a.play(); } catch (e) { if (e instanceof DOMException && e.name === 'NotAllowedError') { if (seq === sequence.current) setNotice('点击播放继续'); } else throw e; }
    } catch (e) {
      if (!controller.signal.aborted && seq === sequence.current) {
        if (keep) {
          if (a.getAttribute('src') !== originalSrc && originalSrc && originalTrack) {
            metadataCleanup.current?.(); a.src = originalSrc;
            const restore = () => { a.currentTime = Math.min(originalPosition, Math.max(0, a.duration - 1)); };
            a.addEventListener('loadedmetadata', restore, { once: true }); metadataCleanup.current = () => a.removeEventListener('loadedmetadata', restore);
            a.load(); setTrack(originalTrack); setQuality(originalQuality); if (wasPlaying) void a.play().catch(() => {});
          }
          setNotice('所选音质暂不可用，继续使用当前音质');
        }
        else { setError(e instanceof Error ? e.message : '播放失败'); setNotice(''); setUnavailable(old => new Set(old).add(musicKey(item))); }
      }
    } finally { if (seq === sequence.current) setLoading(false); }
  }, []);
  const play = useCallback((item: MusicTrack, list?: MusicTrack[]) => start(item, list, quality), [start, quality]);
  const next = useCallback((direction = 1) => {
    const available = queue.filter(t => !unavailable.has(musicKey(t))); if (!available.length) return;
    const index = track ? available.findIndex(t => musicKey(t) === musicKey(track)) : -1;
    const target = mode === 'shuffle' && available.length > 1 ? (Math.max(0, index) + 1 + Math.floor(Math.random() * (available.length - 1))) % available.length : (index + direction + available.length) % available.length;
    void play(available[target]);
  }, [queue, track, mode, play, unavailable]);
  const toggle = useCallback(() => { if (!track || !audio.current) return; if (error || !audio.current.getAttribute('src')) { void start(track, undefined, quality, { retry: true }); return; } if (audio.current.paused) void audio.current.play().catch(() => setError('浏览器未开始播放，请再次点击')); else audio.current.pause(); }, [track, error, start, quality]);
  const changeQuality = useCallback(async (value: MusicQuality) => { if (!track) { setQuality(value); return; } if (value !== quality) await start(track, undefined, value, { switching: true }); }, [track, quality, start]);
  const favorite = useCallback((item: MusicTrack) => setFavorites(items => items.some(t => musicKey(t) === musicKey(item)) ? items.filter(t => musicKey(t) !== musicKey(item)) : [durable(item), ...items].slice(0, 200)), []);
  const enqueue = useCallback((item: MusicTrack) => setQueue(items => items.some(t => musicKey(t) === musicKey(item)) ? items : [...items, item].slice(-200)), []);
  useEffect(() => {
    if (!track || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album });
    navigator.mediaSession.setActionHandler('play', () => { if (audio.current?.paused) toggle(); }); navigator.mediaSession.setActionHandler('pause', () => audio.current?.pause()); navigator.mediaSession.setActionHandler('nexttrack', () => next()); navigator.mediaSession.setActionHandler('previoustrack', () => next(-1)); navigator.mediaSession.setActionHandler('seekto', e => { if (audio.current && typeof e.seekTime === 'number') audio.current.currentTime = e.seekTime; });
    return () => { for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto'] as const) navigator.mediaSession.setActionHandler(action, null); };
  }, [track, toggle, next]);
  const audioError = () => {
    const a = audio.current, current = playbackRef.current;
    if (!a?.getAttribute('src') || a.error?.code === 1 || current.loading || !current.track) return;
    if (!retried.current) { retried.current = true; void start(current.track, undefined, current.quality, { retry: true, resumeAt: a.currentTime }); }
    else { setError('这条线路已不可用，请选择其他歌曲'); setUnavailable(old => new Set(old).add(musicKey(current.track!))); }
  };
  return <MusicContext.Provider value={{ track, queue, favorites, playing, loading, error, notice, audio, play, toggle, next, favorite, enqueue, enabled, setEnabled, mode, setMode, quality, changeQuality, unavailable, clearUnavailable: () => setUnavailable(new Set()), clearQueue: () => setQueue([]) }}><audio ref={audio} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={audioError} onEnded={() => { if (mode === 'repeat' && audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => {}); } else if (queue.length > 1) next(); }} />{children}<MusicDock /></MusicContext.Provider>;
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
  const m = useMusic(), [queueOpen, setQueueOpen] = useState(false);
  if (!m.track) return null;
  return <><div className="music-dock-spacer" /><section className="music-dock" aria-label="音乐播放器"><div className="music-now"><MusicArt track={m.track} /><div><Link href="/music">{m.track.title}</Link><p>{m.track.artist || '未知歌手'}</p></div></div><div className="music-controls"><button aria-label="上一首" onClick={() => m.next(-1)}><Icon name="skipPrevious" /></button><button className="music-play-main" aria-label={m.playing ? '暂停音乐' : '播放音乐'} disabled={m.loading} onClick={m.toggle}>{m.loading ? '…' : <Icon name={m.playing ? 'pause' : 'play'} />}</button><button aria-label="下一首" onClick={() => m.next()}><Icon name="skipNext" /></button></div><MusicProgress /><MusicQualityControl /><button className="music-dock-favorite" aria-label={m.favorites.some(t => musicKey(t) === musicKey(m.track!)) ? '取消喜欢当前歌曲' : '喜欢当前歌曲'} onClick={() => m.favorite(m.track!)}>{m.favorites.some(t => musicKey(t) === musicKey(m.track!)) ? '♥' : '♡'}</button><button className="music-dock-queue" aria-label="播放队列" aria-expanded={queueOpen} onClick={() => setQueueOpen(true)}><Icon name="queue" /></button><div className={`music-dock-message ${m.error ? 'music-error' : ''}`} role={m.error ? 'alert' : 'status'}>{m.error || m.notice}</div></section><MusicQueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} /></>;
}

function MusicQualityControl() {
  const m = useMusic(), info = m.track?.playback;
  const codec = musicCodecName(info?.codec);
  return <div className="music-quality"><select aria-label="音乐音质" value={m.quality} disabled={m.loading} onChange={e => void m.changeQuality(e.target.value as MusicQuality)}>{MUSIC_QUALITIES.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}</select>{info && <small title={`${info.codec} · ${info.sampleRate}Hz · ${info.bits || '—'}bit`}>{codec}{info.bits && /FLAC|PCM/.test(codec) ? ` ${info.bits}bit` : ''} · {info.kbps}k</small>}</div>;
}

function MusicQueueDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = useMusic();
  return <Drawer open={open} onClose={onClose} title="播放队列"><label className="music-mode-label">播放方式<select aria-label="播放方式" value={m.mode} onChange={e => m.setMode(e.target.value as typeof m.mode)}><option value="sequence">顺序播放</option><option value="repeat">单曲循环</option><option value="shuffle">随机播放</option></select></label><div className="music-queue music-drawer-queue"><ol>{m.queue.filter(t => !m.unavailable.has(musicKey(t))).map(t => <li key={musicKey(t)}><button className={m.track && musicKey(m.track) === musicKey(t) ? 'active' : ''} onClick={() => void m.play(t)}><span aria-hidden="true">▷</span><span><strong>{t.title}</strong><small>{t.artist || '未知歌手'}</small></span></button></li>)}</ol>{m.queue.length ? <button className="music-clear-queue" onClick={m.clearQueue}>清空队列</button> : <p className="music-queue-empty">暂无待播歌曲</p>}</div></Drawer>;
}
