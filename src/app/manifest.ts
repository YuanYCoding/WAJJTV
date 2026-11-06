import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JjBiTV · 私人影音空间',
    short_name: 'JjBiTV',
    description: '海清和静静的私人影音空间 · 观影与听歌',
    start_url: '/',
    display: 'standalone',
    background_color: '#111111',
    theme_color: '#101111',
    icons: [
      {
        src: '/icons/jjbitv-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/jjbitv-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
