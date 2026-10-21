'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Drawer } from './drawer';
import { SmartImage } from './smart-image';
import { useAuth } from './auth';
import { useProfile } from './profile-context';
import { useToast } from './toast';
import { useAppStore } from '@/lib/store';
import { addSearchHistory } from '@/lib/db';
import { libraryApi, LibraryClientError, LIBRARY_KEY, PROFILE_KEY, TONIGHT_KEY, SHARED_QUERY_OPTIONS } from '@/lib/library-client';
import { profileName, type FilmInput, type LibraryFilm, type LibraryItem, type LibraryResponse, type Preference } from '@/lib/library-types';

const PreviewContext = createContext<(film: FilmInput | LibraryFilm) => void>(() => {});
export const useFilmPreview = () => useContext(PreviewContext);
export function useSharedLibrary() {
  const { verified } = useAuth();
  return useQuery({ queryKey: LIBRARY_KEY, queryFn: ({ signal }) => libraryApi.list(signal), enabled: verified, ...SHARED_QUERY_OPTIONS });
}
function matches(item: LibraryItem, film: FilmInput | LibraryFilm) {
  return ('id' in film && item.film.id === film.id) || item.aliases.some((a) => a.provider === film.provider && a.providerId === film.providerId && a.kind === film.kind);
}
export function FilmPreviewProvider({ children }: { children: ReactNode }) {
  const [film, setFilm] = useState<FilmInput | LibraryFilm | null>(null);
  const { verified } = useAuth();
  const { profile, openPicker } = useProfile();
  useEffect(() => { if (!verified) setFilm(null); }, [verified]);
  return <PreviewContext.Provider value={(item) => { if (!profile) { openPicker(); return; } setFilm(item); }}>{children}<Drawer open={!!film} onClose={() => setFilm(null)} title={film?.title || '影片详情'} width="max-w-xl">{film && <PreviewBody key={`${film.provider}:${film.kind}:${film.providerId}`} film={film} onClose={() => setFilm(null)} />}</Drawer></PreviewContext.Provider>;
}
function PreviewBody({ film, onClose }: { film: FilmInput | LibraryFilm; onClose: () => void }) {
  const router = useRouter();
  const library = useSharedLibrary();
  const saved = library.data?.items.find((item) => matches(item, film));
  const displayed = saved?.film || film;
  const classification = 'classification' in displayed ? displayed.classification : undefined;
  const mode = useAppStore((s) => s.imageProxyMode);
  const customProxy = useAppStore((s) => s.customImageProxy);
  return <div className="film-preview">
    <div className="film-preview-top"><div className="preview-poster"><span aria-hidden>{displayed.title[0]}</span><SmartImage url={displayed.cover} mode={mode} customProxy={customProxy} alt={displayed.title} className="poster-image" loading="eager" /></div><div><h3>{displayed.title}</h3><p>{[displayed.year || '年份暂无', displayed.area || '地区暂无'].join(' · ')}</p><p>{displayed.genre || '类型暂无'}</p><p>{displayed.durationMinutes ? `${displayed.durationMinutes} 分钟` : '时长暂无'}</p><p className="preview-rating">{displayed.rating ? `${displayed.rating} 分` : '评分暂无'}</p><p className="text-xs text-faint">影片资料与播放线路分别提供</p></div></div>
    <section className="preview-section"><h4>故事简介</h4><p>{displayed.synopsis || '暂无简介。可以先加入片单，或搜索已有播放线路。'}</p></section>
    <dl className="preview-credits"><dt>导演</dt><dd>{displayed.directors?.join(' / ') || '暂无'}</dd><dt>演员</dt><dd>{displayed.actors?.join(' / ') || '暂无'}</dd></dl>
    {classification && <div className="classification-note"><strong>{classification.label}</strong><p>{classification.basis}</p><a href={classification.sourceUrl} target="_blank" rel="noopener noreferrer">查看分类依据 ↗</a><span>核实于 {classification.verifiedAt}</span></div>}
    <PreferenceControls film={film} saved={saved} />
    <button className="btn-primary w-full mt-6 py-3" onClick={() => { void addSearchHistory(displayed.title).catch(() => {}); onClose(); router.push(`/?s=${encodeURIComponent(displayed.title)}`); }}>搜索播放</button><p className="text-xs text-faint text-center mt-2">搜索可用片源后再选择播放线路</p>
  </div>;
}
function PreferenceControls({ film, saved }: { film: FilmInput | LibraryFilm; saved?: LibraryItem }) {
  const { profile, openPicker } = useProfile();
  const { verified, openLogin } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [optimistic, setOptimistic] = useState<Preference | undefined>();
  const [matchesToConfirm, setMatchesToConfirm] = useState<LibraryItem[] | null>(null);
  const [queued, setQueued] = useState<Preference>(null);
  const [error, setError] = useState('');
  const current = profile ? saved?.states[profile] || null : null;
  const shown = optimistic === undefined ? current : optimistic;
  const save = async (status: Preference, decision?: 'separate' | 'link', existingId?: string) => {
    if (!verified) { openLogin(); return; }
    if (!profile) { openPicker(); return; }
    if (pending) return;
    const actor = profile;
    setPending(true); setOptimistic(status); setError(''); setQueued(status);
    try {
      const resolved = saved && !decision ? saved : (await libraryApi.resolve(film, decision, existingId)).item;
      const { item } = await libraryApi.preference(resolved.film.id, status, resolved.revisions[actor], actor);
      client.setQueryData<LibraryResponse>(LIBRARY_KEY, (old) => {
        const previous = old?.items.find((x) => x.film.id === item.film.id);
        if (previous) for (const key of ['haiqing', 'jingjing'] as const) if (previous.revisions[key] > item.revisions[key]) { item.revisions[key] = previous.revisions[key]; item.states[key] = previous.states[key]; }
        const rest = (old?.items || []).filter((x) => x.film.id !== item.film.id);
        return { items: item.states.haiqing || item.states.jingjing ? [item, ...rest] : rest };
      });
      setMatchesToConfirm(null);
      await Promise.all([client.invalidateQueries({ queryKey: LIBRARY_KEY }), client.invalidateQueries({ queryKey: TONIGHT_KEY })]);
      toast(`已更新${profileName(actor)}的片单`, 'success');
    } catch (err) {
      if (err instanceof LibraryClientError && err.code === 'MATCH_CONFIRMATION') setMatchesToConfirm(err.details || []);
      else { setError(err instanceof Error ? err.message : '保存失败'); void client.invalidateQueries({ queryKey: LIBRARY_KEY }); if (err instanceof LibraryClientError && err.code === 'PROFILE_CHANGED') void client.invalidateQueries({ queryKey: PROFILE_KEY }); }
    } finally { setPending(false); setOptimistic(undefined); }
  };
  return <section className="preference-section"><h4>{profile ? `记录到${profileName(profile)}的片单` : '加入你们的片单'}</h4>
    <div className="preference-buttons">{([{ state: 'want', text: '想看', icon: '♡' }, { state: 'watched', text: '看过', icon: '✓' }, { state: 'dismissed', text: '不感兴趣', icon: '−' }] as const).map((p) => <button key={p.state} disabled={pending} aria-pressed={shown === p.state} className={shown === p.state ? 'active' : ''} onClick={() => void save(current === p.state ? null : p.state)}><span aria-hidden>{p.icon}</span>{p.text}</button>)}</div>
    {saved && <p className="text-xs text-muted mt-3">海清：{stateText(saved.states.haiqing)} · 静静：{stateText(saved.states.jingjing)}</p>}
    {pending && <p className="text-xs text-accent mt-3" role="status">正在保存…</p>}{error && <p className="text-sm text-danger mt-3" role="alert">{error}</p>}
    {matchesToConfirm && <div className="match-confirmation"><h5>片单里可能已有这部影片</h5><p>请确认是否为同一部；同名翻拍作品可以单独保存。</p>{matchesToConfirm.map((item) => <button key={item.film.id} className="btn-ghost w-full mt-2 justify-between" disabled={pending} onClick={() => void save(queued, 'link', item.film.id)}><span>{item.film.title} · {item.film.year || '年份暂无'}</span><span>关联这部</span></button>)}<div className="flex gap-2 mt-3"><button className="btn-primary" disabled={pending} onClick={() => void save(queued, 'separate')}>按另一部保存</button><button className="btn-ghost" disabled={pending} onClick={() => setMatchesToConfirm(null)}>取消</button></div></div>}
    <p className="text-xs text-faint mt-3">再次点击可取消标记；两个人的记录分别保存。</p>
  </section>;
}
export function stateText(value: Preference) { return value === 'want' ? '想看' : value === 'watched' ? '看过' : value === 'dismissed' ? '不感兴趣' : '待表态'; }
