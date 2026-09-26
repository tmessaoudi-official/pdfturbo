import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// F-B — surface the app version in the footer; bump package.json (npm version
// patch/minor) to ship a new number. Read here so the build is the single source.
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

export default defineConfig({
  base: '/pdfturbo/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
        // #48 — keep the ~6 MB OCR engine (tesseract worker + wasm cores, which
        // match the .js glob) and the multi-MB traineddata OUT of the precache;
        // non-OCR users should never download them on SW install. They are
        // served via the 'ocr-assets' runtime cache below, on first OCR use.
        // Row 36 — pdf.js's decoder fallbacks under pdfjs/wasm/ are .js too, and are fetched only when a
        // JBIG2 / JPEG 2000 image meets a browser that cannot run WebAssembly; keep them out as well.
        globIgnores: ['**/tesseract/**', '**/pdfjs/**'],
        // pdf.js + pdf-lib chunks can be >2MB — raise the precache limit
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // OCR engine + language data — cache on first OCR use (must precede
            // the generic .js rule so the tesseract worker/cores land here, #48).
            urlPattern: ({ url }) => url.pathname.includes('/tesseract/') && url.origin === self.location.origin,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-assets',
              expiration: { maxEntries: 30, maxAgeSeconds: 90 * 24 * 60 * 60 },
            },
          },
          {
            // Row 32 — pdf.js's packed CMap files (168 + their LICENSE, ~1.7 MB), vendored into public/pdfjs/cmaps/.
            // Fetched only by CJK documents that need one, so they stay OUT of the precache (.bcmap
            // matches no globPattern) and are cached on first use; maxEntries covers every file so a
            // CMap's usecmap chain is never evicted mid-document.
            urlPattern: ({ url }) => url.pathname.includes('/pdfjs/cmaps/') && url.origin === self.location.origin,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdfjs-cmaps',
              expiration: { maxEntries: 200, maxAgeSeconds: 90 * 24 * 60 * 60 },
            },
          },
          {
            // Rows 36-37 — pdf.js's JBIG2 / JPEG 2000 decoders (2 wasm modules + 2 JS fallbacks) and its colour
            // module (qcms) in public/pdfjs/wasm/, and its CMYK profile in public/pdfjs/iccs/. Fetched on first use,
            // so cached then; this rule must precede the generic .js rule so the fallbacks land here.
            urlPattern: ({ url }) =>
              (url.pathname.includes('/pdfjs/wasm/') || url.pathname.includes('/pdfjs/iccs/')) && url.origin === self.location.origin,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdfjs-wasm',
              expiration: { maxEntries: 10, maxAgeSeconds: 90 * 24 * 60 * 60 },
            },
          },
          {
            // Limits row 10 — the vendored Arabic font (Noto Naskh, 172 KB, hashed name under assets/). Fetched only
            // when an export or the searchable-OCR layer shapes Arabic, so it stays out of the precache (as the OCR
            // assets do, #48) and is cached on first use. Order against the .js rule does not matter: .ttf never matches it.
            urlPattern: ({ url }) => url.pathname.endsWith('.ttf') && url.origin === self.location.origin,
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-fonts',
              expiration: { maxEntries: 4, maxAgeSeconds: 90 * 24 * 60 * 60 },
            },
          },
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
