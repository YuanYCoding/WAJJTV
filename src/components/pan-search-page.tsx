'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from './header';
import { SiteFooter } from './site-footer';
import { PanLoginDialog, panNames, usePanAccounts } from './pan-accounts';
import { parsePanShare } from '@/lib/netdisk-utils';
import type { PanProvider, PanResult, PanSearchEvent } from '@/lib/netdisk-types';
import s from '@/app/pan/pan.module.css';

export function PanSearchPage() {
  const params = useSearchParams(), accounts = usePanAccounts();
  const [keyword, setKeyword] = useState(params.get('q') || '');
  const [filter, setFilter] = useState<'all' | PanProvider>(params.get('provider') === 'aliyun' ? 'aliyun' : 'all');
  const [rows, setRows] = useState<PanResult[]>([]), [busy, setBusy] = useState(false), [searched, setSearched] = useState('');
  const [error, setError] = useState(''), [failures, setFailures] = useState<string[]>([]), [page, setPage] = useState(1), [more, setMore] = useState(false);
  const [showLink, setShowLink] = useState(false), [link, setLink] = useState(''), [passcode, setPasscode] = useState(''), [prefer4k, setPrefer4k] = useState(false);
  const abort = useRef<AbortController | null>(null), run = useRef(0), initial = useRef(false);
  const search = async (word: string, selected = filter, nextPage = 1, latest = false) => {
    const q = word.trim().slice(0, 60); if (!q && !latest) return;
    const seq = ++run.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const seen = new Set(nextPage > 1 ? rows.map((v) => v.shareUrl) : []); let added = 0;
    setBusy(true); setError(''); setFailures([]); setSearched(latest ? '最近更新' : q); setPage(nextPage); if (nextPage === 1) setRows([]);
    try {
      const res = await fetch('/api/netdisk/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: q, mode: latest ? 'latest' : 'search', provider: selected === 'all' ? undefined : selected, page: nextPage }), signal: controller.signal });
      if (res.status === 401) window.dispatchEvent(new CustomEvent('libretv:unauthorized'));
      if (!res.ok || !res.body) throw new Error('搜索暂时不可用，请重试');
      const reader = res.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      const consume = (line: string) => { if (!line.trim() || seq !== run.current) return; const event = JSON.parse(line) as PanSearchEvent;
        if (event.type === 'results') { if (event.error) setFailures((old) => [...new Set([...old, `${accounts.accounts.quark?.sources?.find((v) => v.id === event.source)?.name || event.source}：${event.error}`])]);
          const fresh = event.list.filter((v) => { if (seen.has(v.shareUrl)) return false; seen.add(v.shareUrl); return true; }); added += fresh.length; if (fresh.length) setRows((old) => [...old, ...fresh]); }
      };
      for (;;) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let index: number; while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); } } consume(buffer + decoder.decode());
      if (seq === run.current) setMore(added > 0 && nextPage < 10);
    } catch (e) { if (!controller.signal.aborted && seq === run.current) setError((e as Error).message); }
    finally { if (seq === run.current) setBusy(false); }
  };
  useEffect(() => { if (accounts.verified && !initial.current) { initial.current = true; void search(keyword, filter, 1, !keyword); } }, [accounts.verified]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { run.current++; abort.current?.abort(); }, []);
  const roomUrl = (row: { shareUrl: string; title?: string; passcode?: string; provider?: PanProvider }) => '/pan/watch?' + new URLSearchParams({ url: row.shareUrl, title: row.title || '分享资源', passcode: row.passcode || '', provider: row.provider || 'quark', q: keyword });
  const displayed = prefer4k ? [...rows].sort((a, b) => (b.qualityHint.includes('4K') ? 2 : b.qualityHint.includes('1080') ? 1 : 0) - (a.qualityHint.includes('4K') ? 2 : a.qualityHint.includes('1080') ? 1 : 0)) : rows;
  return <div className="min-h-screen"><Header /><main className={s.shell}>
    <div className={s.hero}><div><p className={s.eyebrow}>JJBITV / CLOUD CINEMA</p><h1 className={s.title}>两个人的云端片库。</h1><p className={s.subtitle}>海清和静静，一起找一部好电影。<br />阿里云盘与夸克，一次搜索，慢慢挑选。</p></div><div className={s.accounts}>
      {(['aliyun', 'quark'] as const).map((provider) => <button key={provider} className={s.account} disabled={!accounts.verified} onClick={() => void accounts.login(provider)}><span className={s.driveIcon}>{provider === 'aliyun' ? '阿' : '夸'}</span><span><span className="text-sm">{panNames[provider]}</span><span className={s.connected + ' block'}>{accounts.accounts[provider]?.connected ? '● 已连接 · 管理' : '扫码连接 →'}</span></span></button>)}
    </div></div>
    <section className={s.searchPanel} aria-label="搜索网盘资源"><form className={s.searchForm} onSubmit={(e) => { e.preventDefault(); void search(keyword); }}><input className={s.searchInput} aria-label="搜索网盘影片" placeholder="搜索片名，例如：战狼2、血战钢锯岭" value={keyword} maxLength={60} onChange={(e) => setKeyword(e.target.value)} /><button className={s.searchButton} disabled={!accounts.verified || !keyword.trim()}>搜索</button></form><div className={s.searchHint}><div className={s.suggestions}><span>试试</span>{['战狼2', '血战钢锯岭', '流浪地球'].map((v) => <button key={v} onClick={() => { setKeyword(v); void search(v); }}>{v}</button>)}</div><div className="flex gap-5"><Link href="/pan/watch?provider=aliyun&personal=1" className={s.textButton}>我的阿里云盘</Link><button className={s.textButton} onClick={() => setShowLink((v) => !v)}>粘贴分享链接 ↗</button></div></div>
      {showLink && <form className="flex flex-wrap gap-2 mt-5 border-t border-line pt-5" onSubmit={(e) => { e.preventDefault(); try { const parsed = parsePanShare(link, passcode); window.location.assign(roomUrl({ shareUrl: parsed.url, provider: parsed.provider, passcode: parsed.passcode })); } catch (e) { setError((e as Error).message); } }}><input className="input flex-1 min-w-[190px]" aria-label="网盘分享链接" placeholder="粘贴阿里云盘或夸克分享链接" value={link} onChange={(e) => setLink(e.target.value)} /><input className="input w-28" aria-label="提取码" placeholder="提取码（选填）" value={passcode} maxLength={8} onChange={(e) => setPasscode(e.target.value)} /><button className="btn-ghost" disabled={!link.trim()}>打开资源</button></form>}
      {busy && <div className={s.loading} aria-hidden="true" />}
    </section>
    <div className={s.toolbar}><div className={s.tabs} aria-label="网盘筛选">{(['all', 'aliyun', 'quark'] as const).map((v) => <button key={v} className={s.tab + (filter === v ? ' ' + s.selected : '')} aria-pressed={filter === v} onClick={() => { setFilter(v); void search(keyword, v, 1, !keyword); }}>{v === 'all' ? '全部网盘' : panNames[v]}</button>)}</div><div className="flex items-center gap-5 flex-wrap"><span className={s.count} aria-live="polite">{busy ? `正在搜索 · ${rows.length} 个结果` : `${searched} · ${rows.length} 个结果`}</span><label className="text-xs text-muted flex gap-2 items-center"><input type="checkbox" checked={prefer4k} onChange={(e) => setPrefer4k(e.target.checked)} />优先标注 4K</label></div></div>
    {error && <p role="alert" className={s.notice + ' mb-5'}>{error}</p>}
    <div className={s.grid}>{displayed.map((row) => <article className={s.card} key={row.shareUrl}><div className={s.cardTop}><span className={s.badge}>{panNames[row.provider || 'quark']}</span><span>{row.qualityHint}</span></div><h2 className={s.cardTitle}>{row.title}</h2><div className={s.cardBottom}><span>{row.sourceName} · {row.checked ? '分享可访问' : '打开时检测'}</span><Link className={s.open} href={roomUrl(row)}>进入放映室 ↗</Link></div></article>)}</div>
    {!busy && !rows.length && <div className={s.empty}><p className="text-content text-base mb-2">{error ? '暂时没有加载到结果' : '这次还没有找到合适的分享'}</p><p>试试缩短片名、切换网盘，或粘贴自己的分享链接。</p></div>}
    {rows.length > 0 && more && <div className={s.more}><button className="btn-ghost px-7 py-3" disabled={busy} onClick={() => void search(searched === '最近更新' ? '' : searched, filter, page + 1, searched === '最近更新')}>{busy ? '继续查找中…' : '继续查找更多资源'}</button></div>}
    <div className={s.footer}><details><summary className="cursor-pointer">{accounts.accounts.quark?.sources?.length || 7} 个检索来源 · {failures.length ? `${failures.length} 个来源本次未完成` : '并行查询，结果陆续显示'}</summary><p className="mt-2">{accounts.accounts.quark?.sources?.map((v) => v.name).join(' · ')}</p>{failures.map((v) => <p key={v}>{v}</p>)}</details><p className="mt-3">4K / 1080P 标注来自资源标题。分享可访问不代表当前账号能以该画质播放，进入放映室后会显示实际线路。</p></div>
  </main><SiteFooter /><PanLoginDialog state={accounts} /></div>;
}
