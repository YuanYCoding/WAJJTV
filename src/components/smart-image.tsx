'use client';

import { useEffect, useState } from 'react';
import { buildImageCandidates } from '@/lib/utils';

interface SmartImageProps {
  /** 原始图片地址（未经代理加工，降级链由本组件按加载方式生成） */
  url?: string;
  fallbackUrls?: string[];
  mode: 'direct' | 'proxy' | 'custom';
  customProxy?: string;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  /** 候选链耗尽后回调，调用方切换占位图等兜底 UI */
  onExhausted?: () => void;
}

/**
 * 带降级链的封面图组件：direct 模式按 buildImageCandidates 的顺序加载，
 * onError 逐级回退（豆瓣图：直连 → 公共镜像 → 内置代理）；
 * 全部失败后触发 onExhausted 并停止渲染，由调用方展示占位图。
 * referrerPolicy=no-referrer：不向图床暴露来源页，规避部分站点的 Referer 校验。
 */
export function SmartImage({
  url,
  fallbackUrls = [],
  mode,
  customProxy = '',
  alt,
  className,
  loading = 'lazy',
  onExhausted,
}: SmartImageProps) {
  const candidates = buildImageCandidates(url, mode, customProxy, fallbackUrls);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const src = candidates.find((candidate) => !failed.has(candidate));

  // Remember failed URLs so streaming result reordering cannot reset the fallback chain.
  useEffect(() => {
    if (!src) onExhausted?.();
  }, [src, onExhausted]);

  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed((previous) => new Set(previous).add(src))}
    />
  );
}
