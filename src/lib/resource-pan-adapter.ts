import { panGet } from './pan-public-fetch';
import { plainText } from './netdisk-utils';
import type { ResourceSource } from './resource-source-types';
/** Public metadata only. Arbitrary JS/TVBox spiders and cloud credentials are never executed/sent. */
export async function customPanSearch(source: ResourceSource, keyword: string, page: number, signal: AbortSignal, add: (title: string, text: string) => Promise<void>) {
  let data: Record<string, unknown>;
  if (source.adapter === 'pansou') data = JSON.parse(await panGet(source.url, signal, { kw: keyword, src: 'all', res: 'merge', refresh: false }));
  else { const u = new URL(source.url); for (const [k, v] of Object.entries(source.adapter === 'pan-cms' ? { ac: 'detail', wd: keyword, pg: String(page) } : { q: keyword, page: String(page) })) u.searchParams.set(k, v); data = JSON.parse(await panGet(u.href, signal)); }
  if (source.adapter === 'pansou') {
    const root = data.data as { merged_by_type?: Record<string, unknown[]> } | undefined, groups = root?.merged_by_type; if (!groups || typeof groups !== 'object') throw new Error('PanSou 响应格式无效');
    for (const kind of ['quark', 'aliyun', 'alipan']) for (const row of (groups[kind] || []).slice((page - 1) * 30, page * 30) as Record<string, unknown>[]) await add(plainText(row.note || row.title || row.name), String(row.url || '') + ' 提取码：' + String(row.password || row.pwd || ''));
    return;
  }
  const root = data.data as Record<string, unknown> | unknown[] | undefined;
  const rows = data.list || data.results || (Array.isArray(root) ? root : root?.list || root?.results); if (!Array.isArray(rows)) throw new Error('接口应返回 list/results 数组');
  for (const row of rows.slice(0, 40) as Record<string, unknown>[]) await add(plainText(row.title || row.name || row.vod_name), [row.url, row.shareUrl, row.link, row.vod_play_url, row.vod_down_url, row.content].filter((v) => typeof v === 'string').join(' ') + ' 提取码：' + String(row.passcode || row.password || row.pwd || ''));
}
