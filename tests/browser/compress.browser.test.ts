/**
 * PDF compress end-to-end (#60), real Chrome. The lossy path rasterizes each page
 * to a JPEG and rebuilds an image-only PDF — that needs a real canvas + pdf.js, so
 * it can't run in jsdom. Asserts: both paths download a valid PDF with the right
 * page count; lossless KEEPS the page's selectable text; lossy DROPS it (the page
 * becomes a single image XObject). The pure lossless helper (object streams +
 * metadata strip) is covered in jsdom by tests/export/compress.test.ts.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { CompressOptions } from '../../src/export/compress';

// Real pdf.js worker (the lossy raster + the text-extraction assertion both use it).
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

/** A 2-page PDF carrying real, extractable text. */
async function makeTextPdfBytes(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`COMPRESSME page ${i + 1}`, { x: 50, y: 780, size: 28, font });
  }
  doc.setProducer('FixtureTool');
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
      pageCount: 2,
      pages: [
        { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 },
        { id: 'p2', sourcePdfId: 's1', sourcePageNum: 2, rotation: 0 },
      ],
      sourcePdfs: new Map([['s1', { bytes: srcBytes }]]),
      watermark: { enabled: false },
    },
    elements: [],
    formValues: {},
    currentFilename: 'doc.pdf',
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

async function textOnPage(bytes: Uint8Array, pageNum: number): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  try {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    return (content.items as Array<{ str?: string }>).map(i => i.str ?? '').join('');
  } finally {
    await doc.loadingTask?.destroy?.();
  }
}

describe('compressAndDownload (real Chrome, #60)', () => {
  it('lossless: downloads a valid PDF that KEEPS selectable text', async () => {
    const probe = buildProbe(await makeTextPdfBytes());
    await probe.svc.compressAndDownload({ mode: 'lossless' });

    expect(probe.errors).toEqual([]);
    expect(probe.downloaded).toHaveLength(1);
    expect(probe.downloaded[0].filename).toBe('doc-compressed.pdf');

    const out = new Uint8Array(await probe.downloaded[0].blob.arrayBuffer());
    expect(String.fromCharCode(out[0], out[1], out[2], out[3])).toBe('%PDF');
    expect(await textOnPage(out, 1)).toContain('COMPRESSME');
  });

  it('lossy: downloads an image-only PDF that DROPS selectable text', async () => {
    const probe = buildProbe(await makeTextPdfBytes());
    const opts: CompressOptions = { mode: 'lossy', dpi: 120, quality: 0.7 };
    await probe.svc.compressAndDownload(opts);

    expect(probe.errors).toEqual([]);
    expect(probe.downloaded).toHaveLength(1);

    const out = new Uint8Array(await probe.downloaded[0].blob.arrayBuffer());
    expect(String.fromCharCode(out[0], out[1], out[2], out[3])).toBe('%PDF');

    // Both pages survive, but the text is now baked into a raster — no text items.
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const re = await PDFDocument.load(out, { updateMetadata: false });
    expect(re.getPageCount()).toBe(2);
    expect((await textOnPage(out, 1)).replace(/\s/g, '')).toBe('');
    expect((await textOnPage(out, 2)).replace(/\s/g, '')).toBe('');
  });
});
