import { createHash } from 'node:crypto';
import { fetchUpstream } from './fetch-utils';
import { isRelevantPanTitle, parseQuarkShare, plainText, qualityHint } from './netdisk-utils';
import type { PanResult, PanSearchEvent } from './netdisk-types';

const SOURCES = [
  { id: 'muou', name: '木偶网盘', origin: 'https://www.muoua.top' },
  { id: 'quarktv', name: '夸克影视', origin: 'https://www.quarktv.com' },
  { id: 'quark4k', name: '夸克 4K 社区', origin: 'https://quark4k.com' },
] as const;
const cache = new Map<string, { expires: number; list: PanResult[] }>();
const health = new Map<string, { failures: number; nextCheck: number }>();
const shareChecks = new Map<string, { valid: boolean; expires: number }>();
export function panSources() { return SOURCES.map((s) => ({ id: s.id, name: s.name, status: ((health.get(s.id)?.nextCheck || 0) > Date.now() ? 'cooldown' : 'ready') as 'cooldown' | 'ready', nextCheck: health.get(s.id)?.nextCheck })); }
export function extractQuarkLinks(text: string) {
  const links = new Map<string, { url: string; passcode: string }>();
  const decoded = text.replace(/\\\//g, '/').replace(/&amp;/g, '&');
  for (const match of decoded.matchAll(/https:\/\/pan\.quark\.cn\/s\/[A-Za-z\d]{6,32}(?:\?[^\s<>"'\\]*)?/g)) {
    try {
      const context = plainText(decoded.slice(match.index, match.index! + match[0].length + 80), 3000);
      const link = parseQuarkShare(context);
      if (!links.has(link.url) || link.passcode) links.set(link.url, { url: link.url, passcode: link.passcode });
    } catch { /* Ignore malformed snippets. */ }
  }
  return [...links.values()];
}
async function get(url: string, signal: AbortSignal) {
  const response = await fetchUpstream(url, { timeoutMs: 6000, signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', Referer: new URL(url).origin + '/' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = response.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error('来源返回数据过大'); } chunks.push(value); }
  return Buffer.concat(chunks).toString('utf8');
}
export function parseSearchCards(html: string, provider: 'muou' | 'quarktv') {
  const pattern = provider === 'muou'
    ? /<h3[^>]*>\s*<a[^>]*href="[^"<>]*\/detail\/id\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g
    : /<h2[^>]*>\s*<a[^>]*href="[^"<>]*\/(\d+)\.html?"[^>]*>([\s\S]*?)<\/a>/g;
  return [...html.matchAll(pattern)].map((m) => ({ id: m[1], title: plainText(m[2]) }));
}
function result(source: typeof SOURCES[number], title: string, link: { url: string; passcode: string }): PanResult {
  return { id: createHash('sha256').update(source.id + link.url).digest('hex').slice(0, 24), title, source: source.id, sourceName: source.name, shareUrl: link.url, passcode: link.passcode, qualityHint: qualityHint(title) };
}
async function fromSource(source: typeof SOURCES[number], keyword: string, signal: AbortSignal, emit: (items: PanResult[]) => void) {
  const items: PanResult[] = [];
  const add = async (title: string, content: string) => {
    if (!isRelevantPanTitle(title, keyword)) return;
    if (!keyword && !/电影|电视剧|动漫|美剧|日剧|韩剧|德剧|综艺|纪录片|国漫/.test(title)) return;
    const links = extractQuarkLinks(content).slice(0, 3);
    const batch: PanResult[] = [];
    for (const link of links) {
      const cached = shareChecks.get(link.url + link.passcode);
      if (cached && cached.expires > Date.now() && !cached.valid) continue;
      let valid: boolean | undefined = cached?.expires && cached.expires > Date.now() ? cached.valid : undefined;
      if (valid === undefined) {
        try {
          const response = await fetch('https://drive-pc.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc&uc_param_str=', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://pan.quark.cn/', 'User-Agent': 'Mozilla/5.0' },
            body: JSON.stringify({ pwd_id: parseQuarkShare(link.url).id, passcode: link.passcode }), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
          });
          const value = await response.json();
          if (value.data?.stoken) valid = true;
          else if ([41031, 41012].includes(Number(value.code))) valid = false;
          if (valid !== undefined) {
            if (shareChecks.size > 1000) shareChecks.delete(shareChecks.keys().next().value!);
            shareChecks.set(link.url + link.passcode, { valid, expires: Date.now() + 5 * 60_000 });
          }
        } catch { /* Unknown availability remains explicitly unchecked. */ }
      }
      if (valid !== false && !signal.aborted) batch.push(result(source, title, link));
    }
    const fresh = batch.filter((v) => !items.some((x) => x.id === v.id)); items.push(...fresh); if (fresh.length) emit(fresh);
  };
  if (source.id === 'quark4k') {
    const query = new URLSearchParams({ include: 'firstPost,mostRelevantPost', 'page[limit]': '15', ...(keyword ? { 'filter[q]': keyword } : {}) });
    const data = JSON.parse(await get(source.origin + '/api/discussions?' + query, signal));
    const included = new Map((Array.isArray(data.included) ? data.included : []).map((v: { id: string; attributes?: { contentHtml?: string } }) => [String(v.id), v.attributes?.contentHtml || '']));
    const rows = Array.isArray(data.data) ? data.data : []; let index = 0;
    await Promise.all(Array.from({ length: Math.min(3, rows.length) }, async () => {
      while (index < rows.length && !signal.aborted) {
        const row = rows[index++]; const post = row.relationships?.firstPost?.data?.id || row.relationships?.mostRelevantPost?.data?.id;
        await add(plainText(row.attributes?.title), String(included.get(String(post)) || ''));
      }
    }));
    return items;
  }
  const html = await get(source.origin + (source.id === 'muou' ? '/index.php/vod/search/wd/' + encodeURIComponent(keyword) + '.html' : '/?s=' + encodeURIComponent(keyword)), signal);
  const cards = parseSearchCards(html, source.id).filter((v) => isRelevantPanTitle(v.title, keyword)).slice(0, 12);
  let cursor = 0; let errors = 0;
  await Promise.all(Array.from({ length: Math.min(3, cards.length) }, async () => {
    while (cursor < cards.length && !signal.aborted) {
      const card = cards[cursor++];
      try {
        const url = source.id === 'muou' ? source.origin + '/index.php/vod/detail/id/' + card.id + '.html'
          : source.origin + '/wp-json/postkit/v1/pan_view?' + new URLSearchParams({ post_id: card.id, visitor_id: 'pk_' + Date.now() });
        await add(card.title, await get(url, signal));
      } catch { errors++; }
    }
  }));
  if (cards.length && errors === cards.length) throw new Error('来源详情暂不可用');
  return items;
}
export async function searchNetdisk(keyword: string, selected: string[], emit: (event: PanSearchEvent) => void, external: AbortSignal) {
  const sources = SOURCES.filter((s) => selected.length === 0 || selected.includes(s.id));
  let total = 0; let failures = 0;
  const seen = new Set<string>();
  await Promise.all(sources.map(async (source) => {
    const start = Date.now();
    const cached = cache.get(source.id + ':' + keyword);
    const publish = (list: PanResult[]) => {
      const fresh = list.filter((v) => { const key = v.shareUrl; if (seen.has(key)) return false; seen.add(key); return true; });
      total += fresh.length;
      if (fresh.length) emit({ type: 'results', source: source.id, list: fresh, ms: Date.now() - start });
    };
    if (cached && cached.expires > Date.now()) { publish(cached.list); return; }
    if ((health.get(source.id)?.nextCheck || 0) > Date.now()) { failures++; emit({ type: 'results', source: source.id, list: [], ms: 0, error: '来源暂时失效，稍后自动复检' }); return; }
    const signal = AbortSignal.any([external, AbortSignal.timeout(8000)]);
    try {
      const list = await fromSource(source, keyword, signal, publish);
      if (external.aborted) return;
      if (signal.aborted) throw new Error('来源搜索超时，已保留先到结果');
      if (cache.size > 120) cache.delete(cache.keys().next().value!);
      cache.set(source.id + ':' + keyword, { list, expires: Date.now() + 5 * 60_000 });
      health.delete(source.id);
      if (!list.length) emit({ type: 'results', source: source.id, list: [], ms: Date.now() - start });
    } catch (e) {
      if (external.aborted) return;
      const previous = health.get(source.id); const count = (previous?.failures || 0) + 1;
      health.set(source.id, { failures: count, nextCheck: count >= 2 ? Date.now() + 5 * 60_000 : 0 });
      failures++; emit({ type: 'results', source: source.id, list: [], ms: Date.now() - start, error: e instanceof Error ? e.message : '来源暂不可用' });
    }
  }));
  emit({ type: 'done', count: total, failures });
}
