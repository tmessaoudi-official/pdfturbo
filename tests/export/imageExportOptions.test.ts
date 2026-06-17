/**
 * G20 — page-image export resolution + format control.
 *
 * downloadPageAsImage was hardcoded to scale-2 PNG (`toBlob('image/png')`). It now
 * accepts `{ scale, format, quality }`:
 *   - no opts        → image/png at scale 2, `.png` save name  (byte-identical to pre-G20)
 *   - { jpeg, q }    → image/jpeg + quality forwarded to toBlob, `.jpg` save name
 *   - scale > 1      → the pdf.js viewport is built at that scale (bigger canvas)
 *   - out-of-range   → scale clamped to [1,6], quality clamped to [0.5,1]
 *
 * pdf.js rendering is stubbed at the module seam (getDocument) so the test exercises
 * the option → viewport/toBlob/save-name wiring, not real rasterization (that lives in
 * the browser harness). The save routing reuses the G19 pick-first → write-or-download
 * helper; here the picker is absent so it falls back to the captured anchor download.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { ExportService, type IExportContext } from '../../src/export/exportService';

// ── pdf.js stub ────────────────────────────────────────────────────────────────
// Capture the scale handed to getViewport so we can assert the resolution control.
// pdfjs-dist is an ESM namespace (non-configurable exports) — it must be replaced
// via vi.mock, not vi.spyOn. The hoisted capture box lets the factory record the
// scale each getViewport call receives.
const cap = vi.hoisted(() => ({ lastScale: undefined as number | undefined }));

vi.mock('pdfjs-dist', () => {
  const getDocument = () => ({
    promise: Promise.resolve({
      getPage: () => Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => {
          cap.lastScale = scale;
          return { width: 100 * scale, height: 200 * scale };
        },
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
  });
  return { default: { getDocument, OPS: {} }, getDocument, OPS: {} };
});

// ── canvas/toBlob stub ──────────────────────────────────────────────────────────
// jsdom's HTMLCanvasElement has no 2d context / toBlob; record the (type, quality)
// pair toBlob is called with, and the canvas pixel dimensions.
interface BlobCall { type: string; quality: number | undefined; }
let blobCalls: BlobCall[];
let canvasDims: { w: number; h: number }[];

function stubCanvas(): void {
  blobCalls = [];
  canvasDims = [];
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: unknown;
    toBlob: unknown;
  };
  proto.getContext = function () { return {} as CanvasRenderingContext2D; };
  proto.toBlob = function (
    this: HTMLCanvasElement,
    cb: (b: Blob | null) => void,
    type?: string,
    quality?: number,
  ) {
    canvasDims.push({ w: this.width, h: this.height });
    blobCalls.push({ type: type ?? 'image/png', quality });
    cb(new Blob(['img'], { type: type ?? 'image/png' }));
  };
}

afterEach(() => { vi.restoreAllMocks(); });

// ── probe (mirrors exportSaveRouting.test.ts) ────────────────────────────────────
interface Probe {
  svc: ExportService;
  infos: { k: string; p?: Record<string, unknown> }[];
  errors: string[];
  downloads: { blob: Blob; filename: string }[];
}

async function sourceBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  return doc.save({ useObjectStreams: false });
}

function buildProbe(src: Uint8Array): Probe {
  const infos: { k: string; p?: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  const downloads: { blob: Blob; filename: string }[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: 1,
      currentPageIndex: 0,
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { bytes: src }]]),
      watermark: { enabled: false },
      bates: { enabled: false },
    },
    elements: [],
    formValues: {},
    currentFilename: 'report.pdf',
    exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: {
      info: (k: string, p?: Record<string, unknown>) => infos.push({ k, p }),
      warn: () => {},
      error: (k: string) => errors.push(k),
    },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  // The pdf-lib assembly produces real bytes; getDocument is stubbed, so the bytes
  // are never actually parsed. _applyOverlaysToPage runs against an empty element
  // list (cheap). Capture the anchor download (no picker installed → 'download').
  (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob = (blob, filename) =>
    downloads.push({ blob, filename });
  return { svc, infos, errors, downloads };
}

beforeEach(() => { cap.lastScale = undefined; stubCanvas(); });

describe('downloadPageAsImage — default (no opts) is unchanged', () => {
  it('renders PNG at scale 2 and a .png download name', async () => {
    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPageAsImage(0);
    expect(probe.errors).toEqual([]);
    expect(cap.lastScale).toBe(2);
    expect(blobCalls).toHaveLength(1);
    expect(blobCalls[0].type).toBe('image/png');
    // PNG path forwards no quality argument (matches the historic toBlob call).
    expect(blobCalls[0].quality).toBeUndefined();
    expect(canvasDims[0]).toEqual({ w: 200, h: 400 }); // 100*2 × 200*2
    expect(probe.downloads).toHaveLength(1);
    expect(probe.downloads[0].filename).toBe('report-page1.png');
    expect(probe.downloads[0].blob.type).toBe('image/png');
    expect(probe.infos.map(i => i.k)).toContain('toast.imageExported');
  });
});

describe('downloadPageAsImage — JPEG option', () => {
  it('renders image/jpeg with the quality forwarded and a .jpg name', async () => {
    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPageAsImage(0, { format: 'jpeg', quality: 0.7, scale: 3 });
    expect(probe.errors).toEqual([]);
    expect(cap.lastScale).toBe(3);
    expect(blobCalls[0].type).toBe('image/jpeg');
    expect(blobCalls[0].quality).toBe(0.7);
    expect(canvasDims[0]).toEqual({ w: 300, h: 600 });
    expect(probe.downloads[0].filename).toBe('report-page1.jpg');
    expect(probe.downloads[0].blob.type).toBe('image/jpeg');
  });
});

describe('downloadPageAsImage — clamping', () => {
  it('clamps an over-range scale to 6', async () => {
    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPageAsImage(0, { scale: 99 });
    expect(cap.lastScale).toBe(6);
    expect(canvasDims[0]).toEqual({ w: 600, h: 1200 });
  });

  it('clamps an under-range scale to 1', async () => {
    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPageAsImage(0, { scale: 0.1 });
    expect(cap.lastScale).toBe(1);
  });

  it('clamps an over-range JPEG quality to 1', async () => {
    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPageAsImage(0, { format: 'jpeg', quality: 5 });
    expect(blobCalls.at(-1)?.quality).toBe(1);
  });

  it('clamps an under-range JPEG quality to 0.5', async () => {
    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPageAsImage(0, { format: 'jpeg', quality: 0.01 });
    expect(blobCalls.at(-1)?.quality).toBe(0.5);
  });
});
