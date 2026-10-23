'use client';
import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { useAuth } from '@/components/auth';
import { useToast } from '@/components/toast';
import { ViewingControls } from '@/components/viewing-controls';
const PlayerShell = dynamic(() => import('@/components/player-shell').then((m) => m.PlayerShell), { ssr: false });
interface CloudStatus { configured: boolean; connected: boolean; name?: string; drives?: { id: string; name: string }[] }
interface CloudFile { id: string; name: string; folder: boolean; size: number }
interface Quality { label: string; width: number; height: number; url: string }
async function request<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await response.json().catch(() => ({ error: '网络连接异常，请重试' }));
  if (response.status === 401) window.dispatchEvent(new CustomEvent('libretv:unauthorized'));
  if (!response.ok) throw new Error(data.error || '请求失败，请重试');
  return data;
}
export default function CloudPage() {
  const { verified } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const [login, setLogin] = useState<{ id: string; qr: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedDrive, setSelectedDrive] = useState('');
  const [folders, setFolders] = useState([{ id: 'root', name: '全部视频' }]);
  const [marker, setMarker] = useState('');
  const [previous, setPrevious] = useState<CloudFile[]>([]);
  const [playing, setPlaying] = useState<{ file: CloudFile; qualities: Quality[]; index: number } | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const status = useQuery({ queryKey: ['cloud-status'], queryFn: () => request<CloudStatus>('/api/cloud'), enabled: verified, retry: false, staleTime: 30_000 });
  const drive = selectedDrive || status.data?.drives?.[0]?.id || '';
  const folder = folders[folders.length - 1].id;
  const files = useQuery({ queryKey: ['cloud-files', drive, folder, marker], queryFn: () => request<{ items: CloudFile[]; marker: string }>(`/api/cloud?action=files&drive=${encodeURIComponent(drive)}&folder=${encodeURIComponent(folder)}&marker=${encodeURIComponent(marker)}`), enabled: verified && Boolean(status.data?.connected && drive), retry: false, staleTime: 60_000 });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试'); } finally { setBusy(false); }
  };
  const resetFolder = () => { setMarker(''); setPrevious([]); };
  const begin = () => run(async () => { setLogin(await request('/api/cloud', { action: 'login' })); });
  const finish = () => run(async () => {
    await request('/api/cloud', { action: 'finish', id: login?.id });
    setLogin(null); setSelectedDrive(''); setFolders([{ id: 'root', name: '全部视频' }]); resetFolder(); setPlaying(null);
    client.removeQueries({ queryKey: ['cloud-files'] }); await status.refetch(); toast('阿里云盘已连接', 'success');
  });
  const disconnect = () => {
    if (!window.confirm('断开后会删除本站保存的网盘授权信息。确定断开吗？')) return;
    void run(async () => { await request('/api/cloud', { action: 'disconnect' }); setPlaying(null); setLogin(null); setPrevious([]); client.removeQueries({ queryKey: ['cloud-files'] }); await status.refetch(); });
  };
  const play = (file: CloudFile) => run(async () => {
    const result = await request<{ qualities: Quality[] }>('/api/cloud', { action: 'play', drive, file: file.id });
    setPlaying({ file, qualities: result.qualities, index: 0 });
  });
  const entries = [...previous, ...(files.data?.items || [])].filter((item, i, arr) => arr.findIndex((v) => v.id === item.id) === i);
  return <div className="min-h-screen flex flex-col"><Header />
    <main className="cinema-shell mx-auto w-full flex-1 py-8">
      <p className="text-accent text-xs tracking-widest mb-3">WAJJTV · 私人影库</p>
      <h1 className="text-2xl sm:text-3xl font-semibold">我们的阿里云盘</h1>
      <p className="text-muted text-sm mt-3 mb-6">把珍藏的影片放在一起，今晚慢慢看。</p>
      {(error || status.error || files.error) && <p role="alert" className="p-3 mb-4 rounded-lg border border-warning text-warning text-sm">{error || status.error?.message || files.error?.message}<button className="btn-ghost btn-sm ml-2" onClick={() => { setError(''); void status.refetch(); if (drive) void files.refetch(); }}>重试</button></p>}
      {status.isLoading && <p role="status">正在检查网盘连接…</p>}
      {status.data?.configured === false && <p className="text-muted">网盘连接功能正在准备中。</p>}
      {verified && status.data?.configured && !status.data.connected && <section className="bg-surface-raised border border-line rounded-xl p-5 sm:p-7 max-w-2xl">
        <h2 className="text-lg font-medium">扫码连接阿里云盘</h2>
        <p className="text-sm text-muted leading-7 mt-3">通过 OpenList 授权服务连接，海清和静静共用此网盘。本站只调用浏览与播放接口，授权范围以阿里云盘确认页为准。</p>
        <p className="text-xs text-faint leading-6 mt-2">支持普通账号；清晰度、转码和速度由网盘实际提供。先把想看的视频保存在自己的网盘中。</p>
        {!login && <button className="btn-primary mt-5" disabled={busy} onClick={() => void begin()}>{busy ? '正在生成…' : '获取登录二维码'}</button>}
      </section>}
      {verified && login && <section className="mt-5 max-w-md bg-surface-raised rounded-xl border border-line p-5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={login.qr} width={220} height={220} className="bg-white mx-auto rounded-lg" alt="使用阿里云盘 App 扫码授权" referrerPolicy="no-referrer" />
        <p className="text-sm text-muted mt-4">用阿里云盘 App 扫码，并在手机上确认授权。</p>
        <div className="flex flex-wrap justify-center gap-2 mt-4"><button className="btn-primary" disabled={busy} onClick={() => void finish()}>{busy ? '正在确认…' : '我已扫码，完成连接'}</button><button className="btn-ghost" disabled={busy} onClick={() => void begin()}>刷新二维码</button><button className="btn-ghost" onClick={() => setLogin(null)}>收起</button></div>
      </section>}
      {verified && status.data?.connected && <>
        <div className="flex flex-wrap items-center gap-3 mb-5"><span className="text-sm text-accent">已连接 · {status.data.name}</span><button className="btn-ghost btn-sm" disabled={busy} onClick={() => void begin()}>重新扫码</button><button className="btn-ghost btn-sm" disabled={busy} onClick={disconnect}>断开连接</button></div>
        {playing && <section className="mb-6"><h2 className="font-medium mb-3 break-all">{playing.file.name}</h2><div ref={playerRef} className="aspect-video bg-black rounded-xl overflow-hidden"><PlayerShell key={playing.file.id} url={playing.qualities[playing.index].url} title={playing.file.name} adFilter={false} autoplayNext={false} /></div><ViewingControls playerRef={playerRef} /><div className="flex flex-wrap gap-2 mt-3">{playing.qualities.map((q, i) => <button key={q.label} className={i === playing.index ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setPlaying({ ...playing, index: i })}>{q.height ? `${q.height}P` : q.label}</button>)}<button className="btn-ghost btn-sm" disabled={busy} onClick={() => void play(playing.file)}>刷新播放地址</button><button className="btn-ghost btn-sm" onClick={() => setPlaying(null)}>关闭播放</button></div></section>}
        <div className="flex flex-wrap gap-2 mb-4">{status.data.drives?.map((d) => <button className={drive === d.id ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} key={d.id} onClick={() => { setSelectedDrive(d.id); setFolders([{ id: 'root', name: '全部视频' }]); resetFolder(); }}>{d.name}</button>)}</div>
        <nav className="flex flex-wrap gap-1 text-sm mb-4" aria-label="网盘路径">{folders.map((f, i) => <button className="btn-ghost btn-sm max-w-full truncate" key={f.id} onClick={() => { setFolders(folders.slice(0, i + 1)); resetFolder(); }}>{i ? ' / ' : ''}{f.name}</button>)}</nav>
        {files.isFetching && <p role="status" className="text-muted text-sm mb-3">正在读取目录…</p>}
        {!files.isFetching && !files.isError && entries.length === 0 && <p className="text-muted py-8">这个目录里还没有视频或文件夹。</p>}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{entries.map((file) => <button key={file.id} disabled={busy} className="p-4 text-left rounded-lg border border-line bg-surface-raised hover:border-accent focus-visible:outline-accent min-w-0" onClick={() => { if (file.folder) { setFolders([...folders, { id: file.id, name: file.name }]); resetFolder(); } else void play(file); }}><span className="text-accent text-xs">{file.folder ? '文件夹' : '视频'}</span><span className="block mt-1 text-sm break-all">{file.name}</span>{!file.folder && <span className="text-faint text-xs">{(file.size / 1024 / 1024).toFixed(0)} MB · 查看可用画质</span>}</button>)}</div>
        {files.data?.marker && <button className="btn-ghost mt-4" disabled={files.isFetching} onClick={() => { setPrevious(entries); setMarker(files.data!.marker); }}>加载更多</button>}
        <p className="text-xs text-faint mt-6 leading-6">网页仅显示视频与文件夹；视频转码未完成时，可以稍后重试。断开本站连接后，也可在阿里云盘 App 的授权管理中撤销 OpenList 授权。</p>
      </>}
    </main><SiteFooter />
  </div>;
}
