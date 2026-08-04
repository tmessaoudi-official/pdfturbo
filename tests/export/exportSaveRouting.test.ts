/**
 * G19 — native "Save As" (File System Access) routing on the secondary export
 * paths. downloadPDF / downloadPageRange / downloadFlattened were already wired
 * (downloadPdfSave.test.ts); this guards the rest: downloadPage, the PNG image
 * export, table-CSV, DOCX, and sanitize now use the SAME pick-first → write-or-
 * download pattern with the correct per-type filename + MIME.
 *
 * The picker (showSaveFilePicker) is mocked; the anchor download is captured by
 * overriding _downloadBlob (the production fallback). Heavy extraction
 * (pdf.js text/op walk, off-screen canvas raster) is stubbed at the private
 * extraction seam so these tests exercise the save routing, not extraction.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { ExportService, type IExportContext } from '../../src/export/exportService';

type GlobalWithPicker = typeof globalThis & { showSaveFilePicker?: unknown };
const g = globalThis as GlobalWithPicker;
afterEach(() => { delete g.showSaveFilePicker; });

async function sourceBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  return doc.save({ useObjectStreams: false });
}

interface Probe {
  svc: ExportService;
  infos: { k: string; p?: Record<string, unknown> }[];
  warns: string[];
  errors: string[];
  downloads: { blob: Blob; filename: string }[];
}

function buildProbe(src: Uint8Array): Probe {
  const infos: { k: string; p?: Record<string, unknown> }[] = [];
  const warns: string[] = [];
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
      warn: (k: string) => warns.push(k),
      error: (k: string) => errors.push(k),
    },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob = (blob, filename) =>
    downloads.push({ blob, filename });
  return { svc, infos, warns, errors, downloads };
}

interface FakeHandle { name: string; createWritable(): Promise<unknown>; }

/** Install a fake save picker; returns the captured writes, close flag + handle. */
function installPicker(name: string): {
  written: (Uint8Array | Blob)[];
  wasClosed: () => boolean;
  handle: FakeHandle;
} {
  const written: (Uint8Array | Blob)[] = [];
  let closed = false;
  const handle: FakeHandle = {
    name,
    createWritable: () => Promise.resolve({
      write: (d: BufferSource | Blob) => {
        written.push(d instanceof Blob ? d : new Uint8Array(d as ArrayBuffer));
        return Promise.resolve();
      },
      close: () => { closed = true; return Promise.resolve(); },
    }),
  };
  g.showSaveFilePicker = vi.fn(() => Promise.resolve(handle));
  return { written, wasClosed: () => closed, handle };
}

// ── _saveOrDownload helper (Blob + bytes, both branches) ──────────────────────

describe('_saveOrDownload helper', () => {
  it('writes a Blob to the handle as-is (no anchor download)', async () => {
    const probe = buildProbe(await sourceBytes());
    const cap = installPicker('x.csv');
    const blob = new Blob(['a,b\n1,2'], { type: 'text/csv' });
    await (probe.svc as unknown as {
      _saveOrDownload(t: unknown, d: Blob, f: string, m: string): Promise<void>;
    })._saveOrDownload(cap.handle, blob, 'x.csv', 'text/csv');
    expect(cap.written).toEqual([blob]);
    expect(cap.wasClosed()).toBe(true);
    expect(probe.downloads).toHaveLength(0);
  });

  it('writes Uint8Array bytes to the handle', async () => {
    const probe = buildProbe(await sourceBytes());
    const cap = installPicker('x.pdf');
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await (probe.svc as unknown as {
      _saveOrDownload(t: unknown, d: Uint8Array, f: string, m: string): Promise<void>;
    })._saveOrDownload(cap.handle, bytes, 'x.pdf', 'application/pdf');
    expect(cap.written).toHaveLength(1);
    expect(Array.from(cap.written[0] as Uint8Array)).toEqual([1, 2, 3, 4]);
    expect(probe.downloads).toHaveLength(0);
  });

  it('anchor-downloads with the given MIME when target is "download"', async () => {
    const probe = buildProbe(await sourceBytes());
    const bytes = new Uint8Array([9, 9]);
    await (probe.svc as unknown as {
      _saveOrDownload(t: unknown, d: Uint8Array, f: string, m: string): Promise<void>;
    })._saveOrDownload('download', bytes, 'y.png', 'image/png');
    expect(probe.downloads).toHaveLength(1);
    expect(probe.downloads[0].filename).toBe('y.png');
    expect(probe.downloads[0].blob.type).toBe('image/png');
  });
});

// ── downloadPage (real pdf-lib assembly) ──────────────────────────────────────

describe('downloadPage save routing', () => {
  it('writes the page PDF to a file handle when the picker is available', async () => {
    const cap = installPicker('report-page1.pdf');
    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPage(0);
    expect(g.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(probe.downloads).toHaveLength(0);
    expect(cap.written).toHaveLength(1);
    expect(cap.wasClosed()).toBe(true);
    expect(String.fromCharCode(...(cap.written[0] as Uint8Array).slice(0, 4))).toBe('%PDF');
    expect(probe.infos.map(i => i.k)).toContain('toast.pdfSaved');
    expect(probe.errors).toEqual([]);
  });

  it('falls back to the anchor download when the API is absent', async () => {
    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPage(0);
    expect(probe.downloads).toHaveLength(1);
    expect(probe.downloads[0].filename).toBe('report-page1.pdf');
    expect(probe.downloads[0].blob.type).toBe('application/pdf');
    expect(probe.infos.map(i => i.k)).toContain('toast.pageDownloaded');
  });

  it('no-ops silently when the user cancels the picker', async () => {
    g.showSaveFilePicker = () => Promise.reject(new DOMException('x', 'AbortError'));
    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPage(0);
    expect(probe.downloads).toHaveLength(0);
    expect(probe.infos).toHaveLength(0);
    expect(probe.errors).toEqual([]);
  });
});

// ── sanitizeAndDownload (real assembly + real sanitizePdf) ────────────────────

describe('sanitizeAndDownload save routing', () => {
  it('writes the sanitized PDF to a file handle', async () => {
    const cap = installPicker('report-sanitized.pdf');
    const probe = buildProbe(await sourceBytes());
    await probe.svc.sanitizeAndDownload();
    expect(g.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(probe.downloads).toHaveLength(0);
    expect(cap.written).toHaveLength(1);
    expect(String.fromCharCode(...(cap.written[0] as Uint8Array).slice(0, 4))).toBe('%PDF');
    expect(probe.infos.map(i => i.k)).toContain('toast.pdfSaved');
  });

  it('falls back to the anchor download when the API is absent', async () => {
    const probe = buildProbe(await sourceBytes());
    await probe.svc.sanitizeAndDownload();
    expect(probe.downloads).toHaveLength(1);
    expect(probe.downloads[0].filename).toBe('report-sanitized.pdf');
    expect(probe.downloads[0].blob.type).toBe('application/pdf');
    expect(probe.infos.map(i => i.k).some(k => k === 'toast.sanitized' || k === 'toast.sanitizeNothing')).toBe(true);
  });

  it('no-ops silently when the user cancels the picker', async () => {
    g.showSaveFilePicker = () => Promise.reject(new DOMException('x', 'AbortError'));
    const probe = buildProbe(await sourceBytes());
    await probe.svc.sanitizeAndDownload();
    expect(probe.downloads).toHaveLength(0);
    expect(probe.infos).toHaveLength(0);
    expect(probe.errors).toEqual([]);
  });
});

// ── exportTableCsv (extraction stubbed at the private seam) ───────────────────

describe('exportTableCsv save routing', () => {
  function stubTable(probe: Probe): void {
    (probe.svc as unknown as {
      _extractPageTableData(p: unknown): Promise<unknown>;
    })._extractPageTableData = () => Promise.resolve({
      hRules: [{ x: 0, y: 0, width: 100, height: 1 }, { x: 0, y: 50, width: 100, height: 1 }],
      vRules: [{ x: 0, y: 0, width: 1, height: 50 }, { x: 100, y: 0, width: 1, height: 50 }],
      items: [{ x: 10, y: 25, text: 'cell' }],
    });
  }

  it('writes the CSV (text/csv) to a file handle', async () => {
    const cap = installPicker('report-table.csv');
    const probe = buildProbe(await sourceBytes());
    stubTable(probe);
    await probe.svc.exportTableCsv();
    expect(g.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(probe.downloads).toHaveLength(0);
    expect(cap.written).toHaveLength(1);
    expect(cap.written[0]).toBeInstanceOf(Blob);
    expect((cap.written[0] as Blob).type).toContain('text/csv');
    expect(probe.infos.map(i => i.k)).toContain('toast.pdfSaved');
  });

  it('falls back to the anchor download when the API is absent', async () => {
    const probe = buildProbe(await sourceBytes());
    stubTable(probe);
    await probe.svc.exportTableCsv();
    expect(probe.downloads).toHaveLength(1);
    expect(probe.downloads[0].filename).toBe('report-table.csv');
    expect(probe.downloads[0].blob.type).toContain('text/csv');
    expect(probe.infos.map(i => i.k)).toContain('toast.tableExtracted');
  });

  it('no-ops silently when the user cancels the picker', async () => {
    g.showSaveFilePicker = () => Promise.reject(new DOMException('x', 'AbortError'));
    const probe = buildProbe(await sourceBytes());
    stubTable(probe);
    await probe.svc.exportTableCsv();
    expect(probe.downloads).toHaveLength(0);
    expect(probe.infos).toHaveLength(0);
  });
});

// ── exportTableXlsx (#56b) ─────────────────────────────────────────────────────
// Parity with the CSV block above, because exportTableXlsx re-implements every one of those
// behaviours with DIFFERENT constants: its own mime, its own `-table.xlsx` filename, and its own
// picker call. In particular the picker must still be acquired BEFORE the async extraction (#54
// transient activation) — reordering that is a silent regression no other test would catch.

describe('exportTableXlsx save routing', () => {
  function stubTable(probe: Probe): void {
    (probe.svc as unknown as {
      _extractPageTableData(p: unknown): Promise<unknown>;
    })._extractPageTableData = () => Promise.resolve({
      hRules: [{ x: 0, y: 0, width: 100, height: 1 }, { x: 0, y: 50, width: 100, height: 1 }],
      vRules: [{ x: 0, y: 0, width: 1, height: 50 }, { x: 100, y: 0, width: 1, height: 50 }],
      items: [{ x: 10, y: 25, text: 'cell' }],
    });
  }

  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  it('writes the workbook (spreadsheetml mime) to a file handle', async () => {
    const cap = installPicker('report-table.xlsx');
    const probe = buildProbe(await sourceBytes());
    stubTable(probe);
    await probe.svc.exportTableXlsx();
    expect(g.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(probe.downloads).toHaveLength(0);
    expect(cap.written).toHaveLength(1);
    expect((cap.written[0] as Blob).type).toBe(XLSX_MIME);
    expect(probe.infos.map(i => i.k)).toContain('toast.pdfSaved');
  });

  it('falls back to the anchor download with the .xlsx filename', async () => {
    const probe = buildProbe(await sourceBytes());
    stubTable(probe);
    await probe.svc.exportTableXlsx();
    expect(probe.downloads).toHaveLength(1);
    expect(probe.downloads[0].filename).toBe('report-table.xlsx');
    expect(probe.downloads[0].blob.type).toBe(XLSX_MIME);
    expect(probe.infos.map(i => i.k)).toContain('toast.tableExtracted');
  });

  it('no-ops silently when the user cancels the picker', async () => {
    g.showSaveFilePicker = () => Promise.reject(new DOMException('x', 'AbortError'));
    const probe = buildProbe(await sourceBytes());
    stubTable(probe);
    await probe.svc.exportTableXlsx();
    expect(probe.downloads).toHaveLength(0);
    expect(probe.infos).toHaveLength(0);
  });

  it('acquires the picker BEFORE the async extraction (#54 transient activation)', async () => {
    // Order matters and is invisible to the assertions above: an `await` before the picker call would
    // outlive the activation window and the native dialog would be refused at runtime.
    const order: string[] = [];
    installPicker('report-table.xlsx');
    const realPicker = g.showSaveFilePicker as unknown as () => Promise<unknown>;
    g.showSaveFilePicker = ((...a: unknown[]) => {
      order.push('picker');
      return (realPicker as unknown as (...x: unknown[]) => Promise<unknown>)(...a);
    }) as typeof g.showSaveFilePicker;
    const probe = buildProbe(await sourceBytes());
    (probe.svc as unknown as {
      _extractPageTableData(p: unknown): Promise<unknown>;
    })._extractPageTableData = () => {
      order.push('extract');
      return Promise.resolve({
        hRules: [{ x: 0, y: 0, width: 100, height: 1 }, { x: 0, y: 50, width: 100, height: 1 }],
        vRules: [{ x: 0, y: 0, width: 1, height: 50 }, { x: 100, y: 0, width: 1, height: 50 }],
        items: [{ x: 10, y: 25, text: 'cell' }],
      });
    };
    await probe.svc.exportTableXlsx();
    expect(order).toEqual(['picker', 'extract']);
  });

  it('warns and writes nothing when no table is found', async () => {
    const probe = buildProbe(await sourceBytes());
    (probe.svc as unknown as {
      _extractPageTableData(p: unknown): Promise<unknown>;
    })._extractPageTableData = () => Promise.resolve(null);
    await probe.svc.exportTableXlsx();
    expect(probe.downloads).toHaveLength(0);
    expect(probe.warns).toContain('toast.noTableFound');
  });
});

// ── exportAsDocx (flow extraction stubbed at the private seam) ────────────────

describe('exportAsDocx save routing', () => {
  function stubFlow(probe: Probe): void {
    (probe.svc as unknown as {
      _extractFlowDoc(): Promise<unknown>;
    })._extractFlowDoc = () => Promise.resolve({
      pages: [{
        width: 595, height: 842,
        paragraphs: [{
          runs: [{ text: 'hello', bold: false, italic: false, fontSize: 12, fontFamily: 'serif', rtl: false }],
          heading: 0,
        }],
      }],
    });
  }

  it('writes the DOCX to a file handle', async () => {
    const cap = installPicker('report.docx');
    const probe = buildProbe(await sourceBytes());
    stubFlow(probe);
    await probe.svc.exportAsDocx();
    expect(g.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(probe.downloads).toHaveLength(0);
    expect(cap.written).toHaveLength(1);
    expect(cap.written[0]).toBeInstanceOf(Blob);
    expect(probe.infos.map(i => i.k)).toContain('toast.pdfSaved');
  });

  it('falls back to the anchor download when the API is absent', async () => {
    const probe = buildProbe(await sourceBytes());
    stubFlow(probe);
    await probe.svc.exportAsDocx();
    expect(probe.downloads).toHaveLength(1);
    expect(probe.downloads[0].filename).toBe('report.docx');
    expect(probe.infos.map(i => i.k)).toContain('toast.docxExported');
  });

  it('no-ops silently when the user cancels the picker', async () => {
    g.showSaveFilePicker = () => Promise.reject(new DOMException('x', 'AbortError'));
    const probe = buildProbe(await sourceBytes());
    stubFlow(probe);
    await probe.svc.exportAsDocx();
    expect(probe.downloads).toHaveLength(0);
    expect(probe.infos).toHaveLength(0);
  });
});
