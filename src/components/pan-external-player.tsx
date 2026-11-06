'use client';
import { useState } from 'react';
import type { PanProvider, PanQuality } from '@/lib/netdisk-types';
export function PanExternalPlayer({ provider, quality, lease, onLease }: { provider: PanProvider; quality: PanQuality; lease?: string; onLease: (lease: string) => void }) {
  const [link, setLink] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const create = async () => {
    setBusy(true); setMessage('');
    try { const r = await fetch('/api/netdisk/external', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, url: quality.url, lease }) }); const value = await r.json(); if (!r.ok) throw new Error(value.error || '外部地址获取失败'); setLink(value.url); onLease(value.lease); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="mt-4 border-t border-line pt-4"><p className="text-xs text-muted leading-6">原画容器或编码不受浏览器支持时，可交给外部播放器。获取地址后，此文件会保留 6 小时，避免播放中被自动清理。</p>{!link ? <button className="btn-ghost btn-sm mt-2" disabled={busy || !lease} onClick={() => void create()}>{busy ? '正在获取原画地址…' : '获取外部播放地址'}</button> : <><div className="flex flex-wrap gap-2 mt-2"><a className="btn-ghost btn-sm" href={'potplayer://' + link}>PotPlayer 打开</a><a className="btn-ghost btn-sm" href={'vlc://' + link}>VLC 打开</a><button className="btn-ghost btn-sm" onClick={() => { void navigator.clipboard.writeText(link).then(() => setMessage('已复制，在播放器的“打开网络串流”中粘贴')).catch(() => setMessage('请从下方输入框选择并复制地址')); }}>复制播放地址</button></div><input className="input w-full mt-2 text-xs" aria-label="外部播放地址" readOnly value={link} onFocus={(e) => e.currentTarget.select()} /><p className="text-xs text-faint mt-2">临时链接最长有效 4 小时，网盘地址可能提前到期；到期后请重新获取，请保密。系统未注册播放器协议时，请复制到播放器的网络串流中。</p></>}{message && <p role="status" className="text-xs text-accent mt-2">{message}</p>}</div>;
}
