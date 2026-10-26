'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from './header';
import { NetdiskPlayer, preloadPanPlayer } from './netdisk-player';
import { PanLoginDialog, PanRequestError, panNames, panRequest, usePanAccounts } from './pan-accounts';
import { chooseFullQuality, lowerFullQuality } from '@/lib/pan-player-utils';
import { resourceDisplayTitle } from './pan-resource-card';
import type { PanFile, PanListing, PanPlayback, PanProvider, PanQuality } from '@/lib/netdisk-types';
import { parsePanShare } from '@/lib/netdisk-utils';
import s from '@/app/pan/pan.module.css';

export function PanWatchRoom() {
  const params = useSearchParams(), accounts = usePanAccounts();
  const provider: PanProvider = params.get('provider') === 'aliyun' ? 'aliyun' : 'quark';
  const personal = provider === 'aliyun' && params.get('personal') === '1';
  const raw = personal ? '' : params.get('url') || '', passcode = params.get('passcode') || '';
  const title = personal ? '我的阿里云盘' : resourceDisplayTitle(params.get('title') || '分享资源');
  const [listing, setListing] = useState<PanListing | null>(null), [folders, setFolders] = useState<{ key: string; name: string }[]>([]);
  const [selected, setSelected] = useState<PanFile | null>(null), [playing, setPlaying] = useState<(PanPlayback & { file: PanFile; quality: PanQuality; saveMode: boolean }) | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [hint, setHint] = useState(''), [autoSmooth, setAutoSmooth] = useState(true);
  const [markers, setMarkers] = useState<string[]>(['']); const listRun = useRef(0), playRun = useRef(0), initial = useRef(false);
  useEffect(() => { if (!accounts.verified) return; const timer = setTimeout(preloadPanPlayer, 300); return () => clearTimeout(timer); }, [accounts.verified]);
  const load = useCallback(async (path: typeof folders = [], page = 1, marker = '') => {
    const seq = ++listRun.current; setBusy(true); setError('');
    try { if (!personal && parsePanShare(raw, passcode).provider !== provider) throw new Error('分享类型与选择的网盘不一致');
      const value = await panRequest<PanListing>(provider, { action: 'list', shareUrl: raw, passcode, parentKey: path.at(-1)?.key || '', page, marker });
      if (seq !== listRun.current) return; setListing({ ...value, page }); setFolders(path); const playable = value.items.filter((v) => !v.folder); if (playable.length === 1) setSelected(playable[0]); if (page === 1) setMarkers(['']);
    } catch (e) { if (seq === listRun.current) setError((e as Error).message); }
    finally { if (seq === listRun.current) setBusy(false); }
  }, [personal, provider, raw, passcode]);
  useEffect(() => { if (accounts.verified && !initial.current && (!personal || accounts.accounts.aliyun?.connected)) { initial.current = true; void load(); } }, [accounts.verified, accounts.accounts.aliyun?.connected, personal, load]);
  useEffect(() => () => { listRun.current++; playRun.current++; }, []);
  const play = async (file: PanFile, refresh = false) => {
    if (!accounts.accounts[provider]?.connected) { void accounts.login(provider); return; }
    const seq = ++playRun.current; setBusy(true); setError(''); setSelected(file); setHint(''); const replaceLease = !refresh && playing?.file.identity !== file.identity ? playing?.lease : undefined; if (!refresh && playing?.file.identity !== file.identity) setPlaying(null);
    try { const value = await panRequest<PanPlayback>(provider, { action: 'play', key: file.key, saveConsent: true, replaceLease }); const quality = chooseFullQuality(value.qualities); if (!quality) throw new Error('网盘没有返回完整播放线路，请换一个资源'); if (seq === playRun.current) { setPlaying({ ...value, qualities: value.qualities.filter((q) => !q.limited), file, quality, saveMode: true }); if (value.cleaned) setHint(`已清理 ${value.cleaned} 项旧资源，正在播放新影片`); } }
    catch (e) { if (seq === playRun.current) { setError((e as Error).message); if (e instanceof PanRequestError && e.code === 'LOGIN_REQUIRED') { void accounts.refresh(provider); void accounts.login(provider); } } }
    finally { if (seq === playRun.current) setBusy(false); }
  };
  const choose = (file: PanFile) => { setSelected(file); setError(''); };
  const videos = listing?.items.filter((v) => !v.folder) || [];
  const currentIndex = playing ? videos.findIndex((v) => v.identity === playing.file.identity) : -1;
  const next = currentIndex >= 0 ? videos[currentIndex + 1] : undefined;
  let external = ''; try { if (raw) external = parsePanShare(raw, passcode).url; } catch { /* validated on load */ }
  return <div className="min-h-screen"><Header /><main className={s.shell}>
    <div className={s.roomHeader}><Link className={s.back} href={'/pan?' + new URLSearchParams({ q: params.get('q') || '', provider })}>← 返回云端片库</Link><button className="btn-ghost btn-sm" disabled={!accounts.verified} onClick={() => void accounts.login(provider)}>{panNames[provider]} · {accounts.accounts[provider]?.connected ? '已连接' : '扫码连接'}</button></div>
    <p className={s.eyebrow}>JJBITV / 私人放映室</p><h1 className={s.roomTitle}>{title}</h1>
    <div className={s.roomGrid}><div className={s.stage}>
      {error && <div role="alert" className={s.notice + ' mb-5'}>{error}</div>}
      {playing ? <><div className={s.qualityRow}><span className="text-xs text-muted mr-2">播放画质</span>{playing.qualities.map((q) => <button key={q.url} className={q.url === playing.quality.url ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setPlaying({ ...playing, quality: q, limited: q.limited ?? playing.limited, duration: q.duration ?? (q.limited ? undefined : playing.duration) })}>{q.label}</button>)}</div><NetdiskPlayer key={playing.file.identity + ':' + playing.saveMode} title={playing.file.name} quality={playing.quality} identity={playing.file.identity + (playing.limited ? ':preview' : '')} saved={playing.saved} limited={playing.limited} provider={provider} notice={playing.notice} lease={playing.lease} nextRequiresSave={playing.saveMode} onRefresh={() => void play(playing.file, true)} onStall={() => { if (!autoSmooth) return false; const lower = lowerFullQuality(playing.qualities, playing.quality); if (!lower) return false; setHint(`缓冲较慢，已切换至 ${lower.label}`); setPlaying({ ...playing, quality: lower }); return true; }} onNext={next ? () => void play(next) : undefined} />
        {playing.limited && <div role="status" className={s.notice + ' mt-5'}>当前线路为限时试看{playing.duration ? `，实际可播约 ${Math.floor(playing.duration / 60)} 分 ${playing.duration % 60} 秒` : ''}。原视频时长不代表试看时长；已转存文件会保留，试看不会触发再次转存。</div>}
        {playing.original && <div className={s.details}><div>原文件<strong>{playing.original.width && playing.original.height ? `${playing.original.width} × ${playing.original.height}` : '画质待读取'}</strong></div><div>文件大小<strong>{((playing.original.size || playing.file.size) / 1024 ** 3).toFixed(2)} GB</strong></div><div>当前线路<strong>{playing.quality.width && playing.quality.height ? `${playing.quality.width} × ${playing.quality.height}` : playing.quality.label}</strong></div></div>}
      </> : <div className={s.placeholder}><span className={s.playIcon}>▷</span><h2>{selected ? selected.name : '选好一集，今晚就从这里开始。'}</h2><p>{personal && !accounts.accounts.aliyun?.connected ? '连接阿里云盘后，就能浏览自己的视频。' : '在分集目录中选好视频，点击播放。播放器会一直留在这里。'}</p>{personal && !accounts.accounts.aliyun?.connected && <button className="btn-primary mt-5" onClick={() => void accounts.login('aliyun')}>连接阿里云盘</button>}</div>}
      {selected && <section className="mt-5"><div className="flex justify-between gap-4 text-sm"><span className="truncate">已选：{selected.name}</span><span className="text-muted shrink-0">{(selected.size / 1024 ** 3).toFixed(2)} GB</span></div><div className={s.actions}><button className="btn-primary px-8 py-3" disabled={busy} onClick={() => void play(selected)}>{busy ? '检查空间并准备中…' : '播放'}</button><label className="text-xs text-muted flex items-center gap-2"><input type="checkbox" checked={autoSmooth} onChange={(e) => setAutoSmooth(e.target.checked)} />自动流畅</label></div><p className="text-xs text-faint leading-6">{personal ? '播放网盘中已有的文件。' : '播放时自动转存并复用已有文件。'}{accounts.accounts[provider]?.autoCleanup ? '空间不足会清理旧资源与回收站，本站正在播放的文件保留。' : ''}</p>{hint && <p role="status" className="mt-3 text-xs text-accent">{hint}</p>}</section>}
      {external && <a className="btn-ghost mt-6" href={external} target="_blank" rel="noopener noreferrer">在{panNames[provider]}官方页面打开 ↗</a>}
    </div><aside className={s.sidebar} aria-label="分集目录"><div className={s.sidebarHead}><div className="flex justify-between gap-3"><h2 className="text-sm font-medium">分集目录</h2><span className="text-xs text-faint">{listing?.items.filter((v) => !v.folder).length || 0} 个视频</span></div><nav className={s.breadcrumb} aria-label="分享目录路径"><button disabled={busy} onClick={() => void load()}>根目录</button>{folders.map((f, i) => <button key={f.key} disabled={busy} onClick={() => void load(folders.slice(0, i + 1))} title={f.name}>/ {f.name}</button>)}</nav></div><div className={s.episodes}>
      {busy && !listing && <p className="text-sm text-muted p-5" role="status">正在读取目录…</p>}{listing?.items.map((file) => <button key={file.key} className={s.episode + (selected?.identity === file.identity ? ' ' + s.episodeActive : '')} disabled={busy} onClick={() => file.folder ? void load([...folders, { key: file.key, name: file.name }]) : choose(file)} title={file.name}><span className="text-accent text-base shrink-0" aria-hidden="true">{file.folder ? '▣' : selected?.identity === file.identity ? '▶' : '▷'}</span><span className="min-w-0"><span className={s.episodeName}>{file.name}</span><span className={s.episodeMeta}>{file.folder ? '打开文件夹' : `${(file.size / 1024 ** 3).toFixed(2)} GB · 选择播放`}</span></span></button>)}{listing && !listing.items.length && <p className="p-5 text-sm text-muted">当前目录没有视频或子文件夹。</p>}</div>
      {listing && (listing.page > 1 || listing.hasMore) && <div className="flex justify-between gap-2 p-4 border-t border-line">{listing.page > 1 && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void load(folders, listing.page - 1, markers[listing.page - 2])}>上一页</button>}{listing.hasMore && <button className="btn-ghost btn-sm ml-auto" disabled={busy} onClick={() => { setMarkers((old) => [...old.slice(0, listing.page), listing.marker || '']); void load(folders, listing.page + 1, listing.marker || ''); }}>下一页</button>}</div>}
    </aside></div>
    </main><PanLoginDialog state={accounts} />

  </div>;
}
