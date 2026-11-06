import { describe, expect, it } from 'vitest';
import { normalizeDiscoverItem } from './discover';
describe('discovery metadata', () => {
  it('normalizes provider data without inventing ratings or quality', () => {
    expect(normalizeDiscoverItem({ id: 'a', title: '<b>好电影</b>', cdncover: '//p0.qhimg.com/a.jpg', score: 0, pubdate: '2026-01-01', area: ['大陆'], moviecategory: ['剧情'] }, 'movie')).toMatchObject({ id: 'movie:a', title: '好电影', cover: 'https://p0.qhimg.com/a.jpg', rating: undefined, year: '2026', genre: '剧情' });
  });
  it('drops adult categories and rejects non-http artwork', () => {
    expect(normalizeDiscoverItem({ id: 'a', title: '测试', moviecategory: ['伦理'] }, 'movie')).toBeUndefined();
    expect(normalizeDiscoverItem({ id: 'b', title: '测试', cover: 'javascript:alert(1)' }, 'tv')?.cover).toBe('');
  });
  it('keeps verified independent selections out of ordinary discovery without blocking a remake', () => {
    expect(normalizeDiscoverItem({ id: 'film', title: '步履不停', pubdate: '2008-06-28' }, 'movie')).toBeUndefined();
    expect(normalizeDiscoverItem({ id: 'other', title: '步履不停', pubdate: '2026-01-01' }, 'movie')).toBeDefined();
  });
});
