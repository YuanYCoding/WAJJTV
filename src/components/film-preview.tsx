'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Drawer } from './drawer';
import { SmartImage } from './smart-image';
import { useAuth } from './auth';
import { useAppStore } from '@/lib/store';
import { addSearchHistory } from '@/lib/db';
import { libraryApi, LIBRARY_KEY, SHARED_QUERY_OPTIONS } from '@/lib/library-client';
import { type FilmInput, type LibraryFilm, type Preference } from '@/lib/library-types';

const PreviewContext = createContext<(film: FilmInput | LibraryFilm) => void>(() => {});
export const useFilmPreview = () => useContext(PreviewContext);
export function useSharedLibrary() {
  const { verified } = useAuth();
  return useQuery({ queryKey: LIBRARY_KEY, queryFn: ({ signal }) => libraryApi.list(signal), enabled: verified, ...SHARED_QUERY_OPTIONS });
}
export function FilmPreviewProvider({ children }: { children: ReactNode }) {
  const [film, setFilm] = useState<FilmInput | LibraryFilm | null>(null);
  const { verified } = useAuth();
  useEffect(() => { if (!verified) setFilm(null); }, [verified]);
  return <PreviewContext.Provider value={(item) => { setFilm(item); }}>{children}<Drawer open={!!film} onClose={() => setFilm(null)} title={film?.title || '影片详情'} width="max-w-xl">{film && <PreviewBody key={`${film.provider}:${film.kind}:${film.providerId}`} film={film} onClose={() => setFilm(null)} />}</Drawer></PreviewContext.Provider>;
}
function PreviewBody({ film, onClose }: { film: FilmInput | LibraryFilm; onClose: () => void }) {
  const router = useRouter();
  const displayed = film;
  const classification = 'classification' in displayed ? displayed.classification : undefined;
  const mode = useAppStore((s) => s.imageProxyMode);
  const customProxy = useAppStore((s) => s.customImageProxy);
  return <div className="film-preview">
    <div className="film-preview-top"><div className="preview-poster"><span aria-hidden>{displayed.title[0]}</span><SmartImage url={displayed.cover} mode={mode} customProxy={customProxy} alt={displayed.title} className="poster-image" loading="eager" /></div><div><h3>{displayed.title}</h3><p>{[displayed.year || '年份暂无', displayed.area || '地区暂无'].join(' · ')}</p><p>{displayed.genre || '类型暂无'}</p><p>{displayed.durationMinutes ? `${displayed.durationMinutes} 分钟` : '时长暂无'}</p><p className="preview-rating">{displayed.rating ? `${displayed.rating} 分` : '评分暂无'}</p><p className="text-xs text-faint">影片资料与播放线路分别提供</p></div></div>
    <section className="preview-section"><h4>故事简介</h4><p>{displayed.synopsis || '暂无简介。可以搜索已有播放线路。'}</p></section>
    <dl className="preview-credits"><dt>导演</dt><dd>{displayed.directors?.join(' / ') || '暂无'}</dd><dt>演员</dt><dd>{displayed.actors?.join(' / ') || '暂无'}</dd></dl>
    {classification && <div className="classification-note"><strong>{classification.label}</strong><p>{classification.basis}</p><a href={classification.sourceUrl} target="_blank" rel="noopener noreferrer">查看分类依据 ↗</a><span>核实于 {classification.verifiedAt}</span></div>}
    <button className="btn-primary w-full mt-6 py-3" onClick={() => { void addSearchHistory(displayed.title).catch(() => {}); onClose(); router.push(`/?s=${encodeURIComponent(displayed.title)}`); }}>搜索播放</button><button className="btn-ghost w-full mt-2 py-2" onClick={() => { onClose(); router.push(`/pan?q=${encodeURIComponent(displayed.title)}`); }}>找网盘高清资源</button><p className="text-xs text-faint text-center mt-2">搜索可用片源后再选择播放线路</p>
  </div>;
}
export function stateText(value: Preference) { return value === 'want' ? '想看' : value === 'watched' ? '看过' : value === 'dismissed' ? '不感兴趣' : '待表态'; }
