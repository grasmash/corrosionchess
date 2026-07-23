import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // GitHub Pages serves this project from /corrosionchess/, not the domain
  // root -- relative base plus the codebase's existing convention of
  // leading-slash-free asset paths (see piecesets.ts's pieceImageUrl) means
  // the same build works unmodified at any subpath.
  base: './',
  server: {
    port: 1212, // 12x12 — the big board
    strictPort: true,
    allowedHosts: ['corrosion.localhost'],
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg', 'art/mark.png'],
      manifest: {
        name: 'Corrosion Chess',
        short_name: 'Corrosion',
        description: 'A chess variant where captured squares corrode away -- claim the board before it dissolves.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#312e2b',
        theme_color: '#312e2b',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the app shell. The asset library (~180 PNGs across
        // piece themes, VFX, and avatars) is cached on first use instead via
        // runtimeCaching below -- precaching all of it would force every
        // install to download themes a player may never select.
        globPatterns: ['**/*.{js,css,html,svg,ico,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/(pieces|art|vfx|avatars)\/.*\.png$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'corrosion-art-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
})
