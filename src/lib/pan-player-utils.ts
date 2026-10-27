import type { HlsConfig, Loader, LoaderContext, LoaderConfiguration, LoaderCallbacks } from 'hls.js';
import type { PanQuality } from './netdisk-types';
export function chooseFullQuality(qualities: PanQuality[], height = 1080) {
  const full = qualities.filter((q) => !q.limited);
  const original = full.find((q) => q.original); if (original) return original;
  const streams = full.filter((q) => q.kind === 'hls');
  return streams.filter((q) => (q.height || 0) <= height).sort((a, b) => (b.height || 0) - (a.height || 0))[0]
    || streams.sort((a, b) => (a.height || Infinity) - (b.height || Infinity))[0] || full[0];
}
export function lowerFullQuality(qualities: PanQuality[], current: PanQuality) {
  return qualities.filter((q) => q.url !== current.url && !q.limited && q.kind === 'hls' && (q.height || 0) > 0 && (current.kind === 'video' ? (q.height || 0) <= (current.height || Infinity) : (q.height || 0) < (current.height || Infinity))).sort((a, b) => (b.height || 0) - (a.height || 0))[0];
}
export function seekPosition(current: number, delta: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, Number.isFinite(current) ? current : 0);
  return Math.min(Math.max(0, (Number.isFinite(current) ? current : 0) + delta), Math.max(0, duration - 0.1));
}
export function proxyFallbackUrl(raw: string) {
  try { const origin = typeof location === 'undefined' ? 'https://cinema.test' : location.origin; const url = new URL(raw, origin); if (url.origin !== origin || !/^\/api\/(?:alipan|netdisk)\/media$/.test(url.pathname) || url.searchParams.get('direct') !== '1') return null; url.searchParams.set('direct', '0'); return url.href; } catch { return null; }
}
export function directFallbackLoader(Base: new(config: HlsConfig) => Loader<LoaderContext>) {
  return class implements Loader<LoaderContext> {
    private inner: Loader<LoaderContext>; private disposed = false;
    constructor(private config: HlsConfig) { this.inner = new Base(config); }
    get stats() { return this.inner.stats; }
    get context() { return this.inner.context; }
    abort() { this.disposed = true; this.inner.abort(); }
    destroy() { this.disposed = true; this.inner.destroy(); }
    getCacheAge() { return this.inner.getCacheAge?.() ?? null; }
    getResponseHeader(name: string) { return this.inner.getResponseHeader?.(name) ?? null; }
    load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
      let retried = false;
      const fallback = () => { const url = proxyFallbackUrl(context.url); if (!url || retried || this.disposed) return false; retried = true; this.inner.destroy(); this.inner = new Base(this.config); this.inner.load({ ...context, url }, config, callbacks); return true; };
      this.inner.load(context, config, { ...callbacks, onError: (...args) => { if (!fallback()) callbacks.onError(...args); }, onTimeout: (...args) => { if (!fallback()) callbacks.onTimeout(...args); } });
    }
  };
}
