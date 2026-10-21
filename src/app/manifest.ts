import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WAJJTV · 私人影院',
    short_name: 'WAJJTV',
    description: '海清和静静自用追剧资源',
    start_url: '/',
    display: 'standalone',
    background_color: '#111111',
    theme_color: '#101111',
    icons: [
      {
        src: '/icons/wajjtv-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/wajjtv-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
