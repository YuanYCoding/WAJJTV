'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { useAuth } from '@/components/auth';
import { useProfile } from '@/components/profile-context';
import { LibraryCard } from '@/components/library-card';
import { libraryApi, TONIGHT_KEY, SHARED_QUERY_OPTIONS } from '@/lib/library-client';

export default function TonightPage() {
  const { verified, openLogin } = useAuth();
  const { profile, openPicker } = useProfile();
  const client = useQueryClient();
  const round = useQuery({ queryKey: TONIGHT_KEY, queryFn: ({ signal }) => libraryApi.tonight(signal), enabled: verified, ...SHARED_QUERY_OPTIONS });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const draw = async () => {
    if (!profile) { openPicker(); return; }
    if (!round.data || pending) return;
    setPending(true); setError('');
    try { client.setQueryData(TONIGHT_KEY, await libraryApi.draw(round.data.version, round.data.exhausted)); }
    catch (err) { setError(err instanceof Error ? err.message : '选片失败'); await client.invalidateQueries({ queryKey: TONIGHT_KEY }); }
    finally { setPending(false); }
  };
  return <div className="min-h-screen flex flex-col"><Header /><main className="cinema-shell shared-page flex-1 w-full mx-auto">
    <header className="shared-page-heading"><div><h1>今晚看什么</h1><p>先看共同的心动，再聊聊彼此的期待。</p></div><Link href="/watchlist" className="btn-ghost">回到我们的片单</Link></header>
    {!verified ? <div className="cinema-empty"><h2>从你们的共同片单开始</h2><p>登录后，一起决定今晚看什么。</p><button className="btn-primary" onClick={openLogin}>登录选片</button></div> : <>
      <div className="tonight-intro"><div><strong>三部以内，刚刚好。</strong><p>优先选双方都想看的；待另一人表态的影片会明确标注。</p><p>看过、不感兴趣和独立分类的影片，不会进入今晚候选。</p></div><button className="btn-primary" disabled={pending || !round.data || !round.data.eligibleCount} onClick={() => void draw()}>{pending ? '正在选片…' : round.data?.exhausted ? '重新抽一轮' : round.data?.version ? '换一批' : '帮我们选三部'}</button></div>
      {(error || round.isError) && <p className="sync-error" role="alert">{error || '暂时无法同步今晚候选'}<button className="text-accent ml-3" onClick={() => void round.refetch()}>刷新结果</button></p>}
      {round.isLoading ? <p className="cinema-empty" role="status">正在同步今晚的候选…</p> : round.data?.items.length ? <><div className="tonight-grid">{round.data.items.map((item) => <article className="tonight-candidate" key={item.film.id}><p className={item.reason === 'both' ? 'both-reason' : 'pending-reason'}>{item.reason === 'both' ? '♡ 两个人都想看' : item.reason === 'haiqing' ? '海清想看 · 待静静确认' : '静静想看 · 待海清确认'}</p><LibraryCard film={item.film} states={item.states} /></article>)}</div><p className="catalog-credit">{round.data.day} · 你们看到同一组候选 · 换一批不会修改片单</p></> : <div className="cinema-empty"><h2>{round.data?.eligibleCount ? '今晚的候选，等你们来揭晓' : '先存下几部想一起看的电影吧'}</h2><p>{round.data?.eligibleCount ? '点击上方按钮，从你们的片单里选出最多三部。' : '一方想看、另一方尚未表态，也可以成为候选。'}</p><Link href="/watchlist" className="btn-ghost">看看我们的片单</Link></div>}
    </>}
  </main><SiteFooter /></div>;
}
