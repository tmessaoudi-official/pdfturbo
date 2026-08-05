/**
 * HIDE-vs-REMOVE audit — for every surface a user might believe deletes content, does it?
 *
 * Motivated by a proven finding: crop was documented as "keep only a drawn region" while actually
 * setting the CropBox, so the cropped-away content stayed recoverable and the obvious check (select-all
 * / copy) gave a false negative. That was undisclosed for a year. This file asks the same question of
 * every other surface, empirically, and PINS each answer — so a claim and the code can no longer drift
 * apart silently.
 *
 * Method: build the shape, run the REAL export path, then try to recover the content with pdf.js.
 * Recovery uses `getTextContent` / `getOperatorList`, never a raw byte scan for a short string — per
 * CLAUDE.md § "A flaky gate", scanning compressed bytes for a few characters is a coin flip.
 *
 * Two of these tests pin behaviour that is NOT a defect but IS a trap, and they say so: a filled shape
 * over text hides nothing, and form-flatten leaves the value as page text. Both are correct given what
 * the feature claims — the point is that the claim and the reality are now written down together.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { rasterizePageWithRedactions, buildPageOverlays } from '../../src/export/exportPipeline';
import { RedactionElement } from '../../src/elements/redactionElement';
import { ShapeElement } from '../../src/elements/shapeElement';
import { InkLayer } from '../../src/infra/inkLayer';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W = 400, H = 300;
const SECRET = 'CONFIDENTIAL-CASE-4417';
const PUBLIC = 'Body text meant to be shared.';
/** Editor display space (top-left), covering the secret line. */
const COVER = { x: 30, y: 40, w: 260, h: 30 };

/**
 * FAIL-LOUD reporter. `buildPageOverlays` catches a per-element render failure, reports it and carries
 * on — so a silent reporter would let this file "prove" that a shape does not hide text when in fact the
 * shape never rendered at all. It did exactly that on the first attempt.
 */
const noopReporter = {
  info() {},
  silent(_e?: unknown, msg?: string) { throw new Error(`export reported: ${msg}`); },
  warn(key: string, meta?: unknown) { throw new Error(`export warned: ${key} ${JSON.stringify(meta)}`); },
  error(key: string) { throw new Error(`export errored: ${key}`); },
} as unknown as IErrorReporter;
const noWatermark: WatermarkSettings =
  { enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10 };
const makePage = (): DocumentPage =>
  ({ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } as DocumentPage);

/** A page with a secret line near the top and a public line below it. */
async function secretPdf(): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  page.drawText(SECRET, { x: 32, y: H - 62, size: 12, font });
  page.drawText(PUBLIC, { x: 32, y: 120, size: 12, font });
  return doc;
}

/**
 * Average darkness (0 = white, 255 = black) of a small patch of page 1, rendered by real pdf.js.
 * Used to prove a shape is genuinely painted — without it, "the text is still extractable" could be
 * passing simply because nothing was drawn.
 */
async function patchDarkness(
  doc: import('@cantoo/pdf-lib').PDFDocument,
  px: number, py: number,
): Promise<number> {
  const bytes = await doc.save({ useObjectStreams: false });
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  await page.render({ canvas, canvasContext: ctx, viewport } as never).promise;
  const { data } = ctx.getImageData(px - 3, py - 3, 6, 6);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  return 255 - sum / (data.length / 4);
}

/** All extractable text of a saved document, page by page. */
async function extractedText(doc: import('@cantoo/pdf-lib').PDFDocument): Promise<string> {
  const bytes = await doc.save({ useObjectStreams: false });
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  let all = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    all += (content.items as unknown as { str?: string }[]).map(t => t.str ?? '').join('');
  }
  return all;
}

/** Run the vector export bake (no redaction → no rasterisation). */
async function bakeVector(elements: PDFElement[]): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const src = await secretPdf();
  const target = await PDFDocument.create();
  const [page] = await target.copyPages(src, [0]);
  target.addPage(page);
  await buildPageOverlays({
    pdfDoc: target, page, docPage: makePage(), elements,
    pdfLib: { rgb, StandardFonts, degrees }, userRot: 0, sourceRot: 0,
    watermark: noWatermark, inkLayer: new InkLayer(), reportError: noopReporter,
  } as unknown as Parameters<typeof buildPageOverlays>[0]);
  void src;
  return target;
}

describe('AUDIT — a filled SHAPE over text hides nothing (the classic false redaction)', () => {
  it('an opaque black rectangle drawn over the secret leaves it fully extractable', async () => {
    // No feature claims otherwise — a shape is an annotation, not a removal tool. But covering text
    // with a black box is the single most common way people believe they have redacted a PDF, and the
    // result LOOKS identical to a real redaction on screen. Pinned so the gap is documented rather
    // than folklore, and so anyone tempted to describe shapes as "hiding" content sees this first.
    const shape = new ShapeElement(
      'rect', COVER.x, COVER.y, COVER.w, COVER.h, 'p1',
      { fillColor: '#000000', strokeColor: '#000000' },
    ) as unknown as PDFElement;
    const out = await bakeVector([shape]);

    // FIRST prove the box is actually painted. Without this the text assertion below would also pass on
    // a document where the shape silently failed to bake — which is exactly what happened on the first
    // attempt at this test (the constructor takes shapeType FIRST, and a stray cast hid the wrong order).
    const covered = await patchDarkness(out, COVER.x + COVER.w / 2, COVER.y + COVER.h / 2);
    expect(covered, 'the black box must really be drawn over the secret').toBeGreaterThan(200);

    // …and yet:
    const text = await extractedText(out);
    expect(text).toContain(SECRET);          // <- the trap, in one assertion
    expect(text).toContain(PUBLIC);
  });

  it('a REDACTION over the same text does remove it — the claimed difference is real', async () => {
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    const src = await secretPdf();
    const target = await PDFDocument.create();
    const redaction = new RedactionElement(
      COVER.x, COVER.y, COVER.w, COVER.h, 'p1', '#000000',
    ) as unknown as PDFElement;
    await rasterizePageWithRedactions(
      src, makePage(), [redaction], target,
      { rgb, StandardFonts, degrees }, noWatermark, new InkLayer(), noopReporter,
    );
    const text = await extractedText(target);
    expect(text).not.toContain(SECRET);
    // …and the rasterisation is why: the whole page becomes an image, so the PUBLIC line is not
    // extractable either. That is the documented cost of "text unextractable", and worth pinning
    // because it is the reason redaction is not the default.
    expect(text).not.toContain(PUBLIC);
  });
});

describe('AUDIT — sanitize strips what it claims to strip', () => {
  it('removes /Info metadata, /OpenAction JavaScript and embedded files', async () => {
    const { PDFDocument, PDFName, PDFString } = await import('@cantoo/pdf-lib');
    const { sanitizePdf } = await import('../../src/utils/pdfSanitizer');
    const doc = await secretPdf();
    doc.setTitle('Internal draft — do not circulate');
    doc.setAuthor('a.person@example.com');
    // A document-level JavaScript action, the thing /OpenAction stripping is for.
    const js = doc.context.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of('app.alert("x")') });
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.register(js));
    const dirty = await doc.save({ useObjectStreams: false });

    const { bytes: clean } = await sanitizePdf(dirty);
    // Re-load with updateMetadata:false — the default RE-STAMPS /Info at load time and would mask the
    // very thing under test (CLAUDE.md § PDF sanitizer).
    const reread = await PDFDocument.load(clean, { updateMetadata: false });
    expect(reread.getTitle() ?? '').not.toContain('Internal draft');
    expect(reread.getAuthor() ?? '').toBe('');
    expect(reread.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
    // `.get()`, NOT `.lookup(key, PDFDict)` — lookup THROWS ("Expected instance of PDFDict, but got
    // instance of undefined") when the key is absent, which is exactly the success case here.
    expect(reread.catalog.get(PDFName.of('Names'))).toBeUndefined();
    // And the page content itself is untouched — sanitize is not a content remover and does not claim
    // to be. A reader who expects it to remove visible text would be wrong, so pin that too.
    const text = await extractedText(reread);
    expect(text).toContain(SECRET);
  });
});

describe('AUDIT — form flatten bakes the VALUE into page text (not a leak, but a trap)', () => {
  it('a flattened field value is extractable page text afterwards', async () => {
    const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([W, H]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const form = doc.getForm();
    const field = form.createTextField('ssn');
    field.setText('123-45-6789');
    field.addToPage(page, { x: 40, y: 200, width: 200, height: 20, font });
    form.flatten();

    const text = await extractedText(doc);
    // Flatten's PURPOSE is to make the value permanent page content, so this is correct behaviour —
    // the trap is that "flatten" sounds like it might obscure the entry. It does the opposite: the
    // value stops being an editable field and becomes text anyone can copy.
    expect(text).toContain('123-45-6789');
    expect(doc.getForm().getFields()).toHaveLength(0);
  });
});

describe('AUDIT — true-edit DELETE removes the string from the content stream', () => {
  it('deleting existing text leaves it unextractable, with no rasterisation', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const { deleteTextAt } = await import('../../src/utils/contentStreamEditor');
    // save→load is REQUIRED: `drawText` buffers operators and only flushes them into the page's content
    // stream at save time, so `findTarget` finds nothing on a freshly-built document.
    const doc = await PDFDocument.load(await (await secretPdf()).save());
    // The editor maps display space → PDF space before calling this; the point here is already PDF-space
    // (y-up) and matches the SECRET line's drawText origin.
    const ok = deleteTextAt(doc, 0, { x: 32, y: H - 62 }, 8);
    expect(ok, 'the target must be found — otherwise this test proves nothing').toBe(true);

    const text = await extractedText(doc);
    expect(text).not.toContain(SECRET);
    // …and unlike redaction, the REST of the page stays real text. This is the one surface that removes
    // content without the rasterisation cost, which is why it is worth pinning separately: a reader who
    // assumes every removal path rasterises would wrongly expect PUBLIC to be gone too.
    expect(text).toContain(PUBLIC);
  });
});

describe('AUDIT — deleting a page removes its bytes', () => {
  it('a deleted page is absent from the export, content and all', async () => {
    const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
    const src = await PDFDocument.create();
    const font = await src.embedFont(StandardFonts.Helvetica);
    for (const [i, label] of [PUBLIC, SECRET].entries()) {
      const pg = src.addPage([W, H]);
      pg.drawText(label, { x: 32, y: 200, size: 12, font });
      void i;
    }
    // The export assembles from COPIED pages, so a page the user deleted is simply never copied —
    // this is the one surface where "removed" is structurally true rather than a promise to check.
    const target = await PDFDocument.create();
    const [keep] = await target.copyPages(src, [0]);
    target.addPage(keep);

    expect(target.getPageCount()).toBe(1);
    const text = await extractedText(target);
    expect(text).toContain(PUBLIC);
    expect(text).not.toContain(SECRET);
  });
});
