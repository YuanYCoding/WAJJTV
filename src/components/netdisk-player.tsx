'use client';
import { useEffect, useRef, useState } from 'react';
import type { PanQuality } from '@/lib/netdisk-types';
import { ViewingControls } from './viewing-controls';

export function NetdiskPlayer({ quality, title, identity, onNext, onRefresh }: { quality: PanQuality; title: string; identity: string; onNext?: () => void; onRefresh: () => void }) {
  const box = useRef<HTMLDivElement>(null); const video = useRef<HTMLVideoElement>(null);
  const [resolution, setResolution] = useState(''); const [error, setError] = useState('');
  const [theater, setTheater] = useState(false); const [autoNext, setAutoNext] = useState(false);
  const save = () => {
    const el = video.current;
    if (!el || !Number.isFinite(el.duration)) return;
    try { localStorage.setItem('jjbitv:pan-progress:' + identity, String(el.currentTime)); } catch { /* optional local progress */ }
  };
  useEffect(() => {
    const el = video.current; if (!el) return;
    let disposed = false; let destroy: (() => void) | undefined;
    if (quality.kind === 'hls' && !el.canPlayType('application/vnd.apple.mpegurl')) {
      void import('hls.js').then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) { setError('当前浏览器不支持这条转码线路，请切换原文件或使用其他浏览器'); return; }
        const hls = new Hls({ maxBufferLength: 30, backBufferLength: 30 }); destroy = () => hls.destroy();
        hls.attachMedia(el); hls.loadSource(quality.url);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { void el.play().catch(() => {}); });
        hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) setError('转码线路暂时不可用，请刷新地址或切换其他画质'); });
      });
    } else el.src = quality.url;
    return () => { disposed = true; save(); destroy?.(); };
  }, [quality.url, quality.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setError(''); setResolution(''); }, [quality.url]);
  useEffect(() => () => save(), [identity]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section className={theater ? 'fixed inset-0 z-50 bg-black p-3 sm:p-6 flex flex-col justify-center' : 'mt-6'}>
    <div className="flex items-center justify-between gap-3 mb-3"><h2 className="font-medium truncate">{title}</h2><span className="text-xs text-accent shrink-0">{resolution || '原文件 · 等待解码'}</span></div>
    <div ref={box} className="aspect-video max-h-[78vh] bg-black rounded-lg overflow-hidden">
      <video ref={video} controls autoPlay playsInline preload="metadata" className="w-full h-full" onLoadedMetadata={() => {
        const el = video.current!; if (el.videoWidth) setResolution(`实测 ${el.videoWidth} × ${el.videoHeight}`);
        try { const p = Number(localStorage.getItem('jjbitv:pan-progress:' + identity)); if (p > 0 && p < el.duration - 5) el.currentTime = p; } catch { /* unavailable storage */ }
      }} onResize={() => { const el = video.current!; if (el.videoWidth) setResolution(`实测 ${el.videoWidth} × ${el.videoHeight}`); }} onPause={save} onTimeUpdate={() => { if (video.current && Math.floor(video.current.currentTime) % 10 === 0) save(); }} onError={() => setError('当前浏览器无法播放此文件，可能是编码、网盘限速或播放地址失效。可以刷新地址，或用夸克 App 播放。')} onEnded={() => {
        try { localStorage.removeItem('jjbitv:pan-progress:' + identity); } catch { /* optional */ }
        if (autoNext) onNext?.();
      }} />
    </div>
    <div className="flex flex-wrap items-center gap-2 mt-3"><button className="btn-ghost btn-sm" onClick={onRefresh}>刷新播放地址</button>{onNext && <><button className="btn-ghost btn-sm" onClick={onNext}>下一集</button><label className="flex gap-2 items-center text-xs text-muted"><input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} />自动连播</label></>}</div>
    <ViewingControls playerRef={box} theater={theater} onTheater={() => setTheater((v) => !v)} />
    {error && <p role="alert" className="text-warning text-sm mt-3">{error}</p>}
    <p className="text-xs text-faint mt-3">首次播放已转存至你的「JjBiTV 追剧」目录。保留原文件画质，实际速度取决于账号与网络；本站不会自动删除网盘文件。</p>
  </section>;
}
