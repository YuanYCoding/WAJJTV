'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { LibraryCard } from '@/components/library-card';
import { useAuth } from '@/components/auth';
import { libraryApi } from '@/lib/library-client';
import { cn } from '@/lib/utils';

export default function CollectionPage() {
  const { verified, openLogin } = useAuth();
  const [section, setSection] = useState<'all' | 'ethics' | 'hk-iii'>('all');
  const query = useQuery({ queryKey: ['curated-films'], queryFn: ({ signal }) => libraryApi.curated(signal), enabled: verified, staleTime: 3600_000 });
  const items = (query.data?.items || []).filter((v) => section === 'all' || v.classification?.section === section);
  return <div className="min-h-screen flex flex-col"><Header /><main className="cinema-shell shared-page flex-1 w-full mx-auto">
    <header className="shared-page-heading"><div><h1>三级／伦理</h1><p>关于关系、选择与人性，独立整理的剧情长片。</p></div></header>
    <div className="collection-note"><p>“伦理”是题材，“III 级”是香港电影分级，两者分别标注。</p><p>点开影片可查看分类依据。这些精选条目不进入普通首页和今晚选片。</p></div>
    <div className="library-filters mb-6">{[{ id: 'all', name: '全部精选' }, { id: 'ethics', name: '剧情向伦理电影' }, { id: 'hk-iii', name: '香港 III 级' }].map((v) => <button key={v.id} className={cn('filter-chip', section === v.id && 'active')} aria-pressed={section === v.id} onClick={() => setSection(v.id as typeof section)}>{v.name}</button>)}</div>
    {!verified ? <div className="cinema-empty"><h2>登录后查看独立片单</h2><p>每个条目都保留资料来源与分类依据。</p><button className="btn-primary" onClick={openLogin}>登录查看</button></div> : query.isLoading ? <p className="cinema-empty" role="status">正在整理精选影片…</p> : query.isError ? <div className="cinema-empty" role="alert"><p>片单加载失败，请稍后重试。</p><button className="btn-ghost" onClick={() => void query.refetch()}>重试</button></div> : <div className="poster-grid collection-grid">{items.map((film) => <LibraryCard key={film.providerId} film={film} />)}</div>}
  </main><SiteFooter /></div>;
}
