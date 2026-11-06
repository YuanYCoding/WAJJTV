'use client';
import { SmartImage } from './smart-image';
import { useFilmPreview, stateText } from './film-preview';
import { useAppStore } from '@/lib/store';
import type { FilmInput, LibraryFilm, LibraryItem } from '@/lib/library-types';

export function LibraryCard({ film, states }: { film: FilmInput | LibraryFilm; states?: LibraryItem['states'] }) {
  const open = useFilmPreview();
  const mode = useAppStore((s) => s.imageProxyMode);
  const proxy = useAppStore((s) => s.customImageProxy);
  return <article className="library-card">
    <button className="poster-card w-full" aria-label={`查看 ${film.title}`} onClick={() => open(film)}>
      <div className="poster-art"><span className="poster-placeholder" aria-hidden>{film.title[0]}</span><SmartImage url={film.cover} mode={mode} customProxy={proxy} alt={film.title} className="poster-image" />{film.rating && <span className="poster-rating">{film.rating}</span>}<span className="poster-hover" aria-hidden>查看详情 ↗</span></div>
      <h3>{film.title}</h3><p>{[film.year, film.area || film.genre].filter(Boolean).join(' · ') || '查看影片资料'}</p>
    </button>
    {states && <div className="card-preferences"><span className={states.haiqing === 'want' ? 'selected' : ''}>海清 · {stateText(states.haiqing)}</span><span className={states.jingjing === 'want' ? 'selected' : ''}>静静 · {stateText(states.jingjing)}</span></div>}
    {film.classification && <p className="text-xs text-accent mt-2">{film.classification.label}</p>}
  </article>;
}
