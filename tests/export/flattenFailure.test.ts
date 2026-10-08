/**
 * TEST-3 (review 2026-10-07). The fill-and-flatten step in `_assemblePdfDoc` sat in a bare `catch` labelled
 * "no form fields in this source". pdf-lib's `getForm()` never throws for a source without a form — it creates
 * one — so the catch only ever caught a REAL failure, and swallowed it: "Flatten & download" shipped a copy whose
 * fields were still live, and a plain download shipped typed values never baked into the page. Two shapes reproduce
 * it, measured with a probe first: a widget with no /Rect and no appearance (`flatten()` throws in
 * `updateFieldAppearances`, before any field is flattened) and an /AcroForm that is not a dictionary (`getForm()` throws). A failed fill or flatten
 * now fails the export through the caller's error path; nothing is written.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray } from '@cantoo/pdf-lib';
import { ExportService, type IExportContext } from '../../src/export/exportService';

type Shape = 'healthy' | 'noRect' | 'acroFormArray' | 'noForm';

/** One page with two text fields — or, for 'noForm', a page with no form at all. */
async function sourceBytes(shape: Shape): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  if (shape === 'noForm') {
    page.drawText('no form here', { x: 40, y: 300, size: 12 });
    return doc.save({ useObjectStreams: false });
  }
  const form = doc.getForm();
  form.createTextField('a').addToPage(page, { x: 40, y: 320, width: 200, height: 24 });
  form.createTextField('b').addToPage(page, { x: 40, y: 260, width: 200, height: 24 });
  // Saved once with appearances, then broken and saved WITHOUT refreshing them — pdf-lib's own save would throw.
  const broken = await PDFDocument.load(await doc.save());
  if (shape === 'noRect') {
    // No /Rect AND no /AP: the field needs a new appearance, and drawing one reads the /Rect. With an /AP left in
    // place pdf-lib's flatten does not throw at all — it logs the widget and drops the field (measured).
    const widget = broken.getForm().getTextField('a').acroField.getWidgets()[0];
    widget.dict.delete(PDFName.of('Rect'));
    widget.dict.delete(PDFName.of('AP'));
  }
  if (shape === 'acroFormArray') broken.catalog.set(PDFName.of('AcroForm'), broken.context.obj([1]));
  return broken.save({ useObjectStreams: false, updateFieldAppearances: false });
}

interface Outcome { files: number; widgets: number[]; errors: string[] }

async function exportWith(shape: Shape, path: 'flatten' | 'typed'): Promise<Outcome> {
  const downloads: Blob[] = [];
  const errors: string[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: 1,
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { bytes: await sourceBytes(shape) }]]),
      watermark: { enabled: false },
    },
    elements: [],
    formValues: path === 'typed' ? { s1: { b: 'typed by the user' } } : {},
    currentFilename: 'form.pdf',
    exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info: () => {}, warn: () => {}, error: (key: string) => { errors.push(key); } },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob) => void })._downloadBlob = blob => { downloads.push(blob); };
  if (path === 'flatten') await svc.downloadFlattened();
  else await svc.downloadPDF();
  return { files: downloads.length, widgets: await Promise.all(downloads.map(widgetCount)), errors };
}

/** /Widget annotations left on the exported page. */
async function widgetCount(blob: Blob): Promise<number> {
  const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  const annots = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return (annots?.asArray() ?? []).filter(a => doc.context.lookup(a, PDFDict).get(PDFName.of('Subtype')) === PDFName.of('Widget')).length;
}

const REFUSED: Outcome = { files: 0, widgets: [], errors: ['toast.pdfExportFailed'] };
const FLATTENED: Outcome = { files: 1, widgets: [0], errors: [] };

describe('a form that cannot be flattened fails the export, never ships live fields (TEST-3)', () => {
  it.each([
    ['a widget with no /Rect and no appearance', 'noRect'],
    ['an /AcroForm that is not a dictionary', 'acroFormArray'],
  ] as const)('Flatten & download refuses %s', async (_label, shape) => {
    expect(await exportWith(shape, 'flatten')).toEqual(REFUSED);
  });

  it.each([
    ['a widget with no /Rect and no appearance', 'noRect'],
    ['an /AcroForm that is not a dictionary', 'acroFormArray'],
  ] as const)('a download carrying typed values refuses %s', async (_label, shape) => {
    expect(await exportWith(shape, 'typed')).toEqual(REFUSED);
  });

  it.each(['flatten', 'typed'] as const)('control: a healthy form flattens (%s)', async path => {
    expect(await exportWith('healthy', path)).toEqual(FLATTENED);
  });

  // The case the old catch claimed to protect: pdf-lib's getForm() creates an empty form, so a source with none
  // flattens without error. Pinned so a pdf-lib upgrade that starts throwing here says so.
  it('control: Flatten & download of a source with no form succeeds', async () => {
    expect(await exportWith('noForm', 'flatten')).toEqual(FLATTENED);
  });
});
