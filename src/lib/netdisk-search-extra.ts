import { fetchUpstream } from './fetch-utils';
import { plainText } from './netdisk-utils';
import type { PanProvider } from './netdisk-types';
export const extraPanSources = [
  { id: 'yunso', name: '小云搜索', origin: 'https://www.yunso.net' },
  { id: 'melost', name: '影盘社', origin: 'https://www.melost.cn' },
  { id: 'erxiao', name: '花卷影视', origin: 'https://www.2xiaopan.one' },
  { id: 'dyyj', name: '电影云集', origin: 'https://bbs.dyyjmax.org' },
] as const;
type Row = { title: string; content: string };
export async function panGet(url: string, signal: AbortSignal, body?: object) {
  const r = await fetchUpstream(url, { timeoutMs: 6000, signal, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', Referer: new URL(url).origin + '/' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const reader = r.body!.getReader(), parts: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error('来源数据过大'); } parts.push(value); }
  return Buffer.concat(parts).toString('utf8');
}
export function parseYunsoCards(html: string): Row[] {
  return [...html.matchAll(/<a\b([^>]*\burl="[^">]+"[^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ title: plainText(m[2]), content: (m[1].match(/\burl="([^">]+)"/)?.[1] || '') + ' 提取码：' + (m[1].match(/\bpa="([^">]*)"/)?.[1] || '') }));
}
export async function panWorkers<T>(rows: T[], concurrency: number, signal: AbortSignal, action: (row: T) => Promise<void>) {
  let cursor = 0; await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => { while (cursor < rows.length && !signal.aborted) await action(rows[cursor++]); }));
}
export async function extraPanSearch(id: string, keyword: string, page: number, provider: PanProvider | undefined, signal: AbortSignal, add: (title: string, content: string) => Promise<void>): Promise<boolean> {
  const source = extraPanSources.find((s) => s.id === id); if (!source) return false;
  if (id === 'yunso') {
    const providers = provider ? [provider] : ['quark', 'aliyun'] as const;
    await Promise.all(providers.map(async (p) => {
      const query = new URLSearchParams({ requestID: '', mode: '90002', scope_content: '0', stype: '', wd: keyword + (p === 'aliyun' ? ' 阿里' : ''), uk: '', page: String(page), limit: '30', screen_filetype: '' });
      const value = JSON.parse(await panGet(source.origin + '/api/Core/search2?' + query, signal, {}));
      if (typeof value.data !== 'string') throw new Error('搜索来源响应异常');
      const rows = parseYunsoCards(value.data).filter((v) => p === 'aliyun' ? /(?:alipan|aliyundrive)\.com/.test(v.content) : /pan\.quark\.cn/.test(v.content));
      await panWorkers(rows, 4, signal, (row) => add(row.title, row.content));
    }));
  } else if (id === 'melost') {
    const value = JSON.parse(await panGet(source.origin + '/v1/search/disk', signal, { page, q: keyword, user: '', exact: false, format: [], share_time: '', size: 30, type: provider === 'aliyun' ? 'ALY' : provider === 'quark' ? 'QUARK' : '', exclude_user: [], adv_params: { wechat_pwd: '', platform: 'pc' } }));
    if (value.code === 417 && !value.data) return true;
    if (!Array.isArray(value.data?.list)) throw new Error('搜索来源响应异常');
    await panWorkers(value.data.list as Record<string, unknown>[], 5, signal, (row) => add(plainText(row.disk_name), String(row.link || '') + (row.disk_pass ? ' 提取码：' + row.disk_pass : '')));
  } else if (id === 'dyyj') {
    const query = new URLSearchParams({ include: 'firstPost,mostRelevantPost', 'page[limit]': '20', 'page[offset]': String((page - 1) * 20), ...(keyword ? { 'filter[q]': keyword } : {}) });
    const value = JSON.parse(await panGet(source.origin + '/api/discussions?' + query, signal));
    if (!Array.isArray(value.data)) throw new Error('社区响应异常');
    const included = new Map((Array.isArray(value.included) ? value.included : []).map((v: { id: string; attributes?: { contentHtml?: string } }) => [String(v.id), v.attributes?.contentHtml || '']));
    await panWorkers(value.data as { attributes?: { title?: string }; relationships?: { firstPost?: { data?: { id?: string } }; mostRelevantPost?: { data?: { id?: string } } } }[], 4, signal, async (row) => {
      const post = row.relationships?.firstPost?.data?.id || row.relationships?.mostRelevantPost?.data?.id; await add(plainText(row.attributes?.title), String(included.get(String(post)) || ''));
    });
  } else if (page === 1) {
    const html = await panGet(source.origin + '/index.php/vod/search/wd/' + encodeURIComponent(keyword) + '.html', signal);
    const cards = [...html.matchAll(/<h3[^>]*>\s*<a[^>]*href="[^"<>]*\/detail\/id\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 10);
    let failed = 0;
    await panWorkers(cards, 3, signal, async (m) => { try { await add(plainText(m[2]), await panGet(source.origin + '/index.php/vod/detail/id/' + m[1] + '.html', signal)); } catch { failed++; } });
    if (cards.length && failed === cards.length) throw new Error('来源详情暂不可用');
  }
  return true;
}
