'use client';
import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from './auth';
import { SmartImage } from './smart-image';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/client-api';
import type { DiscoverItem, DiscoverResult, DiscoverKind } from '@/lib/discover';
import { cn } from '@/lib/utils';
import { useFilmPreview } from './film-preview';

const TABS = [{ id: 'hot', label: '热门推荐' }, { id: 'movie', label: '电影' }, { id: 'tv', label: '剧集' }, { id: 'anime', label: '动漫' }, { id: 'variety', label: '综艺' }, { id: 'rank', label: '排行榜' }] as const;
type Tab = typeof TABS[number]['id'];
const GENRES: Record<DiscoverKind, string[]> = { hot: ['剧情','喜剧','爱情','悬疑'], movie: ['剧情','喜剧','爱情','动作','科幻','悬疑','犯罪','战争','动画','纪录片'], tv: ['剧情','喜剧','言情','悬疑','都市','古装','军事','警匪'], anime: ['热血','冒险','搞笑','科幻','亲子'], variety: ['真人秀','访谈','脱口秀','音乐','搞笑'] };
const RANKS = [{ id: 'douban_movie_weekly', label: '电影周榜' }, { id: 'douban_tv_chinese', label: '国产剧周榜' }, { id: 'douban_tv_global', label: '海外剧周榜' }, { id: 'douban_show_chinese', label: '国内综艺' }, { id: 'douban_show_global', label: '海外综艺' }, { id: 'baidu_teleplay', label: '热播剧榜' }];

export function DiscoverSection() {
  const params = useSearchParams();
  const { verified, openLogin } = useAuth();
  const [tab, setTab] = useState<Tab>(params.get('view') === 'rank' ? 'rank' : 'hot');
  const [genre, setGenre] = useState('');
  const [area, setArea] = useState('');
  const [year, setYear] = useState('');
  const [sort, setSort] = useState('rankhot');
  const [rank, setRank] = useState(RANKS[0].id);
  const [calendar, setCalendar] = useState(false);
  useEffect(() => { if (params.get('view') === 'rank') setTab('rank'); }, [params]);
  const kind = tab === 'rank' ? 'hot' : tab;
  const catalogue = useInfiniteQuery({
    queryKey: ['discover', kind, genre, area, year, sort], initialPageParam: 1,
    enabled: verified && tab !== 'rank' && !calendar,
    queryFn: async ({ pageParam, signal }) => {
      const q = new URLSearchParams({ kind, genre, area, year, sort, page: String(pageParam) });
      const res = await fetch(`/api/discover?${q}`, { signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '片库暂时不可用');
      return data as DiscoverResult;
    },
    getNextPageParam: (last, pages) => last.hasMore ? pages.length + 1 : undefined,
    staleTime: 10 * 60_000, retry: 1,
  });
  const rankings = useQuery({ queryKey: ['hot-list', rank], queryFn: ({ signal }) => api.hotList(rank, signal), enabled: verified && tab === 'rank', staleTime: 30 * 60_000 });
  const bangumi = useQuery({ queryKey: ['bangumi-calendar'], queryFn: ({ signal }) => api.bangumiCalendar(signal), enabled: verified && calendar, staleTime: 30 * 60_000 });
  const items = useMemo(() => {
    const raw: DiscoverItem[] = tab === 'rank' ? (rankings.data?.items || []).map((v) => ({ ...v, kind: v.isTv ? 'tv' : 'movie' }))
      : calendar ? (bangumi.data?.days || []).flatMap((d) => d.items.map((v) => ({ ...v, kind: 'anime' as const, remarks: `周${'一二三四五六日'[d.weekday - 1]}放送` })))
      : (catalogue.data?.pages || []).flatMap((p) => p.items);
    return [...new Map(raw.map((v) => [v.id, v])).values()];
  }, [tab, calendar, rankings.data, bangumi.data, catalogue.data]);
  const query = tab === 'rank' ? rankings : calendar ? bangumi : catalogue;
  const changeTab = (id: Tab) => { setTab(id); setGenre(''); setArea(''); setYear(''); setCalendar(false); };
  const currentYear = new Date().getFullYear();
  return <section id="discover" className="discovery" aria-label="发现影视">
    <div className="discovery-heading"><div><h2>{tab === 'rank' ? '大家都在看' : '发现好故事'}</h2><p>{tab === 'rank' ? '跟着榜单，遇见下一部好剧。' : '总有一部，值得一起看。'}</p></div><span className="hidden sm:block text-xs text-faint">{tab === 'rank' ? '真实榜单 · 定时更新' : '电影与剧集 · 慢慢挑，慢慢看'}</span></div>
    <div className="discovery-tabs"><div className="discovery-tab-buttons" role="tablist" aria-label="影视分类">{TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={cn(tab === t.id && 'active')} onClick={() => changeTab(t.id)}>{t.label}</button>)}</div><Link href="/collection">三级／伦理 ↗</Link></div>
    {tab === 'rank' ? <div className="discovery-filters">{RANKS.map((r) => <button key={r.id} className={cn('filter-chip', rank === r.id && 'active')} aria-pressed={rank === r.id} onClick={() => setRank(r.id)}>{r.label}</button>)}</div> : <>
      {tab === 'anime' && <div className="flex gap-2 my-3"><button className={cn('filter-chip', !calendar && 'active')} onClick={() => setCalendar(false)}>动漫片库</button><button className={cn('filter-chip', calendar && 'active')} onClick={() => setCalendar(true)}>本周新番 · Bangumi</button></div>}
      {!calendar && <div className="discovery-filters">
        <span className="text-xs text-faint">类型</span><div className="genre-options">{['', ...GENRES[kind]].map((g) => <button key={g} className={cn('filter-chip', genre === g && 'active')} aria-pressed={genre === g} onClick={() => setGenre(g)}>{g || '全部'}</button>)}</div>
        <label className="filter-select"><span className="sr-only">地区</span><select value={area} onChange={(e) => setArea(e.target.value)} aria-label="地区"><option value="">全部地区</option>{(tab === 'anime' ? ['大陆','日本','欧美'] : ['大陆','香港','台湾','美国','日本','韩国','英国','泰国','法国']).map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="filter-select"><span className="sr-only">年代</span><select value={year} onChange={(e) => setYear(e.target.value)} aria-label="年代"><option value="">全部年代</option>{Array.from({ length: 47 }, (_, i) => currentYear - i).map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className="filter-select"><span className="sr-only">排序</span><select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="排序"><option value="rankhot">热度优先</option><option value="ranklatest">最近上映</option><option value="rankpoint">评分优先</option></select></label>
      </div>}
    </>}
    {!verified ? <div className="cinema-empty"><h3>欢迎回到你们的放映室</h3><p>登录后，选一部今天想一起看的。</p><button className="btn-primary" onClick={openLogin}>进入私人影院</button></div>
      : query.isLoading ? <div className="poster-grid" aria-label="正在加载影片">{Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />)}</div>
      : query.isError && !items.length ? <div className="cinema-empty" role="alert"><h3>片单暂时没有送达</h3><p>{query.error instanceof Error ? query.error.message : '请稍后重试；你仍然可以搜索影片。'}</p><button className="btn-ghost" onClick={() => void query.refetch()}>重新加载</button></div>
      : !items.length ? <div className="cinema-empty"><h3>这个组合暂时没有影片</h3><p>试试其他类型、地区或年代。</p><button className="btn-ghost" onClick={() => { setGenre(''); setArea(''); setYear(''); }}>重置筛选</button></div>
      : <><div className="poster-grid">{items.map((item, index) => <Poster key={item.id} item={item} rank={tab === 'rank' ? index + 1 : undefined} />)}</div>
      {tab !== 'rank' && !calendar && catalogue.hasNextPage && <div className="load-more"><button className="btn-ghost" disabled={catalogue.isFetchingNextPage} onClick={() => void catalogue.fetchNextPage()}>{catalogue.isFetchingNextPage ? '正在寻找更多好故事…' : catalogue.isFetchNextPageError ? '加载失败，重试' : '加载更多影片'}</button></div>}
      <p className="catalog-credit">{tab === 'rank' ? '榜单来自豆瓣 / 百度，经 60s API 提供' : calendar ? '放送信息来自 Bangumi' : '片单信息来自 360 影视 · 影片是否可播以搜索结果为准'}</p></>}
  </section>;
}
function Poster({ item, rank }: { item: DiscoverItem; rank?: number }) {
  const open = useFilmPreview();
  const mode = useAppStore((s) => s.imageProxyMode);
  const customProxy = useAppStore((s) => s.customImageProxy);
  return <button className="poster-card" onClick={() => open({ ...item, provider: item.provider || '360', providerId: item.providerId || item.id, kind: item.kind === 'hot' ? 'movie' : item.kind })} aria-label={`查看 ${item.title}`}>
    <div className="poster-art"><span className="poster-placeholder" aria-hidden>{item.title.slice(0, 1)}</span><SmartImage url={item.cover} mode={mode} customProxy={customProxy} alt={item.title} className="poster-image" />{item.rating && <span className="poster-rating">{item.rating}</span>}{rank && <span className="poster-rank">{String(rank).padStart(2, '0')}</span>}<span className="poster-hover" aria-hidden>查看详情 ↗</span></div>
    <h3>{item.title}</h3><p>{[item.year, item.area || ({ movie: '电影', tv: '剧集', anime: '动漫', variety: '综艺', hot: '' }[item.kind]), item.remarks || item.genre].filter(Boolean).join(' · ') || '点开寻找播放线路'}</p>
  </button>;
}
