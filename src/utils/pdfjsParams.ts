/**
 * The ONE way `src/` builds the parameters of a pdf.js `getDocument` call. A call that bypasses it is
 * banned (`tests/infra/pdfjsParams.test.ts`).
 *
 * Three kinds of pdf.js data file are served from the app's own origin (the CSP allows no other,
 * `connect-src 'self'`), vendored by `scripts/prepare-pdfjs-assets.mjs`:
 *
 * - `cMapUrl` → `public/pdfjs/cmaps/`. A CID font whose encoding is a predefined Adobe CMap — common in
 *   Japanese, Chinese and Korean PDFs — decodes only with these; without them the page's text is neither
 *   drawn, selectable, searchable nor exported (row 32 of the limits plan).
 * - `wasmUrl` → `public/pdfjs/wasm/`. pdf.js's JBIG2 and JPEG 2000 decoders (WebAssembly, plus a pure-JS
 *   fallback for when WebAssembly cannot run). Without them every such image draws NOTHING, so a scanned
 *   black-and-white page is blank in the editor, thumbnails, rasters and OCR (row 36).
 * - `iccUrl` → `public/pdfjs/iccs/`, plus `qcms_bg.wasm` in the wasm folder: pdf.js's colour management
 *   (row 37). With it, DeviceCMYK colour goes through a CMYK profile and ICC-tagged colour through its own
 *   profile, as in pdf.js's own viewer and any colour-managed reader. Without it pdf.js used a fitted formula:
 *   rich black on the Pub 17 cover came out slate-blue (44,46,53) where Ghostscript draws (35,31,32).
 *
 * `useWorkerFetch` is TRUE because pdf.js enables its ICC module only when the worker fetches its own data
 * (`IccColorSpace.setOptions`). The worker then also fetches the CMaps itself — measured pixel-identical. If
 * the colour module cannot load (offline before it was cached), pdf.js warns and draws as it did without it.
 * No `standardFontDataUrl`: that would change how non-embedded fonts are drawn, a separate, unruled change.
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

/** Where the app serves pdf.js's wasm modules (JBIG2, JPEG 2000, colour management), absolute, trailing slash. */
export function wasmBaseUrl(): string {
  return assetBaseUrl('wasm');
}

/** Where the app serves pdf.js's default CMYK profile, as an absolute URL with a trailing slash. */
export function iccBaseUrl(): string {
  return assetBaseUrl('iccs');
}

export function withPdfjsAssets<P extends object>(
  params: P,
): P & { cMapUrl: string; cMapPacked: true; wasmUrl: string; iccUrl: string; useWorkerFetch: true } {
  return {
    ...params, cMapUrl: cMapBaseUrl(), cMapPacked: true, wasmUrl: wasmBaseUrl(), iccUrl: iccBaseUrl(), useWorkerFetch: true,
  };
}
