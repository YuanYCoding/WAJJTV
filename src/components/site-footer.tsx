import Link from 'next/link';
export function SiteFooter() {
  return <footer className="site-footer cinema-shell mx-auto w-full"><span>JjBiTV <span className="text-accent">♥</span> 海清 & 静静 · 影音相伴</span><div><Link href="/about">关于影音空间</Link><a href="https://github.com/YuanYCoding/WAJJTV/tree/wajjtv/private-cinema" target="_blank" rel="noopener noreferrer">开放源码</a><a href="https://github.com/LibreSpark/LibreTV" target="_blank" rel="noopener noreferrer">基于 LibreTV · AGPL-3.0</a></div></footer>;
}
