/**
 * Batch-3 (a) — DOCX export color fidelity (real pdf.js getOperatorList).
 *
 * pdf.js v6 delivers `setFillRGBColor` with a single "#rrggbb" STRING arg (it
 * pre-resolves RGB/Gray/CMYK/Separation/spot via getRgbHex). The old op-walk
 * destructured `[fillR,fillG,fillB] = args`, so colored text collapsed to
 * garbage/black. jsdom can't run the worker, so this proves the fix end-to-end
 * in real Chrome: red-drawn text must reconstruct to a red-ish FlowRun.color.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { FlowDoc } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type FlowDocExtractor = { _extractFlowDoc(): Promise<FlowDoc> };

function makeExtractor(doc: pdfjsLib.PDFDocumentProxy): FlowDocExtractor {
  const pages = Array.from({ length: doc.numPages }, (_u, i) => ({
    sourcePdfId: 's1',
    sourcePageNum: i + 1,
  }));
  const ctx = {
    documentModel: { pages, sourcePdfs: new Map([['s1', { doc, bytes: new Uint8Array() }]]) },
    elements: [],
  } as unknown as IExportContext;
  return new ExportService(ctx) as unknown as FlowDocExtractor;
}

async function loadColoredTextPdf(): Promise<pdfjsLib.PDFDocumentProxy> {
  const { PDFDocument, rgb, StandardFonts } = await import('@cantoo/pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 200]);
  page.drawText('RED HEADING', { x: 40, y: 150, size: 28, font, color: rgb(0.85, 0.1, 0.12) });
  page.drawText('black body text', { x: 40, y: 100, size: 14, font, color: rgb(0, 0, 0) });
  return pdfjsLib.getDocument({ data: await pdf.save() }).promise;
}

function isReddish(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return r > 150 && g < 100 && b < 100;
}

describe('DOCX export — colored text survives (v6 hex-string color arg)', () => {
  it('reconstructs red text as a red-ish FlowRun.color (not black/garbage)', async () => {
    const svc = makeExtractor(await loadColoredTextPdf());
    const flow = await svc._extractFlowDoc();
    const colors = flow.pages
      .flatMap((p) => p.paragraphs)
      .flatMap((para) => para.runs)
      .map((r) => r.color)
      .filter((c): c is string => typeof c === 'string');
    // At least one run carries a valid 6-hex color and it is red-ish.
    expect(colors.every((c) => /^[0-9A-F]{6}$/.test(c))).toBe(true);
    expect(colors.some(isReddish)).toBe(true);
  });
});

/**
 * G10 — Separation/spot-color (`scn`) text must export CHROMATIC, not black.
 *
 * The concern: `opStreamWalker` only has branches for `setFillRGBColor`/`setFillGray`/
 * `setFillCMYKColor` and none for `setFillColorN` (the `scn` operator used by
 * Separation/DeviceN/spot colorspaces). If pdf.js v6 delivered raw `scn` to the
 * op-walk, the run would keep the stale black `fillHex` and export black.
 *
 * Reality (verified against the pdf.js v6 worker source, build 6.0.227): the
 * evaluator's `setFillColorN` case resolves the Separation tint transform via
 * `cs.getRgbHex(args)` and REWRITES the op to `setFillRGBColor("#rrggbb")` — the
 * fillColorSpace setter aliases `patternFillColorSpace`, so the Separation CS is in
 * scope at the `scn`. The op-walk therefore already receives the resolved hex; spot
 * text is correct. This test pins that contract end-to-end (no existing test covers
 * a real Separation colorspace through `_extractFlowDoc`: `docx-color` above uses an
 * RGB-drawn fill, and `truedit-spot-color` exercises the content-stream-surgery path,
 * not the DOCX op-walk). jsdom can't run the worker that does the tint resolution.
 *
 * `page.drawText` cannot emit `scn`, so the Separation fill is built at the object
 * level (mirrors the fixture in `truedit-spot-color.browser.test.ts`).
 */
async function loadSpotColorTextPdf(): Promise<pdfjsLib.PDFDocumentProxy> {
  const { PDFDocument, StandardFonts, PDFName } = await import('@cantoo/pdf-lib');
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 160]);

  // Separation /MySpot over DeviceRGB; tint 0 → white, tint 1 → orange (1, 0.5, 0).
  const tintFn = pdf.context.obj({
    FunctionType: 2,
    Domain: [0, 1],
    C0: [1, 1, 1],
    C1: [1, 0.5, 0],
    N: 1,
  });
  const sepCS = pdf.context.obj([
    PDFName.of('Separation'),
    PDFName.of('MySpot'),
    PDFName.of('DeviceRGB'),
    tintFn,
  ]);
  const sepRef = pdf.context.register(sepCS);

  const resources = pdf.context.obj({
    Font: { Helv: helv.ref },
    ColorSpace: { CS0: sepRef },
  });
  page.node.set(PDFName.of('Resources'), pdf.context.register(resources));

  // `/CS0 cs 1 scn` → full-tint spot fill; then a normal text-show.
  const content = '/CS0 cs 1 scn BT /Helv 28 Tf 40 100 Td (SPOT HEADING) Tj ET';
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(bytes)));

  return pdfjsLib.getDocument({ data: await pdf.save() }).promise;
}

function isOrangeish(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Orange = strong red, mid green, low blue; key property: red ≫ blue (chromatic).
  return r > 150 && r - b > 60 && g > b;
}

describe('DOCX export — Separation/spot-color text survives (scn → resolved RGB) (G10)', () => {
  it('reconstructs spot-colored text as a chromatic FlowRun.color, not black', async () => {
    const svc = makeExtractor(await loadSpotColorTextPdf());
    const flow = await svc._extractFlowDoc();
    const colors = flow.pages
      .flatMap((p) => p.paragraphs)
      .flatMap((para) => para.runs)
      .map((r) => r.color)
      .filter((c): c is string => typeof c === 'string');

    // The spot run carries a valid 6-hex color (not undefined → not defaulted black).
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.every((c) => /^[0-9A-F]{6}$/.test(c))).toBe(true);
    // It is the orange the tint transform resolves to — NOT black/achromatic.
    expect(colors.some(isOrangeish)).toBe(true);
    // Explicit anti-regression: no run collapsed to pure black.
    expect(colors.some((c) => c === '000000')).toBe(false);
  });
});
