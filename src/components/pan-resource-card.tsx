'use client';
import { memo } from 'react';
import Link from 'next/link';
import type { PanProvider, PanResult } from '@/lib/netdisk-types';
import s from '@/app/pan/pan.module.css';
export function PanIcon({ name, className }: { name: 'search' | 'close' | 'arrow' | 'folder' | 'link' | 'source' | 'refresh'; className?: string }) {
  const paths = { search: 'm21 21-5-5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0', close: 'm6 6 12 12M6 18 18 6', arrow: 'M5 12h14m-6-6 6 6-6 6', folder: 'M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18', link: 'm9 15 6-6m-4-3 2-2a5 5 0 0 1 7 7l-2 2M6 11l-2 2a5 5 0 0 0 7 7l2-2', source: 'M4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2H4m12-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0', refresh: 'M20 4v5h-5M4 20v-5h5M4.5 9a8 8 0 0 1 13-5L20 7M4 17l2.5 3a8 8 0 0 0 13-5' };
  return <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export function PanDriveIcon({ provider }: { provider: PanProvider }) { return <svg className={s.providerMark} width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke={provider === 'aliyun' ? '#7984f5' : '#6578e9'} strokeWidth="4" /><path d="m15.5 15.5 4 4" stroke={provider === 'aliyun' ? '#b9bffd' : '#abb8fc'} strokeWidth="3" strokeLinecap="round" /></svg>; }
export function resourceDisplayTitle(title: string) { return title.split(/(?:简介|描述|资源描述|内容介绍|标签)\s*[:：]/)[0].replace(/\s+/g, ' ').trim().slice(0, 150) || title.slice(0, 150); }
export const PanResourceCard = memo(function PanResourceCard({ row, href, onOpen }: { row: PanResult; href: string; onOpen?: () => void }) {
  const title = resourceDisplayTitle(row.title), knownQuality = row.qualityHint !== '画质待检测';
  return <Link prefetch={false} href={href} onClick={onOpen} className={s.card} aria-label={`打开 ${title}`} title={title}>
    <div className={s.cardTop}><span className={s.providerName}><PanDriveIcon provider={row.provider || 'quark'} />{row.provider === 'aliyun' ? '阿里云盘' : '夸克'}</span>{knownQuality && <span className={s.qualityBadge} title="资源发布者标注，实际播放画质进入后确认">{row.qualityHint.replace('标注 ', '')}</span>}</div>
    <h2 className={s.cardTitle}>{title}</h2><div className={s.cardBottom}><span className={s.sourceLine}><PanIcon name="source" /><span>{row.sourceName}</span><span className={row.checked ? s.validDot : s.pendingDot} /><span title={row.videoSample}>{row.videoSample ? '已发现视频' : row.checked ? '分享可访问' : '打开时检测'}</span></span><span className={s.openCircle}><PanIcon name="arrow" /></span></div>
  </Link>;
});
