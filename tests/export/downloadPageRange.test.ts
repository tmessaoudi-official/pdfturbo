/**
 * downloadPageRange (#59) — extract a subset of pages into a new PDF. Reuses the
 * _assemblePdfDoc pipeline with an explicit page subset. parsePageRange is unit-
 * tested separately; this asserts the wired export produces a PDF with exactly
 * the selected pages and the right toasts, over a real multi-page pdf-lib source.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { ExportService, type IExportContext } from '../../src/export/exportService';

async function sourceBytes(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([300, 400]);
  return doc.save({ useObjectStreams: false });
}

interface Probe {
  svc: ExportService;
  infos: { k: string; p?: Record<string, unknown> }[];
  warns: string[];
  downloads: { blob: Blob; filename: string }[];
}

function buildProbe(src: Uint8Array, pageCount: number): Probe {
  const infos: { k: string; p?: Record<string, unknown> }[] = [];
  const warns: string[] = [];
  const downloads: { blob: Blob; filename: string }[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount,
      pages: Array.from({ length: pageCount }, (_u, i) => ({ id: `p${i + 1}`, sourcePdfId: 's1', sourcePageNum: i + 1, rotation: 0 })),
      sourcePdfs: new Map([['s1', { bytes: src }]]),
      watermark: { enabled: false },
    },
    elements: [],
    formValues: {},
    currentFilename: 'doc.pdf',
    exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: {
      info: (k: string, p?: Record<string, unknown>) => infos.push({ k, p }),
      warn: (k: string) => warns.push(k),
      error: () => {},
    },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob = (blob, filename) =>
    downloads.push({ blob, filename });
  return { svc, infos, warns, downloads };
}

describe('downloadPageRange', () => {
  it('extracts exactly the selected pages into a new PDF', async () => {
    const probe = buildProbe(await sourceBytes(5), 5);
    await probe.svc.downloadPageRange([0, 2, 4]);

    expect(probe.downloads).toHaveLength(1);
    expect(probe.downloads[0].filename).toBe('doc-extract.pdf');
    const bytes = new Uint8Array(await probe.downloads[0].blob.arrayBuffer());
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(3);
    expect(probe.infos.find(i => i.k === 'toast.extractDone')?.p).toEqual({ count: 3 });
  });

  it('warns and does nothing for an empty selection', async () => {
    const probe = buildProbe(await sourceBytes(5), 5);
    await probe.svc.downloadPageRange([]);
    expect(probe.downloads).toHaveLength(0);
    expect(probe.warns).toContain('toast.extractNoPages');
  });

  it('drops out-of-range indices (empty result → warn)', async () => {
    const probe = buildProbe(await sourceBytes(3), 3);
    await probe.svc.downloadPageRange([99, -1]);
    expect(probe.downloads).toHaveLength(0);
    expect(probe.warns).toContain('toast.extractNoPages');
  });
});
