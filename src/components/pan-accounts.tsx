'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
import { useFocusTrap } from './use-focus-trap';
import type { PanProvider, PanSource } from '@/lib/netdisk-types';
export const panNames = { quark: '夸克', aliyun: '阿里云盘' };
export class PanRequestError extends Error { constructor(message: string, public code?: string) { super(message); } }
export async function panRequest<T>(provider: PanProvider, body?: object): Promise<T> {
  const res = await fetch(provider === 'aliyun' ? '/api/alipan' : '/api/netdisk', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const value = await res.json().catch(() => ({ error: '网络连接异常，请重试' }));
  if (res.status === 401) window.dispatchEvent(new CustomEvent('libretv:unauthorized'));
  if (!res.ok) throw new PanRequestError(value.error || '网盘请求失败', value.code); return value;
}
interface Status { autoCleanup?: boolean; connected: boolean; configured: boolean; name?: string; sources?: PanSource[] }
export function usePanAccounts() {
  const { verified } = useAuth(); const [accounts, setAccounts] = useState<Partial<Record<PanProvider, Status>>>({});
  const [provider, setProvider] = useState<PanProvider | null>(null), [qr, setQr] = useState<{ id: string; qr: string; expires: number } | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false); const run = useRef(0);
  const refresh = useCallback(async (p: PanProvider) => { const s = await panRequest<Status>(p); setAccounts((old) => ({ ...old, [p]: s })); return s; }, []);
  useEffect(() => { if (verified) { void refresh('quark').catch(() => {}); void refresh('aliyun').catch(() => {}); } }, [verified, refresh]);
  const close = useCallback(() => { run.current++; setProvider(null); setQr(null); setLoading(false); setError(''); }, []);
  const login = useCallback(async (p: PanProvider) => { const seq = ++run.current; setProvider(p); setQr(null); setError(''); setLoading(true); try { const value = await panRequest<{ id: string; qr: string; expires: number }>(p, { action: 'login' }); if (run.current === seq) setQr(value); } catch (e) { if (run.current === seq) setError((e as Error).message); } finally { if (run.current === seq) setLoading(false); } }, []);
  useEffect(() => {
    if (!provider || !qr) return; let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped) return; if (Date.now() >= qr.expires) { setError('二维码已过期，请刷新'); return; }
      if (document.visibilityState === 'visible') try { const value = await panRequest<{ connected: boolean; expired?: boolean }>(provider, { action: 'poll', id: qr.id }); if (stopped) return; if (value.connected) { await refresh(provider); close(); return; } if (value.expired) { setError('二维码已过期，请刷新'); return; } setError(''); } catch (e) { if (!stopped) setError((e as Error).message); }
      if (!stopped) timer = setTimeout(poll, 2500);
    }; timer = setTimeout(poll, 1500); return () => { stopped = true; clearTimeout(timer); };
  }, [provider, qr, refresh, close]);
  const disconnect = async (p: PanProvider) => { try { await panRequest(p, { action: 'disconnect' }); await refresh(p); return true; } catch (e) { setError((e as Error).message); return false; } };
  const cleanupPreference = async (p: PanProvider, enabled: boolean) => { try { await panRequest(p, { action: 'cleanupPreference', enabled }); await refresh(p); } catch (e) { setError((e as Error).message); } };
  return { verified, accounts, provider, qr, error, loading, login, close, disconnect, refresh, cleanupPreference };
}
export function PanLoginDialog({ state }: { state: ReturnType<typeof usePanAccounts> }) {
  const { provider, close } = state;
  const ref = useRef<HTMLDivElement>(null); useFocusTrap(Boolean(state.provider), ref);
  useEffect(() => { if (!provider) return; const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [provider, close]);
  if (!state.provider) return null;
  return <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-5" onClick={(e) => { if (e.target === e.currentTarget) state.close(); }}><div ref={ref} role="dialog" aria-modal="true" aria-label={`连接${panNames[state.provider]}`} tabIndex={-1} className="bg-surface-raised border border-line rounded-2xl p-6 w-full max-w-sm outline-none"><div className="flex justify-between gap-3 mb-3"><h2 className="text-lg font-medium">连接{panNames[state.provider]}</h2><button className="btn-ghost btn-sm" onClick={state.close} aria-label="关闭扫码">关闭</button></div><p className="text-sm text-muted leading-6 mb-5">用{panNames[state.provider]} App 扫码并确认登录，网页会自动连接。</p>{state.loading ? <div className="h-[260px] grid place-content-center text-muted" role="status">正在生成二维码…</div> : state.qr && <img src={state.qr.qr} alt={`${panNames[state.provider]}登录二维码`} width={260} height={260} className="mx-auto rounded-lg" />}{/* eslint-disable-line @next/next/no-img-element */}<p role="status" className="text-sm text-center text-warning mt-4">{state.error || '等待扫码确认'}</p><button className="btn-ghost w-full mt-4" disabled={state.loading} onClick={() => void state.login(state.provider!)}>刷新二维码</button>{state.accounts[state.provider]?.connected && <div className="mt-4 border-t border-line pt-4"><label className="flex gap-2 items-start text-sm"><input type="checkbox" className="mt-1" checked={Boolean(state.accounts[state.provider]?.autoCleanup)} onChange={(e) => void state.cleanupPreference(state.provider!, e.target.checked)} />追剧专用，空间不足自动清理</label><p className="text-xs text-faint leading-5 mt-2">旧资源与回收站会被彻底清理，本站正在播放的文件保留。换账号或重新连接后默认关闭。</p></div>}{state.accounts[state.provider]?.connected && <button className="btn-ghost w-full mt-2 text-danger" onClick={async () => { if (window.confirm('断开本站的网盘连接？网盘文件会保留。') && await state.disconnect(state.provider!)) state.close(); }}>断开这个账号</button>}<p className="text-xs text-faint leading-5 mt-4">海清和静静共用连接。登录直接请求官方网盘，凭证加密保存在你们的服务器。</p></div></div>;
}
