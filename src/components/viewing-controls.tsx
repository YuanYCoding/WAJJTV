'use client';
import { useEffect, useState, type RefObject } from 'react';

export function ViewingControls({ playerRef, theater, onTheater }: { playerRef: RefObject<HTMLDivElement | null>; theater?: boolean; onTheater?: () => void }) {
  const [minutes, setMinutes] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (!deadline) return;
    const check = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 60_000));
      setRemaining(left);
      if (!left) {
        playerRef.current?.querySelector('video')?.pause();
        setDeadline(0); setMinutes(0); setFinished(true);
      }
    };
    check();
    const timer = setInterval(check, 1000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, [deadline, playerRef]);
  return <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-muted">
    {onTheater && <button className="btn-ghost btn-sm" aria-pressed={theater} onClick={onTheater}>{theater ? '退出影院宽屏' : '影院宽屏'}</button>}
    <label className="flex items-center gap-2">定时暂停<select aria-label="定时暂停" className="bg-surface-raised border border-line rounded-md p-1.5 text-content" value={minutes} onChange={(e) => {
      const value = Number(e.target.value); setMinutes(value); setRemaining(value); setFinished(false); setDeadline(value ? Date.now() + value * 60_000 : 0);
    }}><option value={0}>关闭</option><option value={15}>15 分钟</option><option value={30}>30 分钟</option><option value={60}>60 分钟</option><option value={90}>90 分钟</option></select></label>
    <span role="status">{deadline ? `约 ${remaining} 分钟后暂停` : finished ? '已按时暂停，晚安。继续播放请点击播放器。' : ''}</span>
  </div>;
}
