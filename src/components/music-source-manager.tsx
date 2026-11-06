'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMusic } from './music-provider';
import { MUSIC_SOURCES, musicCodecName } from '@/lib/music-types';
import { copyToClipboard } from '@/lib/clipboard';
import type { MUSIC_INTERFACES } from '@/lib/music-interfaces';
export function MusicSourceManager() {
  const m = useMusic(), [message, setMessage] = useState('');
  const status = useQuery({ queryKey: ['music-sources'], queryFn: async () => {
    const r = await fetch('/api/music/sources'); if (!r.ok) throw new Error('无法获取音乐源状态');
    return r.json() as Promise<{ sources: { id: string; retryAt: number; ms?: number; error?: string }[]; interfaces: typeof MUSIC_INTERFACES; resolvers: { id: string; name: string; reference: string; file: string; qualities: string[]; url: string; health: { ok?: boolean; retryAt: number; error?: string; codec?: string; kbps?: number } }[] }>;
  }, staleTime: 15_000 });
  return <div className="space-y-4"><h3 className="text-sm font-medium">播放音源</h3>
    {status.data?.resolvers.map(r => <details className="border-b border-line py-3" key={r.id}><summary className="cursor-pointer text-sm flex justify-between gap-3"><span>{r.name}</span><span className="text-xs text-faint">{r.health.retryAt > Date.now() ? '稍后重试' : r.health.ok ? `${musicCodecName(r.health.codec)} · ${r.health.kbps}k` : r.health.ok === false ? '上次样本未通过' : ''}</span></summary><div className="text-xs text-muted mt-3 space-y-2"><p>{r.qualities.join(' / ')}</p><code className="block break-all">{r.url}</code>{r.health.error && <p>{r.health.error}</p>}<a className="text-accent" href={r.reference} target="_blank" rel="noopener noreferrer">源文件 ↗</a></div></details>)}
    <details><summary className="cursor-pointer text-sm">搜索曲库</summary>{MUSIC_SOURCES.filter(s => s.id !== 'apple').map(s => {
      const h = status.data?.sources.find(h => h.id === s.id);
      return <label key={s.id} className="flex gap-3 items-center border-b border-line py-3 cursor-pointer"><input type="checkbox" className="accent-accent" checked={m.enabled.includes(s.id)} onChange={e => m.setEnabled(e.target.checked ? [...m.enabled, s.id] : m.enabled.filter(id => id !== s.id))} /><span className="flex-1 text-sm">{s.name}</span><span className="text-xs text-faint">{h?.retryAt && h.retryAt > Date.now() ? '稍后重试' : h?.error ? '暂不可用' : h?.ms !== undefined ? `${h.ms}ms` : ''}</span></label>;
    })}</details>
    <div className="flex gap-4 items-center"><button className="btn-secondary text-xs" onClick={() => void status.refetch()}>刷新状态</button><a className="text-xs text-accent" href="/api/music/sources" target="_blank" rel="noopener noreferrer">接口 JSON ↗</a></div>
    <details className="border-t border-line pt-4"><summary className="cursor-pointer text-sm">查看接口{status.data ? `（${status.data.interfaces.length}）` : ''}</summary><div className="mt-3 space-y-1">{status.data?.interfaces.map(s => <details className="border-b border-line py-3" key={s.id}><summary className="cursor-pointer text-xs text-content">{s.name}<span className="ml-2 text-faint">{s.role}</span></summary><div className="mt-3 space-y-3 text-xs"><div className="flex gap-2 items-start"><code className="block p-2 rounded bg-chip break-all flex-1 min-w-0" data-testid="music-interface-url">{s.url}</code><button className="btn-ghost btn-sm shrink-0" aria-label={`复制 ${s.name} 接口`} onClick={async () => { try { const ok = await copyToClipboard(s.url); setMessage(ok ? '已复制接口地址' : '复制失败，可手动选择地址'); } catch { setMessage('复制失败，可手动选择地址'); } }}>复制</button></div><p className="text-muted leading-6">{s.parameters}</p><p className="text-faint leading-6">{s.note}</p><a className="text-accent inline-block" href={s.docs} target="_blank" rel="noopener noreferrer">来源文档 ↗</a></div></details>)}</div></details>
    <p role="status" className="text-xs text-accent">{message}</p>{status.error && <p role="alert" className="text-xs text-muted">{status.error.message}</p>}
  </div>;
}
