import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { DISCOVER_KINDS, fetchDiscover, type DiscoverKind } from '@/lib/discover';

export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const p = new URL(req.url).searchParams;
  const kind = p.get('kind') || 'hot';
  const page = Number(p.get('page') || 1);
  const sort = p.get('sort') || 'rankhot';
  const genre = p.get('genre') || '';
  const area = p.get('area') || '';
  const year = p.get('year') || '';
  if (!(DISCOVER_KINDS as readonly string[]).includes(kind) || !Number.isInteger(page) || page < 1 || page > 500 || !['rankhot','ranklatest','rankpoint'].includes(sort) || genre.length > 15 || area.length > 15 || (year && !/^(19|20)\d{2}$/.test(year))) return NextResponse.json({ error: '筛选参数无效' }, { status: 400 });
  try { return NextResponse.json(await fetchDiscover({ kind: kind as DiscoverKind, page, sort, genre, area, year })); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '片库获取失败' }, { status: 502 }); }
}
