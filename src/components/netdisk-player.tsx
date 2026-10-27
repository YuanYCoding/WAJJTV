'use client';
import { useEffect, useRef, useState } from 'react';
import type ArtPlayer from 'artplayer';
import type HlsType from 'hls.js';
import type { PanQuality } from '@/lib/netdisk-types';
import { directFallbackLoader, seekPosition } from '@/lib/pan-player-utils';
import { ViewingControls } from './viewing-controls';
export function preloadPanPlayer() { void import('artplayer').catch(() => {}); void import('hls.js').catch(() => {}); }

interface Props { quality: PanQuality; title: string; identity: string; saved: boolean; limited?: boolean; provider?: 'quark' | 'aliyun'; notice?: string; lease?: string; nextRequiresSave?: boolean; onNext?: (automatic?: boolean) => void; onRefresh: () => void; onStall?: () => boolean }
const skipIcon = (forward: boolean) => `<button type="button" aria-label="${forward ? '快进' : '后退'}10秒" style="color:inherit;background:transparent;border:0;padding:0;width:28px;height:28px;cursor:pointer"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="${forward ? 'M17 3v5h-5M17 8a8 8 0 1 0 3 6' : 'M7 3v5h5M7 8a8 8 0 1 1-3 6'}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="17" text-anchor="middle" fill="currentColor" font-size="9" font-family="Arial">10</text></svg></button>`;
export function NetdiskPlayer(props: Props) {
  const { quality, title, identity, lease, onNext, onRefresh } = props;
  const box = useRef<HTMLDivElement>(null), container = useRef<HTMLDivElement>(null), player = useRef<ArtPlayer | null>(null), latest = useRef(props); latest.current = props;
  const position = useRef<{ identity: string; time: number }>({ identity, time: 0 });
  const [resolution, setResolution] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState('播放器准备中…');
  const [theater, setTheater] = useState(false), [autoNext, setAutoNext] = useState(false);
  const autoNextRef = useRef(false); autoNextRef.current = autoNext;
  useEffect(() => { try { setAutoNext(localStorage.getItem('jjbitv:pan-autonext') === 'true'); } catch { /* storage optional */ } }, []);
  useEffect(() => {
    if (!lease) return;
    let renewing = false;
    const send = (release = false) => {
      if (!release && player.current?.video.ended) return;
      void fetch('/api/netdisk/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lease, release }), keepalive: release }).then(async (r) => {
        if (release || !r.ok) return; const value = await r.json();
        if (value.active === false && !renewing && player.current?.playing) { renewing = true; latest.current.onRefresh(); }
      }).catch(() => {});
    };
    send(); const timer = setInterval(() => send(), 30_000); return () => { clearInterval(timer); send(true); };
  }, [lease]);
  useEffect(() => {
    const host = container.current;
    let disposed = false, art: ArtPlayer | null = null, hls: HlsType | undefined, lastSave = 0, restored = false, lastTime = -1, stuckSince = 0, lastRecovery = 0;
    let monitor: ReturnType<typeof setInterval> | undefined; let removeKeys = () => {}; let removeResize = () => {};
    setError(''); setResolution(''); setStatus('正在连接播放线路…');
    if (position.current.identity !== identity) position.current = { identity, time: 0 };
    const save = () => { const video = art?.video; if (disposed || !video || video.ended || !Number.isFinite(video.duration)) return; position.current = { identity, time: video.currentTime }; try { localStorage.setItem('jjbitv:pan-progress:' + identity, String(video.currentTime)); } catch { /* optional */ } };
    const recover = () => { const now = Date.now(); if (now - lastRecovery < 25_000) return; lastRecovery = now; save(); if (latest.current.onStall?.()) setStatus('正在切换更流畅的线路…'); };
    void Promise.all([import('artplayer'), quality.kind === 'hls' ? import('hls.js') : Promise.resolve(null)]).then(([{ default: Artplayer }, hlsModule]) => {
      if (disposed || !host) return;
      Artplayer.LOG_VERSION = false;
      art = new Artplayer({
        container: host, url: quality.url, type: quality.kind === 'hls' ? 'm3u8' : 'mp4', autoplay: true, volume: 0.8,
        theme: '#d3b278', lang: 'zh-cn', setting: true, playbackRate: true, pip: true, fullscreen: true, fullscreenWeb: true,
        hotkey: false, gesture: true, fastForward: true, lock: true, playsInline: true, miniProgressBar: true, mutex: true,
        moreVideoAttr: { playsInline: true, preload: 'metadata' },
        controls: [
          { name: 'back-10', position: 'left', index: 11, html: skipIcon(false), tooltip: '后退10秒（← / J）', click: () => { if (art) art.seek = seekPosition(art.currentTime, -10, art.duration); } },
          { name: 'forward-10', position: 'left', index: 12, html: skipIcon(true), tooltip: '快进10秒（→ / L）', click: () => { if (art) art.seek = seekPosition(art.currentTime, 10, art.duration); } },
        ],
        customType: { m3u8: (video: HTMLVideoElement, url: string) => {
          if (hlsModule?.default.isSupported()) {
            const Hls = hlsModule.default;
            hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 60, maxMaxBufferLength: 120, backBufferLength: 20, maxBufferSize: 48 * 1024 * 1024, loader: directFallbackLoader(hlsModule.FetchLoader), fetchSetup: (context, init) => new Request(context.url, { ...init, credentials: 'same-origin', referrerPolicy: 'no-referrer' }) });
            hls.loadSource(url); hls.attachMedia(video); let networkRetries = 0, mediaRetries = 0;
            hls.on(Hls.Events.ERROR, (_, data) => { if (!data.fatal || disposed) return; if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 2) { hls?.startLoad(video.currentTime); return; } if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 1) { hls?.recoverMediaError(); return; } setError('播放线路暂时不稳定，可以切换流畅画质或刷新地址'); recover(); });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
          else setError('当前浏览器不支持这条视频线路，请更换浏览器或选择其他线路');
        } },
      });
      player.current = art;
      const report = () => { const v = art?.video; if (!disposed && v?.videoWidth) setResolution(`实测 ${v.videoWidth} × ${v.videoHeight}`); };
      art.on('video:loadedmetadata', () => { report(); if (restored || !art || !Number.isFinite(art.duration)) return; restored = true; let t = position.current.time; try { if (!t) t = Number(localStorage.getItem('jjbitv:pan-progress:' + identity)) || 0; } catch { /* optional */ } if (t > 0 && t < art.duration - 3) art.seek = t; });
      art.on('video:playing', () => { setStatus(''); setError(''); stuckSince = 0; report(); });
      art.on('video:waiting', () => setStatus('正在缓冲…'));
      art.on('video:seeking', () => { setStatus('正在跳转…'); stuckSince = Date.now(); });
      art.on('video:seeked', () => setStatus(''));
      art.on('video:timeupdate', () => { if (disposed) return; if (art) position.current = { identity, time: art.currentTime }; if (Date.now() - lastSave > 5000) { save(); lastSave = Date.now(); } });
      art.on('video:pause', save);
      art.on('video:ended', () => { position.current.time = 0; try { localStorage.removeItem('jjbitv:pan-progress:' + identity); } catch { /* optional */ } if (autoNextRef.current) latest.current.onNext?.(true); });
      art.on('video:error', () => { if (!disposed) { setError(quality.original ? '浏览器可能不支持原文件的容器或编码。可在下方使用外部播放器，或选择上方的完整转码线路。' : '视频加载异常，请切换转码线路或刷新播放地址'); recover(); } });
      art.video.addEventListener('resize', report); removeResize = () => art?.video.removeEventListener('resize', report);
      const keyboard = (e: KeyboardEvent) => {
        if (!art || e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
        const key = e.key.toLowerCase(); if (['arrowleft', 'arrowright', 'j', 'l'].includes(key)) { e.preventDefault(); art.seek = seekPosition(art.currentTime, (['arrowleft', 'j'].includes(key) ? -1 : 1) * (e.shiftKey ? 60 : 10), art.duration); }
        else if (key === ' ' || key === 'k') { if (key === ' ' && (e.target as HTMLElement)?.closest('button,a,[role="button"]')) return; e.preventDefault(); if (art.playing) art.pause(); else void art.play().catch(() => {}); }
      };
      window.addEventListener('keydown', keyboard); removeKeys = () => window.removeEventListener('keydown', keyboard);
      monitor = setInterval(() => { if (!art || art.video.paused || art.video.ended) { stuckSince = 0; return; } if (Math.abs(art.currentTime - lastTime) > .1 && !art.video.seeking) { lastTime = art.currentTime; stuckSince = 0; } else { stuckSince ||= Date.now(); if (Date.now() - stuckSince > 10_000) recover(); } }, 2000);
    }).catch(() => { if (!disposed) setError('播放器加载失败，请刷新页面'); });
    return () => { save(); disposed = true; clearInterval(monitor); removeKeys(); removeResize(); hls?.destroy(); art?.destroy(false); host?.replaceChildren(); if (player.current === art) player.current = null; };
  }, [quality.url, quality.kind, quality.original, identity]);
  return <section className={theater ? 'fixed inset-0 z-50 bg-black p-3 sm:p-6 flex flex-col justify-center' : 'mt-4'}>
    <div className="flex items-center justify-between gap-3 mb-3"><h2 className="font-medium truncate">{title}</h2><span className="text-xs text-accent shrink-0">{resolution || '正在读取实际画质'}</span></div>
    <div ref={box} className="relative aspect-video max-h-[78vh] bg-black rounded-xl overflow-hidden"><div ref={container} data-testid="pan-artplayer" className="h-full w-full" />{status && <div role="status" className="absolute top-3 left-3 pointer-events-none rounded bg-black/60 px-3 py-1.5 text-xs text-white">{status}</div>}</div>
    <div className="flex flex-wrap items-center gap-3 mt-4"><button className="btn-ghost btn-sm" onClick={onRefresh}>刷新播放地址</button>{onNext && <><button className="btn-ghost btn-sm" onClick={() => onNext()}>下一集</button><label className="flex gap-2 items-center text-xs text-muted"><input type="checkbox" checked={autoNext} onChange={(e) => { setAutoNext(e.target.checked); try { localStorage.setItem('jjbitv:pan-autonext', String(e.target.checked)); } catch { /* optional */ } }} />自动准备下一集</label></>}<span className="text-[11px] text-faint">← → 跳转10秒 · Shift 加速跳转 · 空格暂停</span></div>
    <ViewingControls playerRef={box} theater={theater} onTheater={() => setTheater((v) => !v)} />
    {error && <p role="alert" className="text-warning text-sm mt-3">{error}</p>}
    {props.notice && <p className="text-xs text-faint mt-3 leading-6">{props.notice}</p>}
  </section>;
}
