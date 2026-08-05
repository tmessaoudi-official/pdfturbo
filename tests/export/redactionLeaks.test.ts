/**
 * Redaction must not leak through the NON-PDF exports.
 *
 * Two paths were found handing redacted source text straight back, while the DOCX/MD/TXT path had
 * carried a filter (and a comment explaining it) all along:
 *
 *   1. Table → CSV / XLSX — `_extractPageTableData` read the raw `getTextContent()`.
 *   2. OCR → "Copy text" / "Export to Word" — the page was rasterised for recognition with no burn,
 *      so tesseract read the text under the box.
 *
 * Both are guarded here at the WIRING level, which is where they broke: the underlying geometry
 * (`isItemRedacted`, `redactionRectToContent`) was already correct and already tested — the defect was
 * that two of four extractors never called it. Sibling code paths that must share a safety filter are
 * exactly where a green suite gives false assurance, so each test below fails if the call is removed.
 */
import { describe, it, expect, vi } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { ExportService, type IExportContext } from '../../src/export/exportService';

const SECRET = 'Wolgast';
const W = 300, H = 400;

// `'download'` is the real sentinel for "no native picker" — returning null instead sends
// `_saveOrDownload` into the write-to-handle branch with a null handle.
vi.mock('../../src/utils/fileSystemAccess', () => ({
  canUseFsSave: () => false,
  pickSaveTarget: () => Promise.resolve('download'),
  writeToHandle: () => Promise.resolve(),
}));

/** A 4-row x 3-col borderless grid; row 2 col 2 carries the secret. */
function tableItems(): unknown[] {
  const rows = [
    ['Ref', 'Client', 'Total'],
    ['A-1', SECRET, '19.98'],
    ['A-2', 'Mainz', '24.50'],
    ['A-3', 'Trier', '35.00'],
  ];
  const xs = [40, 140, 240];
  const out: unknown[] = [];
  rows.forEach((r, ri) => {
    const y = 300 - ri * 30;                    // PDF space, y-up
    r.forEach((text, ci) => {
      out.push({ str: text, transform: [11, 0, 0, 11, xs[ci], y], width: text.length * 6, height: 11 });
    });
  });
  return out;
}

/** Editor DISPLAY-space rect (top-left) covering the secret cell: PDF y=270 → display y = 400-270-11. */
const COVER = { x: 135, y: H - 270 - 14, width: 90, height: 20 };

function buildCtx(elements: unknown[], src: unknown): { ctx: IExportContext; warns: string[] } {
  const warns: string[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: 1,
      currentPageIndex: 0,
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', src]]),
      watermark: { enabled: false },
      bates: { enabled: false },
    },
    elements,
    formValues: {},
    currentFilename: 'report.pdf',
    exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info() {}, warn: (k: string) => warns.push(k), error() {} },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  return { ctx, warns };
}

/** A fake pdf.js page carrying `tableItems()` and no vector rules (so the borderless path runs). */
function fakeSource(): unknown {
  return {
    bytes: new Uint8Array(0),
    doc: {
      getPage: () => Promise.resolve({
        rotate: 0,
        getViewport: () => ({ width: W, height: H }),
        getTextContent: () => Promise.resolve({ items: tableItems() }),
        getOperatorList: () => Promise.resolve({ fnArray: [], argsArray: [] }),
      }),
    },
  };
}

describe('redaction does not leak into the table exports (CSV / XLSX)', () => {
  it('a redacted cell is absent from the CSV', async () => {
    const redaction = { pageId: 'p1', type: 'redaction', ...COVER, color: '#000000' };
    const { ctx, warns } = buildCtx([redaction], fakeSource());
    void warns;
    const svc = new ExportService(ctx);
    const downloads: { blob: Blob; filename: string }[] = [];
    (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob =
      (blob, filename) => downloads.push({ blob, filename });

    await svc.exportTableCsv();

    expect(downloads).toHaveLength(1);
    const csv = await downloads[0].blob.text();
    expect(csv, 'redacted text must not reach the CSV').not.toContain(SECRET);
    // Non-vacuous: the rest of the table still exports, so the filter is surgical rather than a
    // wholesale failure that would also satisfy the assertion above.
    expect(csv).toContain('Mainz');
    expect(csv).toContain('Total');
  });

  it('without a redaction the same cell DOES export (proves the fixture reaches the grid)', async () => {
    const { ctx } = buildCtx([], fakeSource());
    const svc = new ExportService(ctx);
    const downloads: { blob: Blob; filename: string }[] = [];
    (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob =
      (blob, filename) => downloads.push({ blob, filename });

    await svc.exportTableCsv();

    const csv = await downloads[0].blob.text();
    expect(csv, 'control: the secret is genuinely detected as a cell').toContain(SECRET);
  });
});

describe('redaction is burned onto the OCR canvas before recognition', () => {
  it('fills each redaction rect at render scale, so the engine cannot read the text', async () => {
    const { OcrHandler } = await import('../../src/handlers/ocrHandler');
    const fills: number[][] = [];
    const ctx2d = {
      fillRect: (x: number, y: number, w: number, h: number) => { fills.push([x, y, w, h]); },
      set fillStyle(_v: string) {},
      get fillStyle() { return '#000000'; },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx2d as unknown as CanvasRenderingContext2D);

    const redaction = { pageId: 'p1', type: 'redaction', x: 10, y: 20, width: 30, height: 40, color: '#000000' };
    const app = {
      reportError: { info() {}, warn() {}, error() {} },
      documentModel: {
        pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
        sourcePdfs: new Map(),
      },
      historyManager: { execute: vi.fn() },
      elements: [redaction],
      rebuildElementLayer() {},
      autosave() {},
      _applySourcePdfEdit: () => Promise.resolve(true),
    };
    const handler = new OcrHandler(app as never);
    const page = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 };
    const src = {
      bytes: new Uint8Array(0),
      doc: {
        getPage: () => Promise.resolve({
          getViewport: () => ({ width: W, height: H }),
          render: () => ({ promise: Promise.resolve() }),
        }),
      },
    };

    await (handler as unknown as {
      _recognize: (p: unknown, s: unknown, l: string) => Promise<unknown>;
    })._recognize(page, src, 'eng').catch(() => null);   // recognition itself may bail in jsdom

    // RENDER_SCALE is 2, so a 10,20,30x40 box must be filled at 20,40,60x80. Asserting the SCALED
    // values matters: an unscaled fill would cover a quarter of the intended area and leave the
    // bottom-right of the secret legible — a partial burn reads as "it works" in a screenshot.
    expect(fills, 'the redaction must be burned before recognition').toContainEqual([20, 40, 60, 80]);
  });
});

/** Keep the pdf-lib import meaningful — a byte source is what the real service is handed. */
it('sanity: the harness builds a real single-page PDF', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([W, H]);
  expect((await doc.save()).byteLength).toBeGreaterThan(0);
});
