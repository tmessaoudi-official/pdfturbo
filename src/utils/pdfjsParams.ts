/**
 * The ONE way `src/` builds the parameters of a pdf.js `getDocument` call. A call that bypasses it is
 * banned (`tests/infra/pdfjsParams.test.ts`).
 *
 * Two kinds of pdf.js data file are served from the app's own origin (the CSP allows no other,
 * `connect-src 'self'`), vendored by `scripts/prepare-pdfjs-assets.mjs`:
 *
 * - `cMapUrl` → `public/pdfjs/cmaps/`. A CID font whose encoding is a predefined Adobe CMap — common in
 *   Japanese, Chinese and Korean PDFs — decodes only with these; without them the page's text is neither
 *   drawn, selectable, searchable nor exported (row 32 of the limits plan).
 * - `wasmUrl` → `public/pdfjs/wasm/`. pdf.js's JBIG2 and JPEG 2000 decoders (WebAssembly, plus a pure-JS
 *   fallback for when WebAssembly cannot run). Without them every such image draws NOTHING, so a scanned
 *   black-and-white page is blank in the editor, thumbnails, rasters and OCR (row 36).
 *
 * `useWorkerFetch` is pinned FALSE, which is what pdf.js computed before `wasmUrl` was added: it turns
 * true on its own only when `standardFontDataUrl` is ALSO given, and true also switches on pdf.js's ICC
 * colour management, which shifts the colours of every ICC-tagged page (measured up to 18 levels per
 * channel on a corpus paper). That is a separate, unruled change (row 37) — do not let adding a URL here
 * make it silently. With it false, pdf.js fetches these files on the main thread and hands them to the
 * worker.
 *
 * The URLs are ABSOLUTE: pdf.js may resolve them from its worker, where a relative URL would resolve
 * against the worker's script, not the page.
 */

function assetBaseUrl(dir: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(`${import.meta.env.BASE_URL}pdfjs/${dir}/`, base).href;
}

/** Where the app serves pdf.js's CMap files, as an absolute URL with a trailing slash. */
export function cMapBaseUrl(): string {
  return assetBaseUrl('cmaps');
}

/** Where the app serves pdf.js's JBIG2 / JPEG 2000 decoder modules, as an absolute URL with a trailing slash. */
export function wasmBaseUrl(): string {
  return assetBaseUrl('wasm');
}

export function withPdfjsAssets<P extends object>(
  params: P,
): P & { cMapUrl: string; cMapPacked: true; wasmUrl: string; useWorkerFetch: false } {
  return { ...params, cMapUrl: cMapBaseUrl(), cMapPacked: true, wasmUrl: wasmBaseUrl(), useWorkerFetch: false };
}
