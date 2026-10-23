import type { Metadata, Viewport } from 'next';
import './globals.css';
import './cinema.css';
import './library.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: {
    default: 'WAJJTV · 海清和静静的私人影院',
    template: '%s - WAJJTV',
  },
  description:
    '海清和静静自用追剧资源。一起发现好电影、好剧集，收藏每一段共度的时光。',
  manifest: '/manifest.webmanifest',
  // 图标与门户站（LibreTV-portal）同一套：同一张 artwork 导出的多尺寸 + 根目录 favicon.ico 兜底。
  // 只声明单张 512 时，抓取端只能拿大图缩放，小尺寸下易糊、看起来「没填满」。
  robots: { index: false, follow: false },
  icons: { icon: [{ url: '/icons/wajjtv.svg', type: 'image/svg+xml' }], apple: [{ url: '/icons/wajjtv-192.png', sizes: '192x192' }] },
};

export const viewport: Viewport = {
  themeColor: '#101111',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首屏前同步主题，避免亮暗闪烁 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('libretv-theme')||'dark';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})()",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
