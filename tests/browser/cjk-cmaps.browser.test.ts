/**
 * Row 32 (real Chrome) — pdf.js's CMap files are served by the app, so text that needs one shows,
 * extracts and exports.
 *
 * A CID font whose encoding is a predefined Adobe CMap (common in Japanese and Chinese PDFs) is
 * decoded with pdf.js's packed CMap files. Without `cMapUrl` pdf.js cannot read the codes: pdf.js's
 * own `vertical.pdf` rendered no glyphs and extracted no text in the app (measured 2026-09-25, A1).
 * The files are vendored into `public/pdfjs/cmaps/` by `scripts/prepare-pdfjs-assets.mjs` and every
 * `getDocument` in `src/` goes through `withCMaps` (the static guard is `tests/infra/pdfjsParams.test.ts`).
 *
 * The CONTROL is LibreOffice's vertical layout, whose embedded glyphs need no CMap: it must pass before
 * and after, so a red here is about CMaps, not about the fixture or the harness.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { withCMaps } from '../../src/utils/pdfjsParams';
import { pointViewport } from '../../src/utils/pointViewport';
import { loadPdfDocument } from '../../src/utils/pdfLoadGuard';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { DocumentPage } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { FlowDoc } from '../../src/utils/flowDoc';
import verticalUrl from '../fixtures/vertical/pdfjs-vertical.pdf?url';
import libreUrl from '../fixtures/vertical/libreoffice-tb-rl.pdf?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const CJK = /[぀-ヿ㐀-鿿]/;
const failLoud = {
  info() {},
  silent(_e?: unknown, msg?: string) { throw new Error(`export reported: ${msg}`); },
  warn(key: string) { throw new Error(`export warned: ${key}`); },
  error(key: string, err?: unknown) { throw new Error(`export errored: ${key} ${String(err)}`); },
} as unknown as IErrorReporter;
const docPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } as DocumentPage;

async function bytesOf(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

function open(bytes: Uint8Array): Promise<pdfjsLib.PDFDocumentProxy> {
  return pdfjsLib.getDocument(withCMaps({ data: bytes.slice(0) })).promise;
}

async function pageText(doc: pdfjsLib.PDFDocumentProxy): Promise<string> {
  const tc = await (await doc.getPage(1)).getTextContent();
  return tc.items.map(i => ('str' in i ? i.str : '')).join('');
}

/** What `tests/fixtures/vertical/pdfjs-vertical.pdf` says — read by pdf.js WITH its CMaps (2026-09-26). */
const VERTICAL_TEXT = 'あいうえお日本語';

/**
 * Dark pixels in the TOP-RIGHT text area of a scale-1 render of page 1, clear of the page's border
 * rules. Those rules alone are ~500 dark pixels, so a whole-page count cannot tell a blank page from a
 * written one (measured 2026-09-26: 498 on the whole page without CMaps, the text area blank).
 */
async function inkPixels(doc: pdfjsLib.PDFDocumentProxy): Promise<number> {
  const page = await doc.getPage(1);
  const vp = pointViewport(page, { scale: 1 });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  await page.render({ canvas: c, canvasContext: ctx, viewport: vp } as never).promise;
  const x0 = Math.floor(c.width / 2), y0 = 4;
  const d = ctx.getImageData(x0, y0, c.width - 4 - x0, Math.floor(c.height * 0.4)).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) n++;
  return n;
}

async function flowText(doc: pdfjsLib.PDFDocumentProxy, bytes: Uint8Array): Promise<string> {
  const svc = new ExportService({
    documentModel: { pages: [docPage], sourcePdfs: new Map([['s1', { doc, bytes }]]) },
    elements: [],
    reportError: failLoud,
  } as unknown as IExportContext) as unknown as { _extractFlowDoc(): Promise<FlowDoc> };
  return JSON.stringify((await svc._extractFlowDoc()).pages[0].paragraphs);
}

describe('row 32 — CMaps are served, so CMap-encoded text shows and exports', () => {
  it('the CMap URL is an absolute same-origin directory, and the app serves the files there', async () => {
    const { cMapUrl, cMapPacked } = withCMaps({ data: new Uint8Array() }) as { cMapUrl?: string; cMapPacked?: boolean };
    expect(cMapPacked).toBe(true);
    expect(cMapUrl).toMatch(/^https?:\/\//);
    const url = new URL(cMapUrl as string);
    expect(url.origin).toBe(location.origin);
    expect(url.pathname.endsWith('/pdfjs/cmaps/')).toBe(true);
    const res = await fetch(`${cMapUrl}UniJIS-UCS2-H.bcmap`);
    expect(res.status).toBe(200);
    // The BODY must be a packed CMap, not the dev server's HTML fallback, which answers any missing
    // path with a 200 (measured 2026-09-26: with public/pdfjs/ removed, status and size both passed).
    // Every pdf.js .bcmap opens with a type byte then e0 52 43.
    expect([...new Uint8Array(await res.arrayBuffer()).slice(1, 4)]).toEqual([0xe0, 0x52, 0x43]);
  });

  it("pdf.js's vertical.pdf: page text is extracted", async () => {
    expect(await pageText(await open(await bytesOf(verticalUrl)))).toBe(VERTICAL_TEXT);
  });

  it("pdf.js's vertical.pdf: the glyphs are drawn", async () => {
    // Without CMaps this area is EMPTY; with them the eight glyphs measured 78 dark pixels (2026-09-26).
    expect(await inkPixels(await open(await bytesOf(verticalUrl)))).toBeGreaterThan(30);
  });

  it("pdf.js's vertical.pdf: the Word/Markdown/text export carries the text", async () => {
    const bytes = await bytesOf(verticalUrl);
    const flow = await flowText(await open(bytes), bytes);
    for (const ch of VERTICAL_TEXT) expect(flow).toContain(ch);
  });

  it("pdf.js's vertical.pdf: the viewer check every export runs accepts it", async () => {
    const doc = await loadPdfDocument(await bytesOf(verticalUrl), { viewerCheck: 'source', updateMetadata: false });
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });

  it('CONTROL: LibreOffice vertical layout (embedded glyphs, no CMap) extracts and draws', async () => {
    const bytes = await bytesOf(libreUrl);
    const doc = await open(bytes);
    expect(await pageText(doc)).toMatch(CJK);
    expect(await inkPixels(doc)).toBeGreaterThan(200);
  });
});
