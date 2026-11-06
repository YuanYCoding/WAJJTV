import { panGet, panWorkers } from './pan-public-fetch';
import { aipanCatalog } from './resource-catalog';
import { plainText } from './netdisk-utils';
import type { PanProvider } from './netdisk-types';
export const extraPanSources = [
  { id: 'yunso', name: '小云搜索', origin: 'https://www.yunso.net' },
  { id: 'melost', name: '影盘社', origin: 'https://www.melost.cn' },
  { id: 'erxiao', name: '花卷影视', origin: 'https://www.2xiaopan.one' },
  { id: 'dyyj', name: '电影云集', origin: 'https://bbs.dyyjmax.org' },
  { id: 'wanou', name: '玩偶片库', origin: 'https://woog.nxog.eu.org' },
  { id: 'aipan', name: '爱盼影视', origin: 'https://www.aipan.me' },
  { id: 'pan365', name: '365 聚合', origin: 'https://pan.365wp.top' },
] as const;
type Row = { title: string; content: string };
export function parseYunsoCards(html: string): Row[] {
  return [...html.matchAll(/<a\b([^>]*\burl="[^">]+"[^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ title: plainText(m[2]), content: (m[1].match(/\burl="([^">]+)"/)?.[1] || '') + ' 提取码：' + (m[1].match(/\bpa="([^">]*)"/)?.[1] || '') }));
}
export async function extraPanSearch(id: string, keyword: string, page: number, provider: PanProvider | undefined, signal: AbortSignal, add: (title: string, content: string) => Promise<void>, originOverride?: string): Promise<boolean> {
  const base = extraPanSources.find((s) => s.id === id); if (!base) return false; const source = { ...base, origin: originOverride || base.origin };
  if (id === 'wanou') {
    const data = JSON.parse(await panGet(source.origin + '/api.php/provide/vod?' + new URLSearchParams({ ac: 'detail', wd: keyword, pg: String(page) }), signal));
    if (!Array.isArray(data.list)) throw new Error('玩偶片库响应异常');
    await panWorkers(data.list as Record<string, unknown>[], 3, signal, (v) => add(plainText(v.vod_name), String(v.vod_down_url || '') + ' ' + String(v.vod_play_url || '')));
  } else if (id === 'aipan') {
    for (const movie of await aipanCatalog(keyword, page, signal, source.origin)) for (const link of movie.links) await add(movie.title + ' ' + link.name, link.url);
  } else if (id === 'pan365') {
    await Promise.all((provider ? [provider] : ['aliyun', 'quark']).map(async (kind) => {
      const data = JSON.parse(await panGet(source.origin + '/api/interface/search?' + new URLSearchParams({ keyword, disk_type: kind, page: String(page), pageSize: '20' }), signal));
      if (!Array.isArray(data.data?.list)) throw new Error('365 聚合响应异常');
      await panWorkers((data.data.list as Record<string, unknown>[]).filter((v) => v.disk_type === kind).slice(0, 12), 3, signal, async (row) => {
        try { let url = String(row.url || ''), code = ''; if (!/^https:\/\/(?:pan\.quark\.cn|(?:www\.)?(?:alipan|aliyundrive)\.com)\/s\//.test(url)) {
          const resolved = JSON.parse(await panGet(source.origin + '/api/transfer-share/transfer-share', signal, { encrypted_url: url }));
          url = String(resolved.data?.share_url || resolved.data?.original_url || ''); code = String(resolved.data?.passcode || '');
        } await add(plainText(row.title), url + (code ? ' 提取码：' + code : '')); } catch { /* Keep independent successfully resolved shares. */ }
      });
    }));
  } else if (id === 'yunso') {
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
