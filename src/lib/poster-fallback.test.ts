import { describe, expect, it } from 'vitest';
import { buildImageCandidates } from './utils';
import { aggregateResults } from '@/components/video-card';

describe('search poster recovery', () => {
  it('uses the working 360 image mirror before the unreachable dedicated image port', () => {
    const candidates=buildImageCandidates('https://www.imgzy360.com:7788/upload/vod/poster.jpg','proxy','');
    expect(candidates[0]).toBe('/api/proxy?url=https%3A%2F%2F360zy.com%2Fupload%2Fvod%2Fposter.jpg');
  });
  it('tries a different provider poster before falling back to the same broken origin', () => {
    const candidates = buildImageCandidates('https://dead.example/a.jpg', 'proxy', '', ['https://good.example/b.jpg', 'https://dead.example/a.jpg']);
    expect(candidates.slice(0, 2)).toEqual(['/api/proxy?url=https%3A%2F%2Fdead.example%2Fa.jpg', '/api/proxy?url=https%3A%2F%2Fgood.example%2Fb.jpg']);
    expect(new Set(candidates).size).toBe(candidates.length);
  });
  it('merges year punctuation variants so alternate posters belong to the same film', () => {
    const groups=aggregateResults([
      {name:'都挺好',year:'2019',vodId:'1',sourceKey:'a',sourceName:'A',pic:'https://dead.example/a.jpg'},
      {name:'都挺好',year:'2019–',vodId:'2',sourceKey:'b',sourceName:'B',pic:'https://good.example/b.jpg'},
      {name:'都挺好',year:'2025',vodId:'3',sourceKey:'c',sourceName:'C'},
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].year).toBe('2025');
  });
});
