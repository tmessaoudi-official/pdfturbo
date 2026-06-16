/**
 * Sanitize-and-download end-to-end (real Chrome): a real pdf-lib assemble
 * (ExportService.assemblePdfBytes) → sanitizePdf (dynamically imported) → Blob
 * download. jsdom covers sanitizePdf's catalog-level stripping against a crafted
 * dirty PDF (pdfSanitizer.test.ts); this asserts the WIRED export path works in
 * the bundled browser — the lazy chunk loads, the download fires with the right
 * name, the bytes are a valid PDF, and pdf-lib's own /Info Producer stamp on the
 * assembled document is gone (proving the scrub actually ran on real output).
 */
import { describe, it, expect } from 'vitest';
import { ExportService, type IExportContext } from '../../src/export/exportService';

/** A source PDF carrying identifying metadata + an OpenAction (JS) on the catalog. */
async function makeDirtySourceBytes(): Promise<Uint8Array> {
  const { PDFDocument, PDFName } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([420, 595]);
  doc.setTitle('Confidential Source');
  doc.setAuthor('Jane Doe');
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.register(doc.context.obj({ S: 'JavaScript', JS: 'app.alert(1)' })));
  return doc.save({ useObjectStreams: false });
}

interface Probe {
  svc: ExportService;
  infos: string[];
  errors: string[];
  downloaded: { blob: Blob; filename: string }[];
}

function buildProbe(srcBytes: Uint8Array): Probe {
  const infos: string[] = [];
  const errors: string[] = [];
  const downloaded: { blob: Blob; filename: string }[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: 1,
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { bytes: srcBytes }]]),
      watermark: { enabled: false },
    },
    elements: [],
    formValues: {},
    currentFilename: 'secret.pdf',
    exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: {
      info: (k: string) => infos.push(k),
      warn: () => {},
      error: (k: string, e?: unknown) => errors.push(`${k}: ${e instanceof Error ? e.message : String(e)}`),
    },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob = (blob, filename) =>
    downloaded.push({ blob, filename });
  return { svc, infos, errors, downloaded };
}

describe('sanitizeAndDownload (real Chrome)', () => {
  it('assembles, sanitizes, and downloads a clean PDF', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const probe = buildProbe(await makeDirtySourceBytes());

    await probe.svc.sanitizeAndDownload();

    expect(probe.errors).toEqual([]);
    expect(probe.infos).toContain('toast.sanitized');
    expect(probe.downloaded).toHaveLength(1);
    expect(probe.downloaded[0].filename).toBe('secret-sanitized.pdf');

    const buf = new Uint8Array(await probe.downloaded[0].blob.arrayBuffer());
    expect(String.fromCharCode(buf[0], buf[1], buf[2], buf[3])).toBe('%PDF');

    // The scrub ran on the assembled output: pdf-lib's Producer stamp is gone.
    const re = await PDFDocument.load(buf, { updateMetadata: false });
    expect(re.getProducer()).toBeUndefined();
    expect(re.getTitle()).toBeUndefined();
    expect(re.getPageCount()).toBe(1);
  });
});
