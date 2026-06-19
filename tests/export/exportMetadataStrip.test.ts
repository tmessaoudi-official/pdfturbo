/**
 * QA sweep 2026-06-19 (P3) — the default download (downloadPDF) embedded pdf-lib's own
 * `/Producer` + `/Creator` ("…Hopding/pdf-lib") and a Creation/ModDate timestamp, a needless
 * metadata footprint for a privacy-first ("nothing leaves your browser") tool.
 *
 * Fix: the user-facing download paths assemble with `PDFDocument.create({ updateMetadata: false })`
 * (via opts.cleanMetadata), so pdf-lib does not stamp its Producer/dates. The fix is DELIBERATELY
 * scoped to the download paths: `assemblePdfBytes()` (which feeds sign/compress/SANITIZE) keeps the
 * default, so the sanitize feature still has the stamp to strip — see the assemblePdfBytes guard below.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { ExportService, type IExportContext } from '../../src/export/exportService';

async function sourceBytes(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage([300, 400]);
  return d.save({ useObjectStreams: false });
}

function buildProbe(src: Uint8Array): { svc: ExportService; downloads: { bytes: Uint8Array; filename: string }[] } {
  const downloads: { bytes: Uint8Array; filename: string }[] = [];
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
    reportError: { info() {}, warn() {}, error() {} },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _saveBytesTo: (t: unknown, b: Uint8Array, f: string) => Promise<void> })._saveBytesTo =
    (_t, bytes, filename) => { downloads.push({ bytes, filename }); return Promise.resolve(); };
  return { svc, downloads };
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return s;
}

describe('export metadata strip (P3)', () => {
  it('downloadPDF output carries NO pdf-lib Producer/Creator metadata', async () => {
    const { svc, downloads } = buildProbe(await sourceBytes());
    await svc.downloadPDF();
    expect(downloads).toHaveLength(1);
    const first = downloads[0];
    if (!first) throw new Error('no download captured');
    const s = latin1(first.bytes);
    expect(s).not.toContain('Hopding');    // the pdf-lib URL giveaway
    expect(s).not.toContain('/Producer');
    expect(s).not.toContain('/Creator');
  });

  it('downloadPDF output is still a valid, openable PDF', async () => {
    const { svc, downloads } = buildProbe(await sourceBytes());
    await svc.downloadPDF();
    const first = downloads[0];
    if (!first) throw new Error('no download captured');
    const re = await PDFDocument.load(first.bytes, { updateMetadata: false });
    expect(re.getPageCount()).toBe(1);
  });

  it('assemblePdfBytes (sign/compress/sanitize input) is left UNCHANGED — keeps the stamp', async () => {
    // Deliberate narrow scope: the sanitize feature relies on the stamp being present to strip.
    const { svc } = buildProbe(await sourceBytes());
    const s = latin1(await svc.assemblePdfBytes());
    expect(s).toContain('/Producer');
  });
});
