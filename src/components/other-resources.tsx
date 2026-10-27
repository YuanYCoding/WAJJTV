'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { Header } from './header';
import { SiteFooter } from './site-footer';
import { PanIcon } from './pan-resource-card';
import { resourceTier } from '@/lib/hls-resource-types';
import type { HlsInspection, HlsResource, HlsSearchEvent } from '@/lib/hls-resources';
import s from '@/app/pan/pan.module.css';
import r from '@/app/resources/resources.module.css';
const Player = dynamic(() => import('./netdisk-player').then((m) => m.NetdiskPlayer), { ssr: false });
type Choice = { title: string; id: string; url: string; episodes: { name: string; url: string }[]; info: HlsInspection };
export function OtherResources() {
  const router = useRouter(), params = useSearchParams(), q = params.get('q') || '';
  const [input, setInput] = useState(q), [filter, setFilter] = useState('hd'), [partial, setPartial] = useState<HlsResource[]>([]), [stats, setStats] = useState(''), [error, setError] = useState('');
  const [direct, setDirect] = useState(''), [inspecting, setInspecting] = useState(false), [choice, setChoice] = useState<Choice | null>(null), [index, setIndex] = useState(0), [transport, setTransport] = useState('direct'), [refresh, setRefresh] = useState(0);
  const stage = useRef<HTMLElement>(null), directRequest = useRef<AbortController | null>(null);
  const [showcasePage, setShowcasePage] = useState(0);
  const showcase = useQuery({ queryKey: ['hls-showcase'], staleTime: 60_000, queryFn: async () => { const r = await fetch('/api/resources/showcase'); if (!r.ok) throw new Error('片单暂不可用'); return r.json() as Promise<{ count: number; items: { title: string; width: number; height: number }[] }>; } });
  const search = useQuery({ queryKey: ['hls-resources-v10', q], enabled: Boolean(q), staleTime: 5 * 60_000, retry: false, queryFn: async ({ signal }) => {
    setPartial([]); setStats('正在检索 HLS 目录…');
    const response = await fetch('/api/resources/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: q }), signal });
    if (!response.ok) { const v = await response.json(); throw new Error(v.error || '搜索暂时不可用'); }
    const reader = response.body!.getReader(), decoder = new TextDecoder(), rows: HlsResource[] = []; let pending = '', done = false;
    const accept = (line: string) => { if (!line.trim()) return; const v = JSON.parse(line) as HlsSearchEvent;
      if (v.type === 'result') { rows.push(v.item); setPartial([...rows]); }
      else if (v.type === 'progress') setStats(`目录 ${v.sources}/${v.total} · 已检测 ${v.checked}/${v.candidates} 条播放清单`);
      else if (v.type === 'done') { done = true; setStats(`完成检测 ${v.checked}/${v.candidates} 条清单 · ${v.count} 条高清线路${v.errors ? ' · 部分来源本次未完成' : ''}`); }
    };
    try { for (;;) { const value = await reader.read(); if (value.done) break; pending += decoder.decode(value.value, { stream: true }); const lines = pending.split('\n'); pending = lines.pop() || ''; lines.forEach(accept); } pending += decoder.decode(); accept(pending); if (!done) throw new Error('搜索连接中断，已到达的结果仍可播放，请重新搜索'); return rows; }
    finally { void reader.cancel().catch(() => {}); }
  } });
  useEffect(() => { setInput(q); setChoice(null); setError(''); }, [q]);
  useEffect(() => () => directRequest.current?.abort(), []);
  const rows = search.data || partial;
  const shown = useMemo(() => rows.filter((v) => filter !== '4k' || resourceTier(v) === '4K' && v.evidence === 'segment').sort((a, b) => (b.width || 0) - (a.width || 0) || (b.height || 0) - (a.height || 0)), [rows, filter]);
  const open = (value: Choice) => { setChoice(value); setIndex(0); setTransport('direct'); setRefresh(0); setError(''); requestAnimationFrame(() => stage.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  const inspect = async () => { directRequest.current?.abort(); const controller = new AbortController(); directRequest.current = controller; setInspecting(true); setError('');
    try { const r = await fetch('/api/resources/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: direct.trim() }), signal: controller.signal }); const v = await r.json(); if (!r.ok) throw new Error(v.error || '清单检测失败'); open({ title: '自定义 HLS 视频', url: v.url, id: v.url, episodes: [{ name: '在线播放', url: v.url }], info: v }); }
    catch (e) { if (!controller.signal.aborted) setError((e as Error).message); } finally { if (directRequest.current === controller) setInspecting(false); }
  };
  const currentUrl = choice?.episodes[index]?.url || choice?.url;
  const media = currentUrl ? '/api/resources/media?direct=' + (transport === 'direct' ? '1' : '0') + '&url=' + encodeURIComponent(currentUrl) + '&v=' + refresh : '';
  return <div className="min-h-screen"><Header /><main className={s.shell}>
    <div className={s.hero}><div><p className={s.eyebrow}>HLS CINEMA · 海清 & 静静</p><h1 className={s.title}>其他资源</h1><p className={s.subtitle}>寻找可以直接播放的高清画面</p></div><span className={s.badge}>m3u8 在线播放</span></div>
    <section className={s.searchPanel}><form className={s.searchForm} onSubmit={(e) => { e.preventDefault(); if (input.trim()) { if (q === input.trim()) void search.refetch(); else router.push('/resources?q=' + encodeURIComponent(input.trim().slice(0, 100))); } }}><PanIcon name="search" className={s.searchGlyph} /><input className={s.searchInput} aria-label="搜索高清 m3u8 资源" placeholder="搜索片名：战狼2、血战钢锯岭、星际穿越…" value={input} onChange={(e) => setInput(e.target.value)} maxLength={100} /><button className={s.searchButton} disabled={!input.trim() || search.isFetching && input.trim() === q}>搜索</button></form>
      <div className={s.searchHint}><div className={s.suggestions}><span>试试</span>{['战狼2', '血战钢锯岭', '星际穿越'].map((v) => <button key={v} onClick={() => router.push('/resources?q=' + encodeURIComponent(v))}>{v}</button>)}</div><span>检索清单 → 检测画质 → 站内播放</span></div>
    </section>
    {!q && Boolean(showcase.data?.items.length) && <section className="mt-8"><div className="flex justify-between items-center gap-4"><h2 className="text-lg font-medium">已测 4K 片单</h2><button className="btn-ghost btn-sm" onClick={() => setShowcasePage((n) => (n + 1) % Math.ceil(showcase.data!.items.length / 12))}>换一组</button></div><p className="text-xs text-muted leading-6 mt-2 mb-4">收录 {showcase.data?.count} 条分片达到 4K 尺寸的线路（含语言版本）。点击片名会重新检索并验证当前可用性。</p><div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{showcase.data?.items.slice(showcasePage * 12, showcasePage * 12 + 12).map((v) => <button key={v.title} className="border border-line rounded-xl p-4 text-left hover:border-accent min-w-0" onClick={() => router.push('/resources?q=' + encodeURIComponent(v.title.replace(/4K$/i, '')))}><span className="block text-sm leading-6 break-words">{v.title}</span><span className="block text-xs text-accent mt-2">分片检测 {v.width} × {v.height}</span></button>)}</div></section>}
    {choice && <section ref={stage} className="mt-8 scroll-mt-24 border border-line rounded-2xl p-4 sm:p-6" aria-label="高清放映室"><div className="flex items-center justify-between gap-4"><span className="text-xs text-accent">高清放映室 · {choice.info.evidence === 'segment' ? '分片检测' : choice.info.evidence === 'manifest' ? '清单声明' : '画质待播放器确认'} {choice.info.width && choice.info.height ? `${choice.info.width} × ${choice.info.height}` : ''}</span><button className="btn-ghost btn-sm" onClick={() => setChoice(null)}>关闭放映室</button></div>
      <Player key={choice.id} quality={{ url: media, kind: 'hls', label: '最高可用画质' }} title={choice.title + (choice.episodes.length > 1 ? ' · ' + choice.episodes[index].name : '')} identity={'hls:' + choice.id + ':' + index} saved={false} preferHighest onRefresh={() => setRefresh((v) => v + 1)} />
      <div className="flex flex-wrap items-center gap-3 mt-4"><label className="text-xs text-muted">传输方式 <select className="input ml-2" value={transport} onChange={(e) => setTransport(e.target.value)}><option value="direct">CDN 直连优先</option><option value="proxy">服务器中转</option></select></label><span className="text-xs text-faint">默认最高档位；直连失败自动尝试中转。以播放器实测尺寸为准。</span></div>
      {choice.episodes.length > 1 && <div className="flex items-center flex-wrap gap-3 mt-4"><label className="text-xs text-muted">选择剧集 <select className="input ml-2 max-w-[220px]" value={index} onChange={(e) => setIndex(Number(e.target.value))}>{choice.episodes.map((v, i) => <option key={v.url} value={i}>{v.name}</option>)}</select></label><span className="text-xs text-faint">搜索时检测第一集，其他剧集播放后显示实际画质。</span></div>}
    </section>}
    <div className={s.toolbar}><div className={s.tabs}>{[['hd', '1080P 及以上'], ['4k', '仅看 4K']].map(([key, title]) => <button key={key} className={s.tab + (filter === key ? ' ' + s.selected : '')} onClick={() => setFilter(key)} aria-pressed={filter === key}>{title}</button>)}</div><span className={s.count}>{shown.length} 条高清线路</span></div>
    {q && <p role="status" className="text-xs text-muted mb-5 leading-6">{search.isFetching ? stats || '正在检索 HLS 目录…' : stats || '显示缓存的检测结果'}{search.isFetching && <span className="text-accent ml-2">找到即展示</span>}</p>}
    {(error || search.error) && <p role="alert" className={s.notice + ' mb-5'}>{error || (search.error as Error).message}</p>}
    <div className={s.grid}>{shown.map((v) => <article key={v.id} className={s.card + ' ' + r.resourceCard} data-testid="hls-result"><div className={s.cardTop}><span className={s.badge}>{resourceTier(v)} · {v.width} × {v.height}</span><span>{v.evidence === 'segment' ? '视频分片检测' : '清单声明'}</span></div><h2 className={s.cardTitle}>{v.title}</h2><p className="text-xs text-muted mb-5">{v.year || '年份暂无'} · {v.source} · {v.episodes.length} 集 · 首集 {Math.round(v.duration / 60)} 分钟</p>{/4k|2160p/i.test(v.title) && resourceTier(v) !== '4K' && <p className={r.sourceWarning}>片名标注 4K，检测尺寸未达到 4K</p>}<div className={s.cardBottom}><span>已检查清单和媒体可访问</span><button className="btn-primary btn-sm" onClick={() => open({ title: v.title, id: v.id, url: v.url, episodes: v.episodes, info: v })}>播放</button></div></article>)}</div>
    {q && !search.isFetching && !shown.length && <p className={s.empty}>{filter === '4k' ? '本次未找到符合 4K 尺寸的线路，可查看 1080P 结果或在下方打开已有的原画 m3u8。' : '本次没有找到通过高清检测的长片线路。未确认画质、低清、短预告和不可访问的线路不会冒充高清显示。'}</p>}
    <section className="mt-10 border border-line rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-medium">已有 m3u8？直接放映</h2><p className="text-sm text-muted mt-2 mb-4 leading-7">粘贴已有的公开播放地址，检测清单、实际尺寸和时长后打开。支持多档位清单与分片加密；需要平台授权的线路请使用平台播放器。</p><form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); void inspect(); }}><input className="input min-w-0 flex-1" aria-label="m3u8 播放地址" placeholder="https://…/index.m3u8" value={direct} onChange={(e) => setDirect(e.target.value)} maxLength={4000} /><button className="btn-primary" disabled={inspecting || !direct.trim()}>{inspecting ? '正在检测…' : '检测并打开'}</button></form></section>
    <p className="text-xs text-faint mt-6 leading-7">独立 HLS 目录检索，不调用普通影片搜索接口。清单中的“4K”与高码率不等于真实 4K；分片尺寸优先于清单声明，最终以播放解码尺寸为准。宽银幕视频可能裁去黑边。来源可能临时失效，没有检出 4K 时会如实显示。</p>
  </main><SiteFooter /></div>;
}
