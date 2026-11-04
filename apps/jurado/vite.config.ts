import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Juror PWA. Served by nginx under /jurado/ next to the platform (Next.js),
 * so its assets and service worker never collide with the platform's.
 */
const BASE = '/jurado/';
const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://localhost:3000';
const ACTAS_URL = process.env.ACTAS_URL ?? 'http://localhost:3001';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    // RT-6: after the first visit the juror screens open without network.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Mesa a Mesa — Jurados',
        short_name: 'Mesa a Mesa',
        description: 'Transmisión del acta E-14 de la mesa',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        theme_color: '#6b3fd0',
        background_color: '#f3f5f9',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,json,woff2}'],
        navigateFallback: `${BASE}index.html`,
        navigateFallbackAllowlist: [/^\/jurado(\/|$)/],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    // Same routing as nginx in production: actas service first, platform for the rest.
    proxy: {
      '/api/actas': ACTAS_URL,
      '/api': PLATFORM_URL,
      '/login': PLATFORM_URL,
      '/_next': PLATFORM_URL,
    },
  },
});
