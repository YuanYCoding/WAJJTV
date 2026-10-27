import { describe, expect, it } from 'vitest';
import { baiduTeleplayToItem, doubanWeeklyToItem, isHotListId } from './douban-weekly';

describe('isHotListId', () => {
  it('白名单校验', () => {
    expect(isHotListId('douban_movie_weekly')).toBe(true);
    expect(isHotListId('baidu_teleplay')).toBe(true);
    expect(isHotListId('maoyan')).toBe(false);
    expect(isHotListId('')).toBe(false);
  });
});

describe('doubanWeeklyToItem', () => {
  it('评分、封面（原生地址优先）、isTv 正确映射', () => {
    const item = doubanWeeklyToItem(
      {
        id: 36808876,
        title: '奥德赛',
        rating: 8.6,
        cover_proxy: 'https://doubanio.viki.moe/view/photo/p1.jpg',
        cover: 'https://img9.doubanio.com/view/photo/p1.jpg',
      },
      false
    );
    // 原生 doubanio 地址命中图片代理白名单并带 Referer 伪装，优先于 cover_proxy 镜像
    expect(item).toEqual({
      provider: 'douban', providerId: '36808876', year: undefined, synopsis: undefined, area: undefined, genre: undefined, actors: undefined, directors: undefined,
      id: '36808876',
      title: '奥德赛',
      cover: 'https://img9.doubanio.com/view/photo/p1.jpg',
      rating: '8.6',
      isTv: false,
    });
  });

  it('原生 cover 缺失时回退 cover_proxy，0 分不输出 rating', () => {
    const item = doubanWeeklyToItem(
      { id: 2, title: 'y', cover_proxy: 'https://doubanio.viki.moe/view/photo/p2.jpg' },
      true
    );
    expect(item).toMatchObject({ cover: 'https://doubanio.viki.moe/view/photo/p2.jpg', isTv: true });
    const zero = doubanWeeklyToItem({ id: 1, title: 'x', cover: 'c', rating: 0 }, true);
    expect(zero).toMatchObject({ cover: 'c', isTv: true });
    expect(zero?.rating).toBeUndefined();
  });

  it('缺 id、标题或封面的脏数据丢弃', () => {
    expect(doubanWeeklyToItem({ title: 'x', cover: 'c' }, false)).toBeUndefined();
    expect(doubanWeeklyToItem({ id: 1, cover: 'c' }, false)).toBeUndefined();
    expect(doubanWeeklyToItem({ id: 1, title: 'x' }, false)).toBeUndefined();
  });
});

describe('baiduTeleplayToItem', () => {
  it('使用稳定名称标识，不输出热度为评分', () => {
    expect(baiduTeleplayToItem({ title: '某剧', cover: 'https://img.example/1.jpg' }, 3)).toEqual({
      id: 'baidu_某剧:', provider: 'baidu', providerId: '某剧:', synopsis: undefined,
      title: '某剧',
      cover: 'https://img.example/1.jpg',
      isTv: true,
    });
  });

  it('榜单排名变化时保持百科 ID，避免收藏串片', () => {
    const raw = { title: '九门', cover: 'https://img.example/a.jpg', url: 'https://baike.baidu.com/item/name/64883150?fr=resou' };
    expect(baiduTeleplayToItem(raw, 1)?.id).toBe('baidu_64883150');
    expect(baiduTeleplayToItem(raw, 9)?.id).toBe(baiduTeleplayToItem(raw, 1)?.id);
  });

  it('无海报条目丢弃', () => {
    expect(baiduTeleplayToItem({ title: '某剧', cover: null }, 0)).toBeUndefined();
  });
});
