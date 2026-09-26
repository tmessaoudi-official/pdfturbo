/**
 * The ONE way `src/` builds the parameters of a pdf.js `getDocument` call. A call that bypasses it is
 * banned (`tests/infra/pdfjsParams.test.ts`).
 *
 * A CID font whose encoding is a predefined Adobe CMap — common in Japanese, Chinese and Korean PDFs —
 * can only be decoded with pdf.js's packed CMap files. Without `cMapUrl` pdf.js cannot read the codes
 * and the page's text is neither selectable, searchable nor exported (row 32 of the limits plan).
 * `scripts/prepare-pdfjs-assets.mjs` vendors the files into `public/pdfjs/cmaps/`, so they are served
 * from the app's own origin — the CSP allows no other (`connect-src 'self'`).
 *
 * The URL is ABSOLUTE: pdf.js fetches CMaps from its worker when it can (`useWorkerFetch`), and a
 * relative URL would resolve against the worker's script, not the page.
 */

/** Where the app serves pdf.js's CMap files, as an absolute URL with a trailing slash. */
export function cMapBaseUrl(): string {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(`${import.meta.env.BASE_URL}pdfjs/cmaps/`, base).href;
}

export function withCMaps<P extends object>(params: P): P & { cMapUrl: string; cMapPacked: true } {
  return { ...params, cMapUrl: cMapBaseUrl(), cMapPacked: true };
}
