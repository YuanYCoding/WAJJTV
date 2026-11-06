'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMusic } from './music-provider';
import { MUSIC_SOURCES } from '@/lib/music-types';
import { copyToClipboard } from '@/lib/clipboard';
import type { MUSIC_INTERFACES } from '@/lib/music-interfaces';
export function MusicSourceManager() {
  const m = useMusic(), [message, setMessage] = useState('');
  const status = useQuery({ queryKey: ['music-sources'], queryFn: async () => {
    const r = await fetch('/api/music/sources'); if (!r.ok) throw new Error('无法获取音乐源状态');
    return r.json() as Promise<{ sources: { id: string; retryAt: number; ms?: number; error?: string }[]; interfaces: typeof MUSIC_INTERFACES }>;
  }, staleTime: 15_000 });
  return <div className="space-y-4"><h3 className="text-sm font-medium">音乐来源</h3>
    {MUSIC_SOURCES.map(s => {
      const h = status.data?.sources.find(h => h.id === s.id);
      return <label key={s.id} className="flex gap-3 items-center border-b border-line py-3 cursor-pointer"><input type="checkbox" className="accent-accent" checked={m.enabled.includes(s.id)} onChange={e => m.setEnabled(e.target.checked ? [...m.enabled, s.id] : m.enabled.filter(id => id !== s.id))} /><span className="flex-1 text-sm">{s.name}</span><span className="text-xs text-faint">{h?.retryAt && h.retryAt > Date.now() ? '稍后重试' : h?.error ? '暂不可用' : h?.ms !== undefined ? `${h.ms}ms` : ''}</span></label>;
    })}
    <div className="flex gap-4 items-center"><button className="btn-secondary text-xs" onClick={() => void status.refetch()}>刷新状态</button><a className="text-xs text-accent" href="/api/music/sources" target="_blank" rel="noopener noreferrer">接口 JSON ↗</a></div>
    <details className="border-t border-line pt-4"><summary className="cursor-pointer text-sm">查看接口{status.data ? `（${status.data.interfaces.length}）` : ''}</summary><div className="mt-3 space-y-1">{status.data?.interfaces.map(s => <details className="border-b border-line py-3" key={s.id}><summary className="cursor-pointer text-xs text-content">{s.name}<span className="ml-2 text-faint">{s.role}</span></summary><div className="mt-3 space-y-3 text-xs"><div className="flex gap-2 items-start"><code className="block p-2 rounded bg-chip break-all flex-1 min-w-0" data-testid="music-interface-url">{s.url}</code><button className="btn-ghost btn-sm shrink-0" aria-label={`复制 ${s.name} 接口`} onClick={async () => { try { const ok = await copyToClipboard(s.url); setMessage(ok ? '已复制接口地址' : '复制失败，可手动选择地址'); } catch { setMessage('复制失败，可手动选择地址'); } }}>复制</button></div><p className="text-muted leading-6">{s.parameters}</p><p className="text-faint leading-6">{s.note}</p><a className="text-accent inline-block" href={s.docs} target="_blank" rel="noopener noreferrer">来源文档 ↗</a></div></details>)}</div></details>
    <p role="status" className="text-xs text-accent">{message}</p>{status.error && <p role="alert" className="text-xs text-muted">{status.error.message}</p>}
  </div>;
}
