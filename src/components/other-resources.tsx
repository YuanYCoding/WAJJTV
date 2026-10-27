'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Header } from './header';
import { SiteFooter } from './site-footer';
import { PanIcon } from './pan-resource-card';
import { AggregatedCard, aggregateResults } from './video-card';
import { useAppStore, resolveSource, isSourceDisabled, isInDisabledSubscription } from '@/lib/store';
import { api } from '@/lib/client-api';
import { buildWatchUrl } from '@/lib/utils';
import { qualityLabel } from '@/lib/quality';
import type { QualityProbeResult, SearchResultItem, SourceSearchOutcome } from '@/lib/types';
import s from '@/app/pan/pan.module.css';

export function OtherResources() {
  const router = useRouter(), params = useSearchParams(), q = params.get('q') || '';
  const [input, setInput] = useState(q), [filter, setFilter] = useState('all'), [partial, setPartial] = useState<SourceSearchOutcome[]>([]);
  const envSources = useAppStore((v) => v.envSources), customAPIs = useAppStore((v) => v.customAPIs), selectedKeys = useAppStore((v) => v.selectedKeys), sourceHealth = useAppStore((v) => v.sourceHealth), subscriptions = useAppStore((v) => v.subscriptions);
  const [quality, setQuality] = useState<Record<string, QualityProbeResult>>({}), [probing, setProbing] = useState(false), [error, setError] = useState(''), [magnet, setMagnet] = useState(''), [magnetLink, setMagnetLink] = useState('');
  const probe = useRef<AbortController | null>(null);
  const sources = useMemo(() => [...new Map((selectedKeys.length ? selectedKeys.map((key) => resolveSource({ customAPIs, envSources }, key)).filter((v): v is NonNullable<typeof v> => Boolean(v)) : [...envSources, ...customAPIs]).filter((v) => !v.isAdult && !isSourceDisabled({ sourceHealth }, v.key) && !isInDisabledSubscription({ subscriptions }, v.key)).map((v) => [v.url, v])).values()], [envSources, customAPIs, selectedKeys, sourceHealth, subscriptions]);
  const search = useQuery({ queryKey: ['other-resources', q, sources], enabled: Boolean(q && sources.length), staleTime: 5 * 60_000, queryFn: ({ signal }) => { setPartial([]); return api.search(q, sources, true, { signal, onSource: (v) => setPartial((old) => [...old.filter((x) => x.sourceKey !== v.sourceKey), v]) }); } });
  const magnetic = useQuery({ queryKey: ['other-magnets', q], enabled: Boolean(q && sources.length), staleTime: 5 * 60_000, retry: false, queryFn: async ({ signal }) => { const r = await fetch('/api/resources/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: q }), signal }); const v = await r.json(); if (!r.ok) throw new Error(v.error || '磁力目录暂不可用'); return v as { magnets: { title: string; name: string; url: string; source: string }[] }; } });
  const magneticRows = (magnetic.data?.magnets || []).filter((v) => filter === 'verified' ? false : filter === 'marked' ? /4k|2160p|原盘/i.test(v.title + v.name) : true);
  useEffect(() => { setInput(q); setQuality({}); setError(''); probe.current?.abort(); }, [q]);
  useEffect(() => () => probe.current?.abort(), []);
  const list = useMemo(() => search.data?.list || partial.flatMap((v) => v.list), [search.data, partial]);
  const groups = useMemo(() => aggregateResults(list).map((g) => ({ ...g, measured: Math.max(0, ...g.items.map((i) => quality[i.sourceKey + ':' + i.vodId]?.height || 0)), marked: g.items.some((i) => /4k|2160p|原盘/i.test(i.name + ' ' + i.remarks)) })).filter((g) => filter === 'verified' ? qualityLabel(g.measured) === '4K' : filter === 'marked' ? g.marked || qualityLabel(g.measured) === '4K' : true).sort((a, b) => b.measured - a.measured || Number(b.marked) - Number(a.marked)), [list, quality, filter]);
  const detect = async () => {
    probe.current?.abort(); const controller = new AbortController(); probe.current = controller; setProbing(true); setError('');
    try { const items = [...list].sort((a, b) => Number(/4k|2160p|原盘/i.test(b.name + b.remarks)) - Number(/4k|2160p|原盘/i.test(a.name + a.remarks))).slice(0, 20).flatMap((item) => { const source = sources.find((v) => v.key === item.sourceKey); return source ? [{ source, id: item.vodId }] : []; }); await api.qualityProbeStream(items, (v) => setQuality((old) => ({ ...old, [v.sourceKey + ':' + v.vodId]: v })), controller.signal); }
    catch (e) { if (!controller.signal.aborted) setError((e as Error).message); } finally { if (probe.current === controller) setProbing(false); }
  };
  const play = (item: SearchResultItem) => { const source = sources.find((v) => v.key === item.sourceKey); if (source) router.push(buildWatchUrl({ sourceKey: source.key, sourceUrl: source.url, detail: source.detail, vodId: item.vodId, index: 0, title: item.name })); };
  return <div className="min-h-screen"><Header /><main className={s.shell}><div className={s.hero}><div><h1 className={s.title}>其他资源</h1><p className={s.subtitle}>多线路影视搜索 · 高清优先 · 网页直接播放</p></div></div>
    <section className={s.searchPanel}><form className={s.searchForm} onSubmit={(e) => { e.preventDefault(); if (input.trim()) router.push('/resources?q=' + encodeURIComponent(input.trim().slice(0, 100))); }}><PanIcon name="search" className={s.searchGlyph} /><input className={s.searchInput} aria-label="搜索其他影视资源" placeholder="搜索片名，例如：流浪地球2、星际穿越" value={input} onChange={(e) => setInput(e.target.value)} maxLength={100} /><button className={s.searchButton} disabled={!input.trim() || !sources.length}>搜索</button></form><p className="text-xs text-muted mt-4 leading-6">并行查询 {sources.length} 个已启用的影视来源。4K 标注仅供筛选，检测结果和播放器实测分辨率才是画质依据。</p></section>
    <div className={s.toolbar}><div className={s.tabs}>{[['all', '全部线路'], ['marked', '标注 4K / 原盘'], ['verified', '已测 4K']].map(([key, title]) => <button key={key} className={s.tab + (filter === key ? ' ' + s.selected : '')} onClick={() => setFilter(key)} aria-pressed={filter === key}>{title}</button>)}</div><button className="btn-ghost btn-sm" disabled={probing || !list.length} onClick={() => void detect()}>{probing ? '正在检测画质…' : '检测前 20 条画质'}</button></div>
    {(error || search.error) && <p role="alert" className={s.notice + ' mb-5'}>{error || (search.error as Error).message}</p>}
    {search.isFetching && <p role="status" className="text-xs text-accent mb-5">正在并行搜索 · 已发现 {list.length} 条线路</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">{groups.slice(0, 120).map((group) => <div key={group.key} className="min-w-0">{group.measured > 0 && <p className="text-xs text-accent mb-2">清单检测 {qualityLabel(group.measured) || group.measured + 'P'}</p>}<AggregatedCard group={group} sources={sources} onOpen={play} /></div>)}</div>
    {magneticRows.length > 0 && <section className="mt-10"><h2 className="text-lg font-medium">磁力检索结果 · 本机播放</h2><p className="text-xs text-muted mt-2 mb-4">来源提供的画质标注尚未实测。点击后由本机磁力程序接手，是否能及时播放取决于做种和下载情况。</p><div className={s.grid}>{magneticRows.slice(0, 36).map((v) => <article key={v.url} className="border border-line rounded-xl p-5 min-w-0"><h3 className="font-medium text-sm line-clamp-2">{v.title}</h3><p className="text-xs text-muted mt-2 break-words line-clamp-3" title={v.name}>{v.name || '磁力资源'}</p><div className="flex flex-wrap gap-3 items-center mt-4"><a className="btn-primary btn-sm" href={v.url}>本机打开</a><button className="btn-ghost btn-sm" onClick={() => { void navigator.clipboard.writeText(v.url).then(() => setError('磁力已复制')).catch(() => setError('当前浏览器无法复制，可使用本机打开')); }}>复制磁力</button><span className="text-xs text-faint">{v.source}</span></div></article>)}</div></section>}
    {magnetic.error && <p className="mt-5 text-xs text-muted">磁力目录本次未完成，网页影视搜索仍可使用。</p>}
    {q && !search.isFetching && !magnetic.isFetching && !groups.length && !magneticRows.length && <p className={s.empty}>{filter === 'verified' ? '尚未检测到 4K 线路。可先检测画质，或查看全部线路。' : '暂未找到符合条件的资源，可以更换片名或筛选。'}</p>}
    <section className="mt-10 border-t border-line pt-6"><h2 className="text-lg font-medium">磁力资源，交给本机打开</h2><p className="text-sm text-muted mt-2 leading-6">粘贴已有磁力链接，由系统默认的磁力下载器或支持 BT 的播放器接手。普通 VLC / PotPlayer 本身通常不能直接解析磁力。</p><form className="flex flex-wrap gap-3 mt-4" onSubmit={(e) => { e.preventDefault(); try { const u = new URL(magnet.trim()); if (u.protocol !== 'magnet:' || !u.searchParams.getAll('xt').some((v) => /^urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(v) || /^urn:btmh:1220[a-f\d]{64}$/i.test(v))) throw new Error(); setMagnetLink(u.href); setError(''); } catch { setError('请输入有效的 magnet 磁力链接'); } }}><input className="input min-w-0 flex-1" aria-label="磁力链接" value={magnet} onChange={(e) => { setMagnet(e.target.value); setMagnetLink(''); }} placeholder="magnet:?xt=urn:btih:…" /><button className="btn-ghost" disabled={!magnet.trim()}>检查链接</button></form>{magnetLink && <div className="flex flex-wrap gap-3 mt-3"><a className="btn-primary btn-sm" href={magnetLink}>本机打开磁力</a><button className="btn-ghost btn-sm" onClick={() => { void navigator.clipboard.writeText(magnetLink).then(() => setError('磁力链接已复制')).catch(() => setError('请从输入框手动复制链接')); }}>复制磁力</button></div>}</section>
  </main><SiteFooter /></div>;
}
