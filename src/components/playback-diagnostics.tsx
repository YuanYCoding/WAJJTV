'use client';
import { useEffect, useState, type RefObject } from 'react';
import { bufferedAhead, playbackDiagnosis, playbackMode, PLAYBACK_MODE_KEY, type PlaybackMode } from '@/lib/playback-tuning';
export function PlaybackDiagnostics({ container }: { container: RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = useState(false), [mode, setMode] = useState<PlaybackMode>('quality'), [stats, setStats] = useState({ ahead: 0, width: 0, height: 0, dropped: 0, stalls: 0, diagnosis: '正在读取播放状态' });
  useEffect(() => { setMode(playbackMode()); }, []);
  useEffect(() => {
    if (!open) return; let lastTime = -1, lastTotal = 0, lastDropped = 0, stalls = 0, wasStalled = false;
    const timer = setInterval(() => { const v = container.current?.querySelector('video'); if (!v) return; const q = v.getVideoPlaybackQuality?.(), total = q?.totalVideoFrames || 0, dropped = q?.droppedVideoFrames || 0, ratio = total > lastTotal ? Math.max(0, dropped - lastDropped) / (total - lastTotal) : 0; lastTotal = total; lastDropped = dropped;
      const stalled = !v.paused && !v.seeking && !v.ended && v.currentTime > 1 && Math.abs(v.currentTime - lastTime) < .05; if (stalled && !wasStalled) stalls++; wasStalled = stalled; lastTime = v.currentTime; const ahead = bufferedAhead(v); setStats({ ahead, width: v.videoWidth, height: v.videoHeight, dropped: ratio, stalls, diagnosis: playbackDiagnosis(ahead, ratio, stalled) });
    }, 1500); return () => clearInterval(timer);
  }, [open, container]);
  return <div className="mt-2 text-xs"><button type="button" className="text-muted hover:text-accent" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? '收起播放诊断' : '播放诊断与流畅设置'}</button>{open && <div role="status" className="mt-3 rounded-lg border border-line bg-surface p-3 text-muted leading-7"><p>缓冲 {stats.ahead.toFixed(1)} 秒 · 实际 {stats.width} × {stats.height} · 近段丢帧 {(stats.dropped * 100).toFixed(1)}% · 观察到停顿 {stats.stalls} 次</p><p>{stats.diagnosis}</p><label>播放策略 <select className="input ml-2 text-xs" value={mode} onChange={(e) => { const value = e.target.value as PlaybackMode; setMode(value); try { localStorage.setItem(PLAYBACK_MODE_KEY, value); } catch { /* optional */ } window.dispatchEvent(new Event('playback-mode-changed')); }}><option value="quality">画质优先（不主动降档）</option><option value="smooth">流畅优先（允许多档位自动调整）</option></select></label><p className="text-faint">流畅优先只在来源提供多个档位时生效。缓冲充足却持续丢帧时，可检查 Chrome／Edge 图形加速，或用外部播放器播放高码率原文件。</p></div>}</div>;
}
