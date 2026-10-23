'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { useAuth } from '@/components/auth';
import { useProfile } from '@/components/profile-context';
import { useSharedLibrary } from '@/components/film-preview';
import { LibraryCard } from '@/components/library-card';
import { cn } from '@/lib/utils';

const FILTERS = [{ id: 'all', name: '全部想看' }, { id: 'both', name: '都想看' }, { id: 'haiqing', name: '海清想看' }, { id: 'jingjing', name: '静静想看' }, { id: 'watched', name: '我看过' }, { id: 'dismissed', name: '不感兴趣' }] as const;
export default function WatchlistPage() {
  const { verified, openLogin } = useAuth();
  const { profile } = useProfile();
  const library = useSharedLibrary();
  const [filter, setFilter] = useState<typeof FILTERS[number]['id']>('all');
  const [search, setSearch] = useState('');
  const all = library.data?.items || [];
  const items = all.filter((v) => {
    if (!v.film.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) return false;
    if (filter === 'both') return v.states.haiqing === 'want' && v.states.jingjing === 'want';
    if (filter === 'haiqing' || filter === 'jingjing') return v.states[filter] === 'want';
    if (filter === 'watched' || filter === 'dismissed') return profile ? v.states[profile] === filter : false;
    return v.states.haiqing === 'want' || v.states.jingjing === 'want';
  });
  return <div className="min-h-screen flex flex-col"><Header /><main className="cinema-shell shared-page flex-1 w-full mx-auto">
    <header className="shared-page-heading"><div><h1>我们的片单</h1><p>你的一点心动，我也想看看。</p></div><Link className="btn-primary" href="/tonight">今晚看什么 ↗</Link></header>
    {!verified ? <div className="cinema-empty"><h2>把想看的故事，留给两个人</h2><p>登录后查看你们的片单。</p><button className="btn-primary" onClick={openLogin}>登录查看</button></div> : <>
      <div className="library-toolbar"><div className="library-filters">{FILTERS.map((f) => <button key={f.id} aria-pressed={filter === f.id} className={cn('filter-chip', filter === f.id && 'active')} onClick={() => setFilter(f.id)}>{f.name}</button>)}</div><input className="input" aria-label="搜索片单" placeholder="在片单中找一找…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {library.isError && <div className="sync-error" role="alert">同步失败{library.data ? '，正在展示上次保存的片单' : ''}。<button className="text-accent ml-2" onClick={() => void library.refetch()}>重试</button></div>}
      {library.isLoading ? <p className="cinema-empty" role="status">正在打开你们的片单…</p> : items.length ? <><p className="library-count">{items.length} 部影片 · 两个人的记录分别保存</p><div className="poster-grid">{items.map((item) => <LibraryCard key={item.film.id} film={item.film} states={item.states} />)}</div></> : <div className="cinema-empty"><h2>{search ? '没有找到这部影片' : filter === 'both' ? '共同的好故事，从一次“想看”开始' : '这里还没有影片'}</h2><p>{filter === 'both' ? '两个人都标记想看的影片，会在这里相遇。' : '在影片详情中标记想看、看过或不感兴趣。'}</p><Link href="/" className="btn-ghost">去发现好故事</Link></div>}
    </>}
  </main><SiteFooter /></div>;
}
