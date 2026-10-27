'use client';
import Link from 'next/link';
import { readPanSearchState, writePanSearchState, clearPanSearchState } from '@/lib/pan-search-state';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from './header';
import { SiteFooter } from './site-footer';
import { PanLoginDialog, panNames, usePanAccounts } from './pan-accounts';
import { parsePanShare } from '@/lib/netdisk-utils';
import type { PanProvider, PanResult, PanSearchEvent } from '@/lib/netdisk-types';
import s from '@/app/pan/pan.module.css';
import { PanDriveIcon, PanIcon, PanResourceCard, resourceDisplayTitle } from './pan-resource-card';

export function PanSearchPage() {
  const params = useSearchParams(), accounts = usePanAccounts();
  const refreshAccounts = accounts.refresh;
  const [keyword, setKeyword] = useState(params.get('q') || '');
  const [filter, setFilter] = useState<'all' | PanProvider>(params.get('provider') === 'aliyun' ? 'aliyun' : params.get('provider') === 'quark' ? 'quark' : 'all');
  const [rows, setRows] = useState<PanResult[]>([]), [busy, setBusy] = useState(false), [searched, setSearched] = useState('');
  const [error, setError] = useState(''), [failures, setFailures] = useState<string[]>([]), [page, setPage] = useState(1), [more, setMore] = useState(false);
  const [showLink, setShowLink] = useState(false), [link, setLink] = useState(''), [passcode, setPasscode] = useState(''), [prefer4k, setPrefer4k] = useState(false);
  const [rejected, setRejected] = useState(0), [unchecked, setUnchecked] = useState(0), [checking, setChecking] = useState(0);
  const snapshot = useRef<Parameters<typeof writePanSearchState>[0] | null>(null);
  const abort = useRef<AbortController | null>(null), run = useRef(0), initial = useRef(false);
  useEffect(() => { const changed = () => { abort.current?.abort(); run.current++; setBusy(false); setRows([]); setSearched(''); snapshot.current = null; clearPanSearchState(); void refreshAccounts('quark').catch(() => {}); }; window.addEventListener('resource-sources-changed', changed); return () => window.removeEventListener('resource-sources-changed', changed); }, [refreshAccounts]);
  const search = async (word: string, nextPage = 1, latest = false) => {
    const q = word.trim().slice(0, 60); if (!q && !latest) return;
    const seq = ++run.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const seen = new Set(nextPage > 1 ? rows.map((v) => v.shareUrl) : []); let added = 0, candidates = 0; const pending: PanResult[] = []; let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => { clearTimeout(flushTimer); flushTimer = undefined; if (!pending.length || seq !== run.current) return; const batch = pending.splice(0); startTransition(() => setRows((old) => seq === run.current ? [...old, ...batch] : old)); };
    setBusy(true); setError(''); setFailures([]); setSearched(latest ? '最近更新' : q); setPage(nextPage); if (nextPage === 1) { setRows([]); setRejected(0); setUnchecked(0); }
    const query = new URLSearchParams({ ...(latest ? {} : { q }), provider: filter }); window.history.replaceState(null, '', '/pan?' + query);
    try {
      const res = await fetch('/api/netdisk/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: q, mode: latest ? 'latest' : 'search', page: nextPage }), signal: controller.signal });
      if (res.status === 401) window.dispatchEvent(new CustomEvent('libretv:unauthorized'));
      if (!res.ok || !res.body) throw new Error('搜索暂时不可用，请重试');
      const reader = res.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      const consume = (line: string) => { if (!line.trim() || seq !== run.current) return; const event = JSON.parse(line) as PanSearchEvent;
        if (event.type === 'checking') setChecking(event.pending);
        if (event.type === 'done') { candidates = event.candidates || 0; setChecking(0); setRejected(event.rejected || 0); setUnchecked(event.unchecked || 0); }
        if (event.type === 'results') { if (event.error) setFailures((old) => [...new Set([...old, `${accounts.accounts.quark?.sources?.find((v) => v.id === event.source)?.name || event.source}：${event.error}`])]);
          const fresh = event.list.filter((v) => { if (seen.has(v.shareUrl)) return false; seen.add(v.shareUrl); return true; }); added += fresh.length; if (fresh.length) { pending.push(...fresh); if (!flushTimer) flushTimer = setTimeout(flush, 60); } }
      };
      for (;;) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let index: number; while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); } } consume(buffer + decoder.decode());
      if (seq === run.current) setMore((added > 0 || candidates > 0) && nextPage < 10);
    } catch (e) { if (!controller.signal.aborted && seq === run.current) setError((e as Error).message); }
    finally { flush(); clearTimeout(flushTimer); if (seq === run.current) setBusy(false); }
  };
  useEffect(() => { if (accounts.verified && !initial.current) {
    initial.current = true; const saved = readPanSearchState(params.get('q'));
    if (saved) { setKeyword(saved.keyword); setSearched(saved.searched); setFilter(saved.filter); setRows(saved.rows); setPage(saved.page); setMore(saved.more); setPrefer4k(saved.prefer4k); setRejected(saved.rejected || 0); setUnchecked(saved.unchecked || 0); requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, saved.scroll))); }
    else void search(keyword, 1, !keyword);
  } }, [accounts.verified]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { run.current++; abort.current?.abort(); initial.current = false; }, []);
  useEffect(() => {
    if (!initial.current || !searched) return;
    snapshot.current = { keyword, searched, filter, rows, page, more, prefer4k, rejected, unchecked, scroll: window.scrollY };
    writePanSearchState(snapshot.current);
  }, [keyword, searched, filter, rows, page, more, prefer4k, rejected, unchecked]);
  useEffect(() => { let timer: ReturnType<typeof setTimeout> | undefined; const save = () => { if (snapshot.current) writePanSearchState({ ...snapshot.current, scroll: window.scrollY }); }; const scroll = () => { clearTimeout(timer); timer = setTimeout(save, 150); }; window.addEventListener('pagehide', save); window.addEventListener('scroll', scroll, { passive: true }); return () => { clearTimeout(timer); window.removeEventListener('pagehide', save); window.removeEventListener('scroll', scroll); }; }, []);
  const rememberPosition = useCallback(() => { if (snapshot.current) writePanSearchState({ ...snapshot.current, scroll: window.scrollY }); }, []);
  const roomUrl = (row: { shareUrl: string; title?: string; passcode?: string; provider?: PanProvider }) => '/pan/watch?' + new URLSearchParams({ url: row.shareUrl, title: resourceDisplayTitle(row.title || '分享资源'), passcode: row.passcode || '', provider: row.provider || 'quark', q: searched === '最近更新' ? '' : searched, filter });
  const displayed = useMemo(() => { const list = filter === 'all' ? rows : rows.filter((v) => v.provider === filter); return prefer4k ? [...list].sort((a, b) => (b.qualityHint.includes('4K') ? 2 : b.qualityHint.includes('1080') ? 1 : 0) - (a.qualityHint.includes('4K') ? 2 : a.qualityHint.includes('1080') ? 1 : 0)) : list; }, [rows, prefer4k, filter]);
  return <div className="min-h-screen"><Header /><main className={s.shell}>
    <div className={s.hero}><div><h1 className={s.title}>今晚，找一部好电影。</h1><p className={s.subtitle}>海清和静静的私人片库</p></div><div className={s.accounts}>
      {(['aliyun', 'quark'] as const).map((provider) => <button key={provider} className={s.account} disabled={!accounts.verified} onClick={() => void accounts.login(provider)}><PanDriveIcon provider={provider} /><span>{panNames[provider]}<span className={s.connected}>{accounts.accounts[provider]?.connected ? ' · 已连接' : ' · 扫码连接'}</span></span>{accounts.accounts[provider]?.connected && <span className={s.onlineDot} />}</button>)}
    </div></div>
    <section className={s.searchPanel} aria-label="搜索网盘资源"><form className={s.searchForm} onSubmit={(e) => { e.preventDefault(); void search(keyword); }}><PanIcon name="search" className={s.searchGlyph} /><input className={s.searchInput} aria-label="搜索网盘影片" placeholder="搜索片名，例如：战狼2、血战钢锯岭" value={keyword} maxLength={60} onChange={(e) => setKeyword(e.target.value)} /><button type="button" className={s.clearSearch} aria-label="清空搜索词" onClick={() => setKeyword('')} disabled={!keyword}><PanIcon name="close" /></button><button className={s.searchButton} disabled={!accounts.verified || !keyword.trim()}>搜索</button></form><div className={s.searchHint}><div className={s.suggestions}><span>你可能还在找：</span>{['战狼2', '血战钢锯岭', '流浪地球'].map((v) => <button key={v} onClick={() => { setKeyword(v); void search(v); }}>{v}</button>)}</div><div className="flex gap-5"><Link href="/pan/watch?provider=aliyun&personal=1" className={s.textButton}><PanIcon name="folder" />我的阿里云盘</Link><button className={s.textButton} onClick={() => setShowLink((v) => !v)}><PanIcon name="link" />粘贴链接</button></div></div>
      {showLink && <form className="flex flex-wrap gap-2 mt-5 border-t border-line pt-5" onSubmit={(e) => { e.preventDefault(); try { const parsed = parsePanShare(link, passcode); window.location.assign(roomUrl({ shareUrl: parsed.url, provider: parsed.provider, passcode: parsed.passcode })); } catch (e) { setError((e as Error).message); } }}><input className="input flex-1 min-w-[190px]" aria-label="网盘分享链接" placeholder="粘贴阿里云盘或夸克分享链接" value={link} onChange={(e) => setLink(e.target.value)} /><input className="input w-28" aria-label="提取码" placeholder="提取码（选填）" value={passcode} maxLength={8} onChange={(e) => setPasscode(e.target.value)} /><button className="btn-ghost" disabled={!link.trim()}>打开资源</button></form>}
      {busy && <div className={s.loading} aria-hidden="true" />}
    </section>
    <div className={s.toolbar}><div className={s.tabs} aria-label="网盘筛选">{(['all', 'aliyun', 'quark'] as const).map((v) => <button key={v} className={s.tab + (filter === v ? ' ' + s.selected : '')} aria-pressed={filter === v} onClick={() => { setFilter(v); const url = new URL(location.href); url.searchParams.set('provider', v); window.history.replaceState(null, '', url); }}>{v === 'all' ? '全部网盘' : panNames[v]}</button>)}</div><div className="flex items-center gap-5 flex-wrap"><span className={s.count} aria-live="polite">{busy ? `查找并检查目录 · ${displayed.length} 个含视频分享` : `${searched === '最近更新' ? '最近更新 · ' : ''}${displayed.length} 个含视频分享`}</span><label className="text-xs text-muted flex gap-2 items-center"><input type="checkbox" checked={prefer4k} onChange={(e) => setPrefer4k(e.target.checked)} />优先标注 4K</label></div></div>
    {error && <p role="alert" className={s.notice + ' mb-5'}>{error}</p>}
    {busy && <p className="text-xs text-muted mb-4" role="status">正在并行搜索并检查视频目录{checking ? ` · ${checking} 个候选待检查` : ""}，通过检查的结果会陆续出现。</p>}
    {!busy && (rejected > 0 || unchecked > 0) && <p className="text-xs text-faint mb-4">已过滤 {rejected} 个无视频目录；{unchecked} 个暂未完成验证的分享未展示，可稍后重新搜索。</p>}
    <div className={s.grid}>{displayed.map((row) => <PanResourceCard key={row.shareUrl} row={row} href={roomUrl(row)} onOpen={rememberPosition} />)}</div>
    {!busy && !displayed.length && <div className={s.empty}><p className="text-content text-base mb-2">{error ? '暂时没有加载到结果' : '这次还没有找到合适的分享'}</p><p>只展示目录中已确认有视频的分享。可以切换网盘、继续查找，或粘贴自己的分享链接。</p></div>}
    {more && <div className={s.more}><button className={s.moreButton} disabled={busy} onClick={() => void search(searched === '最近更新' ? '' : searched, page + 1, searched === '最近更新')}><PanIcon name="refresh" />{busy ? '继续查找中…' : '继续查找更多'}</button></div>}
    <div className={s.footer}><details><summary className="cursor-pointer">{accounts.accounts.quark?.sources?.length || 7} 个检索来源 · {failures.length ? `${failures.length} 个来源本次未完成` : '并行查询，结果陆续显示'}</summary><p className="mt-2">{accounts.accounts.quark?.sources?.map((v) => v.name).join(' · ')}</p>{failures.map((v) => <p key={v}>{v}</p>)}</details>{(accounts.accounts.aliyun?.autoCleanup || accounts.accounts.quark?.autoCleanup) && <p className="mt-2">追剧专用账号已开启空间不足自动清理：旧资源与回收站可被彻底清理，本站正在播放的文件会保留。</p>}<p className="mt-3">资源标注与实际可播画质可能不同。</p></div>
  </main><SiteFooter /><PanLoginDialog state={accounts} /></div>;
}
