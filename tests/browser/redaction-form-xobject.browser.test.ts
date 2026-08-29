/**
 * REDACTION LEAK — an image inside a Form XObject escaped the redaction filter.
 *
 * `walkPageOps` tracked `q`/`Q`/`cm` but had no case for `paintFormXObjectBegin` /
 * `paintFormXObjectEnd`. pdf.js's canvas backend saves the graphics state and applies the
 * form's matrix on Begin, and restores on End (see `CanvasGraphics.paintFormXObjectBegin`).
 * Without that, two things went wrong:
 *
 *   1. an image painted INSIDE a form reported the form-LOCAL ctm, so its footprint was
 *      computed at the wrong place on the page and `imagePlacementRedacted` missed it —
 *      a redacted picture exported into DOCX/MD/TXT intact;
 *   2. a `cm` inside a form LEAKED OUT past the form's end, corrupting the ctm for every
 *      later page-level op (images, rules, text origins).
 *
 * A form-wrapped image is not exotic: it is what a stamp, a placed page and most
 * tool-assembled documents produce.
 *
 * This drives REAL pdf.js — the earlier throwaway probe used a hand-built OPS table, which
 * cannot prove the operator codes or argument shapes this fix depends on.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { walkPageOps } from '../../src/export/opStreamWalker';
import { imagePlacementRedacted } from '../../src/export/exportService';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE_W = 400;
const PAGE_H = 800;
// The form is placed here; the image occupies the form-local rect (0,0)-(100,50).
const FORM_AT = { x: 150, y: 500 };
const IMG_W = 100, IMG_H = 50;

/** A tiny opaque PNG, built in-browser so no binary fixture is needed. */
async function pngBytes(): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = 10; c.height = 10;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 10, 10);
  const blob = await new Promise<Blob>((res, rej) => {
    c.toBlob(b => { if (b) res(b); else rej(new Error('toBlob failed')); }, 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * A page whose ONLY image is drawn inside a Form XObject placed by the form's OWN `/Matrix`:
 *   page:  /Fm0 Do
 *   form:  /Matrix [1 0 0 1 150 500], content `100 0 0 50 0 0 cm /Im0 Do`
 * True on-page footprint of the image: (150,500)-(250,550).
 *
 * The `/Matrix` is the load-bearing part and MUST NOT be replaced by a page-level `cm`.
 * Real pdf.js delivers it as `paintFormXObjectBegin`'s first argument, not as a `transform`
 * op — verified by dumping the operator list:
 *
 *   paintFormXObjectBegin[[1,0,0,1,150,500],[0,0,200,200]]
 *   transform[...]                 ← only the form's INTERNAL cm arrives this way
 *   paintImageXObject[...]
 *   paintFormXObjectEnd[]
 *
 * A first version of this fixture placed the form with `q 1 0 0 1 150 500 cm /Fm0 Do Q` and
 * gave it no `/Matrix`. It PASSED against the unfixed walker — the placement rode an ordinary
 * `transform` the walker already handled, so the test proved nothing about Begin.
 */
async function buildFormWrappedImagePdf(): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFNumber } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const img = await doc.embedPng(await pngBytes());
  const ctx = doc.context;

  const form = ctx.stream(`${IMG_W} 0 0 ${IMG_H} 0 0 cm /Im0 Do`, {
    Type: PDFName.of('XObject'),
    Subtype: PDFName.of('Form'),
    FormType: PDFNumber.of(1),
    Matrix: ctx.obj([1, 0, 0, 1, FORM_AT.x, FORM_AT.y]),
    BBox: ctx.obj([0, 0, 200, 200]),
    Resources: ctx.obj({ XObject: ctx.obj({ Im0: img.ref }) }),
  });
  const formRef = ctx.register(form);

  const content = ctx.stream('/Fm0 Do');
  page.node.set(PDFName.of('Contents'), ctx.register(content));
  page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: ctx.obj({ Fm0: formRef }) }));
  return doc.save({ useObjectStreams: false });
}

/**
 * A page that draws a form containing ONLY a `cm`, then paints an image at page level.
 * The form's `cm` must not survive its own end, so the image's ctm is the page-level one.
 */
async function buildLeakingCmPdf(): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFNumber } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const img = await doc.embedPng(await pngBytes());
  const ctx = doc.context;

  const form = ctx.stream('1 0 0 1 300 300 cm', {
    Type: PDFName.of('XObject'),
    Subtype: PDFName.of('Form'),
    FormType: PDFNumber.of(1),
    BBox: ctx.obj([0, 0, 400, 400]),
    Resources: ctx.obj({}),
  });
  const formRef = ctx.register(form);

  const content = ctx.stream(`/Fm0 Do  q ${IMG_W} 0 0 ${IMG_H} 20 20 cm /Im0 Do Q`);
  page.node.set(PDFName.of('Contents'), ctx.register(content));
  page.node.set(PDFName.of('Resources'), ctx.obj({
    XObject: ctx.obj({ Fm0: formRef, Im0: img.ref }),
  }));
  return doc.save({ useObjectStreams: false });
}

async function opsFor(bytes: Uint8Array) {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await pdf.getPage(1);
  const opList = await page.getOperatorList();
  return walkPageOps(opList, pdfjsLib.OPS as unknown as Record<string, number>);
}

describe('walkPageOps — Form XObject matrices (real pdf.js)', () => {
  it('composes the form matrix into an image placement inside it', async () => {
    const res = await opsFor(await buildFormWrappedImagePdf());
    expect(res.images).toHaveLength(1);
    const ctm = Array.from(res.images[0].ctm);
    // Pre-fix this is [100,0,0,50,0,0] — the form-LOCAL matrix, off by the form's placement.
    expect(ctm).toEqual([IMG_W, 0, 0, IMG_H, FORM_AT.x, FORM_AT.y]);
  }, 60_000);

  it('LEAK: a redaction over the form-wrapped image is detected', async () => {
    const res = await opsFor(await buildFormWrappedImagePdf());
    // Redaction over the image's TRUE footprint (150,500)-(250,550), expressed the way
    // redactionRectToPageSpace yields: x absolute, y measured DOWN from the crop top.
    const red = [{ x: FORM_AT.x, y: PAGE_H - (FORM_AT.y + IMG_H), width: IMG_W, height: IMG_H }];
    // Pre-fix: false — the picture exports into DOCX/MD/TXT despite the redaction.
    expect(imagePlacementRedacted(res.images[0].ctm, red, PAGE_H)).toBe(true);
  }, 60_000);

  it('CONTROL: a redaction elsewhere on the page does NOT drop the image', async () => {
    const res = await opsFor(await buildFormWrappedImagePdf());
    const red = [{ x: 10, y: 10, width: 40, height: 40 }];
    expect(imagePlacementRedacted(res.images[0].ctm, red, PAGE_H)).toBe(false);
  }, 60_000);

  it("the form's OWN /Matrix does not leak past the form end either", async () => {
    // `/Fm0 Do` (matrix [1 0 0 1 150 500]) then a page-level image at (20,20). Composing the
    // form matrix without popping it would place the second image at (170,520).
    const { PDFDocument, PDFName, PDFNumber } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const img = await doc.embedPng(await pngBytes());
    const ctx = doc.context;
    const form = ctx.stream(`${IMG_W} 0 0 ${IMG_H} 0 0 cm /Im0 Do`, {
      Type: PDFName.of('XObject'), Subtype: PDFName.of('Form'), FormType: PDFNumber.of(1),
      Matrix: ctx.obj([1, 0, 0, 1, FORM_AT.x, FORM_AT.y]),
      BBox: ctx.obj([0, 0, 200, 200]),
      Resources: ctx.obj({ XObject: ctx.obj({ Im0: img.ref }) }),
    });
    const content = ctx.stream(`/Fm0 Do  q ${IMG_W} 0 0 ${IMG_H} 20 20 cm /Im0 Do Q`);
    page.node.set(PDFName.of('Contents'), ctx.register(content));
    page.node.set(PDFName.of('Resources'), ctx.obj({
      XObject: ctx.obj({ Fm0: ctx.register(form), Im0: img.ref }),
    }));
    const res = await opsFor(await doc.save({ useObjectStreams: false }));
    expect(res.images).toHaveLength(2);
    expect(Array.from(res.images[1].ctm)).toEqual([IMG_W, 0, 0, IMG_H, 20, 20]);
  }, 60_000);

  it('restores the ctm at the form end, so an inner cm cannot leak out', async () => {
    const res = await opsFor(await buildLeakingCmPdf());
    expect(res.images).toHaveLength(1);
    // Pre-fix the form's `1 0 0 1 300 300 cm` survived, giving [100,0,0,50,320,320].
    expect(Array.from(res.images[0].ctm)).toEqual([IMG_W, 0, 0, IMG_H, 20, 20]);
  }, 60_000);
});
