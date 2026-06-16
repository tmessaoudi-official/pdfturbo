/**
 * downloadPDF save routing (#54): the main Download uses the File System Access
 * picker when available (write to a handle), and falls back to the anchor
 * download otherwise. fileSystemAccess.test.ts unit-tests the helper; this
 * exercises the wired ExportService.downloadPDF over a real pdf-lib assembly.
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
  errors: string[];
  downloads: { blob: Blob; filename: string }[];
}

function buildProbe(src: Uint8Array): Probe {
  const infos: { k: string; p?: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  const downloads: { blob: Blob; filename: string }[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: 1,
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { bytes: src }]]),
      watermark: { enabled: false },
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
  (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob = (blob, filename) =>
    downloads.push({ blob, filename });
  return { svc, infos, errors, downloads };
}

describe('downloadPDF save routing', () => {
  it('writes to a file handle when the picker is available', async () => {
    const written: Uint8Array[] = [];
    let closed = false;
    g.showSaveFilePicker = vi.fn(() => Promise.resolve({
      name: 'report-edited.pdf',
      createWritable: () => Promise.resolve({
        write: (d: BufferSource) => { written.push(new Uint8Array(d as ArrayBuffer)); return Promise.resolve(); },
        close: () => { closed = true; return Promise.resolve(); },
      }),
    }));

    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPDF();

    expect(g.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(probe.downloads).toHaveLength(0); // did NOT fall back to download
    expect(written).toHaveLength(1);
    expect(closed).toBe(true);
    expect(String.fromCharCode(...written[0].slice(0, 4))).toBe('%PDF');
    expect(probe.infos.map(i => i.k)).toContain('toast.pdfSaved');
    expect(probe.infos.find(i => i.k === 'toast.pdfSaved')?.p).toEqual({ name: 'report-edited.pdf' });
    expect(probe.errors).toEqual([]);
  });

  it('no-ops silently when the user cancels the picker', async () => {
    g.showSaveFilePicker = () => Promise.reject(new DOMException('x', 'AbortError'));
    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPDF();

    expect(probe.downloads).toHaveLength(0);
    expect(probe.infos).toHaveLength(0);
    expect(probe.errors).toEqual([]);
  });

  it('falls back to the anchor download when the API is absent', async () => {
    const probe = buildProbe(await sourceBytes());
    await probe.svc.downloadPDF();

    expect(probe.downloads).toHaveLength(1);
    expect(probe.downloads[0].filename).toBe('report-edited.pdf');
    expect(probe.infos.map(i => i.k)).toContain('toast.pdfDownloaded');
  });
});
