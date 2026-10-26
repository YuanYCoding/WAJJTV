'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { useAuth } from '@/components/auth';
import { NetdiskPlayer } from '@/components/netdisk-player';
import { useFocusTrap } from '@/components/use-focus-trap';
import type { PanFile, PanListing, PanQuality, PanPlayback, PanResult, PanSearchEvent, PanStatus } from '@/lib/netdisk-types';
import { parseQuarkShare } from '@/lib/netdisk-utils';

class RequestError extends Error { constructor(message: string, public code?: string) { super(message); } }
async function call<T>(body?: object): Promise<T> {
  const res = await fetch('/api/netdisk', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const value = await res.json().catch(() => ({ error: '网络连接异常，请重试' }));
  if (res.status === 401) window.dispatchEvent(new CustomEvent('libretv:unauthorized'));
  if (!res.ok) throw new RequestError(value.error || '网盘请求失败', value.code);
  return value;
}
export default function NetdiskPage() { return <Suspense><Content /></Suspense>; }
function Content() {
  const params = useSearchParams(); const { verified } = useAuth();
  const [keyword, setKeyword] = useState(params.get('q') || ''); const [searched, setSearched] = useState('');
  const [status, setStatus] = useState<PanStatus | null>(null); const [rows, setRows] = useState<PanResult[]>([]);
  const [searching, setSearching] = useState(false); const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const [link, setLink] = useState(''); const [passcode, setPasscode] = useState('');
  const [active, setActive] = useState<{ title: string; url: string; passcode: string } | null>(null);
  const [folders, setFolders] = useState<{ key: string; name: string }[]>([]); const [listing, setListing] = useState<PanListing | null>(null);
  const [playing, setPlaying] = useState<(PanPlayback & { file: PanFile; quality: PanQuality }) | null>(null);
  const [qr, setQr] = useState<{ id: string; expires: number; qr: string } | null>(null);
  const [qrError, setQrError] = useState(''); const [qrLoading, setQrLoading] = useState(false);
  const [qrOpen, setQrOpen] = useState(false); const qrRun = useRef(0);
  const searchAbort = useRef<AbortController | null>(null); const searchRun = useRef(0);
  const dialog = useRef<HTMLDivElement>(null); useFocusTrap(qrOpen, dialog);
  const refreshStatus = async () => { const value = await call<PanStatus>(); setStatus(value); return value; };
  useEffect(() => { if (verified) void refreshStatus().catch((e) => setError(e.message)); }, [verified]);
  useEffect(() => () => { searchAbort.current?.abort(); searchRun.current++; }, []);
  const login = async () => {
    const run = ++qrRun.current; setQrOpen(true); setQr(null); setQrLoading(true); setQrError('');
    try { const value = await call<{ id: string; expires: number; qr: string }>({ action: 'login' }); if (run === qrRun.current) setQr(value); }
    catch (e) { if (run === qrRun.current) setQrError((e as Error).message); }
    finally { if (run === qrRun.current) setQrLoading(false); }
  };
  const closeQr = () => { qrRun.current++; setQrOpen(false); setQr(null); setQrLoading(false); };
  useEffect(() => {
    if (!qr || !qrOpen) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped) return;
      if (Date.now() > qr.expires) { setQrError('二维码已过期，请刷新'); return; }
      if (document.visibilityState === 'visible') {
        try {
          const value = await call<{ connected: boolean; expired?: boolean }>({ action: 'poll', id: qr.id });
          if (stopped) return;
          if (value.connected) { setQr(null); setQrOpen(false); await refreshStatus(); return; }
          if (value.expired) { setQrError('二维码已过期，请刷新'); return; }
        } catch (e) { if (!stopped) setQrError((e as Error).message); }
      }
      if (!stopped) timer = setTimeout(poll, 2200);
    };
    timer = setTimeout(poll, 1500);
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') closeQr(); };
    window.addEventListener('keydown', escape);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('keydown', escape); };
  }, [qr, qrOpen]);
  const search = async (raw: string, latest = false) => {
    const word = raw.trim().slice(0, 60); if (!word && !latest) return;
    const run = ++searchRun.current; searchAbort.current?.abort(); const controller = new AbortController(); searchAbort.current = controller;
    setSearched(latest ? '最近更新' : word); setSearching(true); setRows([]); setFailures([]); setError('');
    try {
      const res = await fetch('/api/netdisk/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: word, mode: latest ? 'latest' : 'search' }), signal: controller.signal });
      if (!res.ok || !res.body) throw new Error('网盘搜索暂时不可用，请重试');
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      const consume = (line: string) => {
        if (!line.trim() || run !== searchRun.current) return;
        const event = JSON.parse(line) as PanSearchEvent;
        if (event.type === 'results') {
          if (event.error) setFailures((old) => [...old, `${status?.sources.find((s) => s.id === event.source)?.name || event.source}：${event.error}`]);
          if (event.list.length) setRows((old) => [...old, ...event.list.filter((v) => !old.some((x) => x.shareUrl === v.shareUrl))]);
        }
      };
      for (;;) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let i: number; while ((i = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } }
      consume(buffer + decoder.decode());
    } catch (e) { if (!controller.signal.aborted && run === searchRun.current) setError((e as Error).message); }
    finally { if (run === searchRun.current) setSearching(false); }
  };
  const openedInitial = useRef(false);
  useEffect(() => { if (verified && status && !openedInitial.current) { openedInitial.current = true; void search(params.get('q') || '', !params.get('q')); } }, [verified, status, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const openShare = async (selected: { title: string; url: string; passcode: string }, nextFolders: typeof folders = [], page = 1) => {
    setBusy('list'); setError('');
    try {
      const value = await call<PanListing>({ action: 'list', shareUrl: selected.url, passcode: selected.passcode, parentKey: nextFolders.at(-1)?.key || '', page });
      setActive(selected); setFolders(nextFolders); setListing(value);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };
  const play = async (file: PanFile, save = false, refreshing = false) => {
    if (!status?.connected) { void login(); return; }
    if (save && !refreshing && !window.confirm(`将「${file.name}」这一集转存到「JjBiTV 追剧」后播放？\n约 ${(file.size / 1024 ** 3).toFixed(2)} GB，会占用网盘空间；不会转存整个资源目录，已转存的这一集会复用。`)) return;
    setBusy(file.key); setError('');
    try { const value = await call<PanPlayback>({ action: save ? 'play' : 'preview', key: file.key, ...(save ? { saveConsent: true } : {}) }); setPlaying({ ...value, file, quality: value.qualities[0] }); }
    catch (e) { setError((e as Error).message); if ((e as RequestError).code === 'LOGIN_REQUIRED') { void refreshStatus(); void login(); } }
    finally { setBusy(''); }
  };
  const files = listing?.items.filter((f) => !f.folder) || [];
  const playingIndex = playing ? files.findIndex((f) => f.identity === playing.file.identity) : -1;
  const next = playingIndex >= 0 ? files[playingIndex + 1] : undefined;
  return <div className="min-h-screen flex flex-col"><Header />
    <main className="cinema-shell mx-auto w-full flex-1 py-7 pb-24">
      <div className="flex flex-wrap justify-between gap-4 items-start mb-7"><div><p className="text-xs tracking-widest text-accent mb-2">JJBITV · 网盘追剧</p><h1 className="text-2xl sm:text-3xl font-semibold">把高清片源，留给今晚。</h1><p className="text-sm text-muted mt-3">搜索分享资源，选好剧集，用自己的夸克账号播放。</p></div>
        <div className="flex items-center gap-2"><span className="text-xs text-muted">{status?.connected ? `已连接 · ${status.name}` : '夸克未连接'}</span><button className="btn-primary btn-sm" disabled={qrLoading || !verified || status?.configured === false} onClick={() => void login()}>{status?.connected ? '更换账号' : '夸克扫码连接'}</button>{status?.connected && <button className="btn-ghost btn-sm" onClick={async () => { if (!window.confirm('删除本站保存的夸克登录信息？网盘中的文件会保留。')) return; try { await call({ action: 'disconnect' }); setPlaying(null); await refreshStatus(); } catch (e) { setError((e as Error).message); } }}>断开</button>}</div>
      </div>
      <form className="flex gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); void search(keyword); }}><input className="input flex-1 min-w-0" aria-label="搜索网盘影片" placeholder="输入电影、剧名，例如：唐朝诡事录" maxLength={60} value={keyword} onChange={(e) => setKeyword(e.target.value)} /><button className="btn-primary shrink-0" disabled={!verified || !keyword.trim()}>搜网盘</button></form>
      <p className="text-xs text-faint mb-6">{status?.sources.map((s) => s.name).join(' · ') || '正在读取来源…'} · 搜索结果逐步显示；资源标注不等于实测画质。</p>
      <details className="rounded-lg border border-line p-4 mb-6"><summary className="cursor-pointer text-sm text-muted">已有夸克分享链接？直接打开</summary><form className="flex flex-wrap gap-2 mt-4" onSubmit={(e) => { e.preventDefault(); try { const parsed = parseQuarkShare(link, passcode); void openShare({ title: '夸克分享', url: parsed.url, passcode: parsed.passcode }); } catch (e) { setError((e as Error).message); } }}><input className="input flex-1 min-w-[180px]" aria-label="夸克分享链接" placeholder="粘贴分享链接或分享文字" value={link} onChange={(e) => setLink(e.target.value)} /><input className="input w-28" aria-label="提取码" placeholder="提取码（选填）" value={passcode} maxLength={8} onChange={(e) => setPasscode(e.target.value)} /><button className="btn-ghost" disabled={Boolean(busy) || !link.trim()}>打开目录</button></form></details>
      {error && <p role="alert" className="p-3 mb-5 text-sm text-warning bg-chip rounded-lg">{error}</p>}
      {qrError && !qr && <p role="alert" className="text-warning text-sm mb-4">{qrError}</p>}
      {active && listing && <section className="border border-line bg-surface-raised rounded-xl p-4 sm:p-5 mb-7">
        <div className="flex items-start justify-between gap-2 mb-3"><div><h2 className="font-medium break-all">{active.title}</h2><p className="text-xs text-faint mt-2 leading-5">「免转存试看」不占空间，时长由夸克限制；「转存后播放」只保存你选中的一集，已转存的会复用，不会保存整个资源目录。</p></div><button className="btn-ghost btn-sm shrink-0" onClick={() => { setActive(null); setListing(null); setPlaying(null); }}>收起目录</button></div>
        <nav aria-label="分享目录路径" className="flex flex-wrap gap-1 mb-3"><button className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void openShare(active)}>根目录</button>{folders.map((f, i) => <button className="btn-ghost btn-sm max-w-full truncate" key={f.key} disabled={Boolean(busy)} onClick={() => void openShare(active, folders.slice(0, i + 1))}>/ {f.name}</button>)}</nav>
        <div className="grid gap-2 sm:grid-cols-2">{listing.items.map((file) => file.folder ? <button key={file.key} className="text-left min-w-0 rounded-lg border border-line p-3 hover:border-accent focus-visible:outline-accent" disabled={Boolean(busy)} onClick={() => void openShare(active, [...folders, { key: file.key, name: file.name }])}><span className="block break-all text-sm">📁 {file.name}</span><span className="block text-xs text-faint mt-1">打开文件夹</span></button> : <div key={file.key} className="min-w-0 rounded-lg border border-line p-3"><span className="block break-all text-sm">{file.name}</span><span className="block text-xs text-faint mt-1">{(file.size / 1024 ** 3).toFixed(2)} GB{busy === file.key ? ' · 正在准备…' : ''}</span><div className="flex flex-wrap gap-2 mt-3"><button className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void play(file)}>免转存试看</button><button className="btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => void play(file, true)}>转存后播放</button></div></div>)}</div>
        {!listing.items.length && <p className="text-muted text-sm py-5">当前页没有视频或子目录。</p>}
        <div className="flex gap-2 mt-3">{listing.page > 1 && <button className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void openShare(active, folders, listing.page - 1)}>上一页</button>}{listing.hasMore && <button className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void openShare(active, folders, listing.page + 1)}>下一页</button>}<a href={active.url} className="btn-ghost btn-sm" target="_blank" rel="noopener noreferrer">在夸克中打开 ↗</a></div>
        {playing && <>{!playing.saved && <p role="status" className="mt-4 rounded-lg bg-chip p-3 text-sm text-warning">当前为免转存试看{playing.duration ? `，实际可播约 ${Math.floor(playing.duration / 60)} 分 ${playing.duration % 60} 秒` : '，可播时长由夸克限制'}{playing.sourceDuration ? `（原视频约 ${Math.ceil(playing.sourceDuration / 60)} 分钟）` : ''}。试看不会保存文件，也不会自动转存。</p>}<div className="flex flex-wrap gap-2 mt-4">{playing.qualities.map((q) => <button key={q.url} className={q.url === playing.quality.url ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setPlaying({ ...playing, quality: q })}>{q.label}</button>)}</div><NetdiskPlayer key={playing.file.key + ':' + playing.saved} title={playing.file.name} quality={playing.quality} identity={playing.file.identity + (playing.saved ? '' : ':preview')} saved={playing.saved} limited={playing.limited} onRefresh={() => void play(playing.file, playing.saved, true)} onNext={next && playing.saved ? (automatic) => void play(next, true, automatic) : undefined} /></>}
      </section>}
      <div aria-live="polite" className="text-sm text-muted mb-3">{searching ? `正在搜索，已找到 ${rows.length} 个分享…` : searched ? `“${searched}” · ${rows.length} 个分享` : '从搜一部想看的影片开始。'}</div>
      {failures.length > 0 && <details className="text-xs text-faint mb-4"><summary className="cursor-pointer">{failures.length} 个来源暂未完成，其他结果可继续使用</summary>{failures.map((f) => <p key={f} className="mt-1">{f}</p>)}</details>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map((row) => <article className="rounded-xl border border-line bg-surface-raised p-4 min-w-0" key={row.id}><div className="flex justify-between gap-2 text-xs text-faint"><span>{row.sourceName}</span><span className="text-accent">{row.qualityHint}</span></div><h2 className="my-3 text-sm leading-6 font-medium break-words">{row.title}</h2><button className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void openShare({ title: row.title, url: row.shareUrl, passcode: row.passcode })}>查看剧集 / 检测分享</button><span className="text-[11px] text-faint ml-2">打开时验证</span></article>)}</div>
      {!searching && searched && !rows.length && <p className="py-8 text-sm text-muted">没有找到可展示的夸克分享。可以缩短片名重试，或粘贴自己的分享链接。</p>}
      <p className="text-xs text-faint leading-6 mt-7">普通夸克账号可以连接；原画播放的速度、容量和格式支持以实际账号及浏览器为准。本站不提供会员权益解锁。</p>
    </main><SiteFooter />
    {qrOpen && <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-5" onClick={(e) => { if (e.target === e.currentTarget) closeQr(); }}><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="连接夸克网盘" className="bg-surface-raised border border-line rounded-xl p-5 w-full max-w-sm outline-none"><div className="flex justify-between items-center mb-3"><h2 className="font-semibold">用夸克 App 扫码</h2><button className="btn-ghost btn-sm" aria-label="关闭扫码" onClick={closeQr}>关闭</button></div><p className="text-xs text-muted mb-4 leading-6">扫码后在手机确认登录，网页会自动完成连接。海清和静静共用这个网盘账号，登录信息仅保存在服务器。</p>{qrLoading ? <p role="status" className="py-16 text-center">正在生成二维码…</p> : qr && <img src={qr.qr} alt="夸克登录二维码" width={260} height={260} className="rounded-lg mx-auto" />}{/* eslint-disable-line @next/next/no-img-element */}<p role="status" className="text-xs text-muted mt-3 text-center">{qrError || '二维码 2 分钟内有效，扫码后请稍候'}</p><button className="btn-ghost btn-sm mt-4 w-full" disabled={qrLoading} onClick={() => void login()}>刷新二维码</button></div></div>}
  </div>;
}
