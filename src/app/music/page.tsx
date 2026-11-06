'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { MusicArt, useMusic } from '@/components/music-provider';
import { MUSIC_SOURCES, musicKey, musicSourceName, musicTime, type MusicOutcome, type MusicTrack } from '@/lib/music-types';
import { Icon } from '@/components/icon';

export default function MusicPage() { return <Suspense><MusicRoom /></Suspense>; }
function MusicRoom() {
  const m = useMusic(), params = useSearchParams(), router = useRouter(), q = params.get('q') || '', page = Math.min(10, Math.max(1, Number(params.get('page')) || 1));
  const [input, setInput] = useState(q), [filter, setFilter] = useState('all'), [liked, setLiked] = useState(false), [partial, setPartial] = useState<MusicOutcome[]>([]), [feedback, setFeedback] = useState('');
  const enabledKey = m.enabled.join(',');
  useEffect(() => setInput(q), [q]);
  const search = useQuery({
    queryKey: ['music-search', q, page, enabledKey], enabled: Boolean(q && enabledKey), staleTime: 300_000, retry: false,
    queryFn: async ({ signal }) => {
      setPartial([]);
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(q)}&page=${page}&sources=${enabledKey}`, { signal });
      if (!res.ok || !res.body) { const d = await res.json(); throw new Error(d.error || '音乐搜索暂不可用'); }
      const reader = res.body.getReader(), decoder = new TextDecoder(), results: MusicOutcome[] = []; let pending = '';
      const accept = (line: string) => { if (!line.trim()) return; const row = JSON.parse(line) as MusicOutcome; results.push(row); if (!signal.aborted) setPartial([...results]); };
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; pending += decoder.decode(value, { stream: true }); const lines = pending.split('\n'); pending = lines.pop() || ''; lines.forEach(accept); } pending += decoder.decode(); accept(pending); }
      finally { reader.releaseLock(); }
      return results;
    },
  });
  const outcomes = useMemo(() => search.isFetching ? partial : search.data || [], [search.isFetching, partial, search.data]);
  const tracks = useMemo(() => outcomes.flatMap(o => o.tracks), [outcomes]);
  const list = (liked ? m.favorites : tracks).filter(t => filter === 'all' || t.source === filter);
  const likes = new Set(m.favorites.map(musicKey));
  const submit = (value: string) => { const text = value.trim().slice(0, 100); if (!text) return; setInput(text); setLiked(false); setFilter('all'); router.push(`/music?q=${encodeURIComponent(text)}`); };
  const play = (t: MusicTrack) => { setFeedback(''); void m.play(t, list); };
  return <div className="min-h-screen flex flex-col music-page"><Header /><main className="cinema-shell mx-auto w-full flex-1">
    <section className="music-hero"><div><h1>今天，想听什么？</h1><span className="music-sage-line" aria-hidden="true" /><form className="music-search" onSubmit={e => { e.preventDefault(); submit(input); }}><Icon name="search" /><input type="search" aria-label="搜索音乐" value={input} onChange={e => setInput(e.target.value)} maxLength={100} placeholder="歌曲、歌手、专辑" /><button className="btn-primary" disabled={!input.trim() || !m.enabled.length}>搜索</button></form><div className="music-suggestions">{['周杰伦', '陈奕迅', '孙燕姿', '夜曲', '轻音乐'].map(s => <button key={s} onClick={() => submit(s)}>{s}</button>)}</div></div><div className={`vinyl-record ${m.playing ? 'vinyl-playing' : ''}`} aria-hidden="true"><span>J & J<small>OUR SOUNDTRACK</small></span></div></section>
    <div className="music-toolbar"><div className="music-source-tabs" aria-label="音乐来源筛选"><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部</button>{MUSIC_SOURCES.map(s => <button key={s.id} aria-pressed={filter === s.id} onClick={() => setFilter(s.id)}>{s.name}{q && <small>{tracks.filter(t => t.source === s.id).length || ''}</small>}</button>)}</div><button className={`music-my-likes ${liked ? 'active' : ''}`} aria-pressed={liked} onClick={() => setLiked(v => !v)}>♡ 我的喜欢 {m.favorites.length || ''}</button></div>
    {!m.enabled.length && <p role="alert" className="music-feedback">音源尚未启用，请在设置 → 源管理 → 音乐源中启用。</p>}
    <div className="music-content"><section className="music-results" aria-label="歌曲列表"><div className="music-list-heading"><h2>{liked ? '我的喜欢' : q ? `“${q}”` : '从一首喜欢的歌开始'}</h2><span role="status">{search.isFetching ? `正在搜索 · 已找到 ${tracks.length} 首` : liked ? `${list.length} 首 · 保存在此设备` : q ? `${list.length} 首` : '给今天一点背景音乐'}</span></div>
      {search.error && !liked && <div className="music-feedback" role="alert">{search.error.message}<button onClick={() => void search.refetch()}>重试搜索</button></div>}
      {list.length ? <><div className="music-table-head"><span>歌曲 / 歌手</span><span>专辑</span><span>时长</span><span>操作</span></div><div>{list.map(t => <div className={`music-song-row ${m.track && musicKey(m.track) === musicKey(t) ? 'selected' : ''}`} key={musicKey(t)}><button className="music-song-main" aria-label={`播放 ${t.title} ${t.artist}`} onClick={() => play(t)}><span className="music-row-play">{m.track && musicKey(m.track) === musicKey(t) && m.playing ? 'Ⅱ' : '▶'}</span><MusicArt track={t} /><span className="music-song-title"><strong>{t.title}</strong><small>{t.artist || '未知歌手'}<em>{musicSourceName(t.source)}{t.preview ? ' · 试听' : ''}</em></small></span></button><span className="music-album" title={t.album}>{t.album || '暂无专辑信息'}</span><span className="music-song-time">{t.duration ? musicTime(t.duration) : '--:--'}</span><span className="music-row-actions"><button aria-label={likes.has(musicKey(t)) ? `取消喜欢 ${t.title}` : `喜欢 ${t.title}`} className={likes.has(musicKey(t)) ? 'active' : ''} onClick={() => m.favorite(t)}>{likes.has(musicKey(t)) ? '♥' : '♡'}</button><button aria-label={`加入队列 ${t.title}`} onClick={() => { m.enqueue(t); setFeedback(`已将「${t.title}」加入待播队列`); }}>＋</button></span></div>)}</div></> : <div className="music-empty"><span aria-hidden="true">♫</span><h3>{search.isFetching && !liked ? '正在寻找好音乐…' : liked ? '把喜欢的旋律留在这里' : q ? '这个来源暂时没有结果' : '音乐响起，就是我们的时间'}</h3><p>{liked ? '点击歌曲旁的爱心，下次就能在这里找到。' : q ? '换一个歌手、歌名，或切换到其他来源试试。' : '搜索歌曲或歌手，选择一首开始播放。'}</p></div>}
      {q && !liked && !search.isFetching && tracks.length > 0 && <div className="music-pagination"><button disabled={page <= 1} onClick={() => router.push(`/music?q=${encodeURIComponent(q)}&page=${page - 1}`)}>上一页</button><span>第 {page} 页</span><button disabled={page >= 10} onClick={() => router.push(`/music?q=${encodeURIComponent(q)}&page=${page + 1}`)}>下一页</button></div>}
      {!liked && outcomes.some(s => s.error) && <details className="music-source-errors"><summary>部分来源暂不可用 · 其他结果不受影响</summary>{outcomes.filter(s => s.error).map(s => <p key={s.source}>{musicSourceName(s.source)}：{s.error}</p>)}</details>}
      <p className="music-feedback" role="status">{feedback}</p><details className="music-caption"><summary>播放说明</summary><p>Apple 仅试听。音频可用性、音质与完整时长以来源为准。</p></details>
    </section><aside className="music-queue" aria-label="待播队列"><div className="music-queue-heading"><h2>下一首</h2><span>{m.queue.length} 首</span></div><label className="music-mode-label">播放方式<select aria-label="播放方式" value={m.mode} onChange={e => m.setMode(e.target.value as typeof m.mode)}><option value="sequence">顺序播放</option><option value="repeat">单曲循环</option><option value="shuffle">随机播放</option></select></label>{m.queue.length ? <><ol>{m.queue.map(t => <li key={musicKey(t)}><button className={m.track && musicKey(m.track) === musicKey(t) ? 'active' : ''} onClick={() => void m.play(t)}><span aria-hidden="true">▷</span><span><strong>{t.title}</strong><small>{t.artist || '未知歌手'}</small></span></button></li>)}</ol><button className="music-clear-queue" onClick={m.clearQueue}>清空待播队列</button></> : <div className="music-queue-empty">暂无待播歌曲</div>}</aside></div>
  </main><SiteFooter /></div>;
}
