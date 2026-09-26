/**
 * Row 36 (real Chrome) — JBIG2 and JPEG 2000 images decode, so a scanned page is not blank.
 *
 * pdf.js decodes both codecs with WebAssembly modules (with a pure-JS fallback) that it loads from
 * `wasmUrl`. `src/` never passed it, so both decoders "failed to initialize" and every such image drew
 * NOTHING — measured 2026-09-26 on pdf.js's own test files: 0 non-white pixels on all four pages, against
 * 5067 / 5043 / 8192 / 600 with the modules served. JBIG2 is what bilevel document scanners write, so a
 * scanned black-and-white PDF showed a blank page, a blank thumbnail, blank rasters, and OCR read nothing.
 * The vector PDF export was never affected: pdf-lib copies the stream bytes and any other viewer decodes
 * them.
 *
 * The modules are vendored into `public/pdfjs/wasm/` by `scripts/prepare-pdfjs-assets.mjs`, and every
 * `getDocument` in `src/` goes through `withPdfjsAssets` (static guard: `tests/infra/pdfjsParams.test.ts`).
 *
 * The CONTROL is a Flate-compressed image page, which needs no module: it must render before and after,
 * so a red here is about the decoders, not the fixture or the harness.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { withPdfjsAssets } from '../../src/utils/pdfjsParams';
import { pointViewport } from '../../src/utils/pointViewport';
import { loadPdfDocument } from '../../src/utils/pdfLoadGuard';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { DocumentPage } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import jbig2Symbols from '../fixtures/scan-codecs/jbig2_symbol_offset.pdf?url';
import jbig2Header from '../fixtures/scan-codecs/jbig2_file_header.pdf?url';
import jpxBug from '../fixtures/scan-codecs/bug_jpx.pdf?url';
import jpxResetProb from '../fixtures/scan-codecs/jp2k-resetprob.pdf?url';
import flateControl from '../fixtures/qa-imageonly.pdf?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

/** Each fixture and the non-white pixel count measured WITH the modules (2026-09-26); 0 without. */
const FIXTURES: Array<[string, string, number]> = [
  ['JBIG2, symbol dictionary', jbig2Symbols, 5067],
  ['JBIG2, embedded file header', jbig2Header, 5043],
  ['JPEG 2000', jpxBug, 8192],
  ['JPEG 2000, reset-probabilities', jpxResetProb, 600],
];

const failLoud = {
  info() {},
  silent(_e?: unknown, msg?: string) { throw new Error(`export reported: ${msg}`); },
  warn(key: string) { throw new Error(`export warned: ${key}`); },
  error(key: string, err?: unknown) { throw new Error(`export errored: ${key} ${String(err)}`); },
} as unknown as IErrorReporter;

async function bytesOf(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

function open(bytes: Uint8Array, extra: object = {}): Promise<pdfjsLib.PDFDocumentProxy> {
  return pdfjsLib.getDocument({ ...withPdfjsAssets({ data: bytes.slice(0) }), ...extra }).promise;
}

function nonWhite(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const d = ctx.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) n++;
  return n;
}

/** Non-white pixels of page 1 rendered at scale 1 onto a white canvas. */
async function inkOf(doc: pdfjsLib.PDFDocumentProxy): Promise<number> {
  const page = await doc.getPage(1);
  const vp = pointViewport(page, { scale: 1 });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, canvasContext: ctx, viewport: vp } as never).promise;
  return nonWhite(ctx, c.width, c.height);
}

describe('row 36 — the JBIG2 / JPEG 2000 decoders are served', () => {
  it('the wasm URL is an absolute same-origin directory, and the app serves the modules there', async () => {
    const { wasmUrl } = withPdfjsAssets({ data: new Uint8Array() }) as { wasmUrl?: string };
    expect(wasmUrl).toMatch(/^https?:\/\//);
    const url = new URL(wasmUrl as string);
    expect(url.origin).toBe(location.origin);
    expect(url.pathname.endsWith('/pdfjs/wasm/')).toBe(true);
    // The BODY must be the module, not the dev server's HTML fallback, which answers any missing path
    // with a 200 (the row-32 trap). A wasm module opens with \0asm.
    for (const f of ['jbig2.wasm', 'openjpeg.wasm']) {
      const res = await fetch(`${wasmUrl}${f}`);
      expect(res.status, f).toBe(200);
      expect([...new Uint8Array(await res.arrayBuffer()).slice(0, 4)], f).toEqual([0x00, 0x61, 0x73, 0x6d]);
    }
    for (const f of ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']) {
      const body = await (await fetch(`${wasmUrl}${f}`)).text();
      expect(body.trimStart().startsWith('<'), `${f} is HTML`).toBe(false);
      expect(body, f).toContain('export default');
    }
  });

  for (const [label, url, measured] of FIXTURES) {
    it(`${label}: the image draws`, async () => {
      expect(await inkOf(await open(await bytesOf(url)))).toBeGreaterThan(measured / 2);
    });
  }

  for (const [label, url, measured] of [FIXTURES[0], FIXTURES[2]]) {
    it(`${label}: the pure-JS fallback, used when WebAssembly cannot run, draws it too`, async () => {
      expect(await inkOf(await open(await bytesOf(url), { useWasm: false }))).toBeGreaterThan(measured / 2);
    });
  }

  for (const [label, url] of FIXTURES) {
    it(`${label}: the viewer check every export runs accepts it`, async () => {
      const doc = await loadPdfDocument(await bytesOf(url), { viewerCheck: 'source', updateMetadata: false });
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });
  }

  it('JBIG2: export page as image carries the scan, not a blank page', async () => {
    const bytes = await bytesOf(jbig2Symbols);
    const doc = await open(bytes);
    const docPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } as DocumentPage;
    let settle!: (b: Blob) => void;
    const captured = new Promise<Blob>(res => { settle = res; });
    const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
    const svc = new ExportService({
      documentModel: {
        pageCount: 1, currentPageIndex: 0, pages: [docPage],
        sourcePdfs: new Map([['s1', { doc, bytes }]]),
        watermark: { enabled: false }, bates: { enabled: false },
      },
      elements: [], formValues: {}, currentFilename: 'x.pdf', exportPassword: null,
      inkLayer: { getStrokes: () => [] },
      reportError: failLoud,
      progress: { begin: () => handle },
    } as unknown as IExportContext) as unknown as {
      _saveOrDownload(t: unknown, b: Blob): Promise<void>;
      downloadPageAsImage(i: number, o: { scale: number; format: 'png' }): Promise<void>;
    };
    svc._saveOrDownload = (_t, b) => { settle(b); return Promise.resolve(); };
    const picker = globalThis as typeof globalThis & { showSaveFilePicker?: unknown };
    const saved = picker.showSaveFilePicker;
    delete picker.showSaveFilePicker;
    try {
      await svc.downloadPageAsImage(0, { scale: 1, format: 'png' });
      const bmp = await createImageBitmap(await captured);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0);
      expect(nonWhite(ctx, c.width, c.height)).toBeGreaterThan(FIXTURES[0][2] / 2);
    } finally {
      if (saved !== undefined) picker.showSaveFilePicker = saved;
    }
  });

  it('CONTROL: a Flate image page, which needs no module, draws', async () => {
    expect(await inkOf(await open(await bytesOf(flateControl)))).toBeGreaterThan(100);
  });
});
