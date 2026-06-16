/**
 * Form flattening on export (#62). copyPages drops the document /AcroForm, so
 * `getForm().getFields()` is empty in BOTH paths — but the default export still
 * leaves the field's interactive WIDGET annotation on the page (residue a
 * viewer may render/interact with). `downloadFlattened()` runs `form.flatten()`
 * on every source first, baking each widget's appearance into the page content
 * stream and removing the annotation, so the exported copy is fully static.
 *
 * This authors a source PDF carrying ONE unfilled text field in-test (pdf-lib),
 * then asserts: downloadPDF leaves the widget annotation (the gap) and
 * downloadFlattened removes it (the fix). Pure pdf-lib — jsdom suffices.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { ExportService, type IExportContext } from '../../src/export/exportService';

/** A source PDF with a single, UNFILLED AcroForm text field. */
async function formSourceBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  const form = doc.getForm();
  const field = form.createTextField('customer.name');
  field.addToPage(page, { x: 40, y: 320, width: 200, height: 24 });
  return doc.save({ useObjectStreams: false });
}

interface Probe {
  svc: ExportService;
  downloads: { blob: Blob; filename: string }[];
}

function buildProbe(src: Uint8Array): Probe {
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
    currentFilename: 'form.pdf',
    exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info: () => {}, warn: () => {}, error: () => {} },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob = (blob, filename) =>
    downloads.push({ blob, filename });
  return { svc, downloads };
}

/** Count /Widget annotations on the first assembled page of a saved PDF blob. */
async function widgetCount(blob: Blob): Promise<number> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPages()[0].node.Annots();
  if (!annots) return 0;
  let widgets = 0;
  for (let i = 0; i < annots.size(); i++) {
    const a = annots.lookup(i) as { get?: (k: PDFName) => { encodedName?: string } } | undefined;
    if (a?.get?.(PDFName.of('Subtype'))?.encodedName === '/Widget') widgets++;
  }
  return widgets;
}

describe('form flattening on export (#62)', () => {
  it('default downloadPDF leaves the source field widget annotation on the page (the gap)', async () => {
    const probe = buildProbe(await formSourceBytes());
    await probe.svc.downloadPDF();
    expect(probe.downloads).toHaveLength(1);
    expect(await widgetCount(probe.downloads[0].blob)).toBe(1);
  });

  it('downloadFlattened bakes the form into static content (0 widget annotations left)', async () => {
    const probe = buildProbe(await formSourceBytes());
    await probe.svc.downloadFlattened();
    expect(probe.downloads).toHaveLength(1);
    expect(probe.downloads[0].filename).toBe('form-flattened.pdf');
    expect(await widgetCount(probe.downloads[0].blob)).toBe(0);
  });
});
