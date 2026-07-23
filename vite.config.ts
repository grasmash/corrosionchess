import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 1212, // 12x12 — the big board
    strictPort: true,
    allowedHosts: ['corrosion.localhost'],
  },
})
