import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/pdfturbo/',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      manifestFilename: 'manifest.json',
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg}'],
        // pdf.js + pdf-lib chunks can be >2MB — raise the precache limit
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Cache large JS chunks (pdf.js worker, pdf-lib) at runtime
            urlPattern: ({ url }) => (url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs')) && url.origin === self.location.origin,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdf-chunks',
              expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
      manifest: {
        name: 'PDFturbo',
        short_name: 'PDFturbo',
        description: 'Edit, annotate, sign and fill PDFs in your browser',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: 'icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
});
