import type { Classification, FilmInput } from './library-types';
import { normalizeFilmTitle } from './library-types';

export interface CuratedFilm extends FilmInput { classification: Classification; aliases: string[] }
export const CURATED_FILMS: CuratedFilm[] = [
  {
    provider: 'curated', providerId: 'history-of-violence-2005', kind: 'movie', title: '暴力史', year: '2005',
    directors: ['大卫·柯南伯格'], actors: ['维果·莫腾森', '玛丽亚·贝罗'], area: '美国', genre: '剧情 / 犯罪', durationMinutes: 96,
    synopsis: '一个小镇家庭的平静生活，被一次意外和男主人不愿提起的过去打破。影片围绕身份、暴力与家庭信任展开。',
    aliases: ['暴力史', '暴力效应', '暴力效應', 'A History of Violence'],
    classification: { section: 'hk-iii', label: '香港 III 级', basis: '香港国际电影节 2026 年放映资料标为 III 级，分级依据对应页面所列放映版本。', sourceUrl: 'https://cinefan.hkiff.org.hk/zh/movie/a-history-of-violence-26', verifiedAt: '2026-10-21' },
  },
  {
    provider: 'curated', providerId: 'tale-of-cinema-2005', kind: 'movie', title: '剧场前', year: '2005',
    directors: ['洪常秀'], actors: ['金相庆', '严智媛', '李己雨'], area: '韩国', genre: '剧情', durationMinutes: 89,
    synopsis: '银幕上的故事与现实中的相遇相互映照，一个电影人的情感投射让虚构和生活的界限变得模糊。',
    aliases: ['剧场前', '劇場前', '站在剧院前', '站在劇院前', 'Tale of Cinema'],
    classification: { section: 'hk-iii', label: '香港 III 级', basis: '香港国际电影节 2026 年放映资料标为 III 级，分级依据对应页面所列放映版本。', sourceUrl: 'https://cinefan.hkiff.org.hk/zh/movie/tale-of-cinema-26', verifiedAt: '2026-10-21' },
  },
  {
    provider: 'curated', providerId: 'still-walking-2008', kind: 'movie', title: '步履不停', year: '2008',
    directors: ['是枝裕和'], actors: ['阿部宽', '夏川结衣', '树木希林'], area: '日本', genre: '剧情 / 家庭', durationMinutes: 114,
    synopsis: '一次家庭聚会，让两代人之间未曾说出口的遗憾、关心与矛盾，在日常细节里慢慢浮现。',
    aliases: ['步履不停', '歩いても歩いても', 'Still Walking'],
    classification: { section: 'ethics', label: '家庭伦理 · 编辑精选', basis: '依据发行方对家庭关系与代际情感的剧情介绍归类；这不是年龄分级。', sourceUrl: 'https://www.criterion.com/films/27540-still-walking', verifiedAt: '2026-10-21' },
  },
  {
    provider: 'curated', providerId: 'a-separation-2011', kind: 'movie', title: '一次别离', year: '2011',
    directors: ['阿斯哈·法哈蒂'], actors: ['佩曼·莫阿迪', '蕾拉·哈塔米'], area: '伊朗', genre: '剧情 / 家庭',
    synopsis: '一对夫妻对于离开还是留下的分歧，与照护、家庭责任和不同人的处境交织，逐渐成为难以简单判断的道德困境。',
    aliases: ['一次别离', '一次別離', 'A Separation'],
    classification: { section: 'ethics', label: '家庭伦理 · 编辑精选', basis: '依据发行方剧情资料中的家庭责任与道德冲突归类；这不是年龄分级。', sourceUrl: 'https://www.sonyclassics.com/aseparation/synopsis.html', verifiedAt: '2026-10-21' },
  },
];

export function curatedMatch(film: Pick<FilmInput, 'provider' | 'providerId' | 'title' | 'year' | 'kind'>): CuratedFilm | undefined {
  if (film.provider === 'curated') return CURATED_FILMS.find((v) => v.providerId === film.providerId);
  if (film.kind !== 'movie' || !film.year) return undefined;
  const title = normalizeFilmTitle(film.title);
  return CURATED_FILMS.find((v) => v.year === film.year && v.aliases.some((a) => normalizeFilmTitle(a) === title));
}
