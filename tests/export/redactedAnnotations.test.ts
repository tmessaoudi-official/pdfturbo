/**
 * Source annotations under a redaction — the geometry, and the in-place `/Annots` strip.
 *
 * The end-to-end pixel proof lives in `tests/browser/redaction-annotation-burn.browser.test.ts`
 * (a real pdf.js render of the real rasterize path). These cases pin the parts that pixels
 * cannot isolate: the frame conventions (absolute y-up `/Rect` vs y-down-from-crop-top
 * redactions), the fail-CLOSED and normalisation rules, and the backwards-iteration contract
 * that a forward loop would silently break on two adjacent covered annotations.
 */
import { describe, it, expect } from 'vitest';
import { annotationRectRedacted, stripRedactedAnnotations } from '../../src/export/exportPipeline';
import { RedactionElement } from '../../src/elements/redactionElement';
import type { PDFElement } from '../../src/elements/annotationElement';

// A 400-high page: y-up absolute → y-down from crop top uses pageTopY = 400.
const TOP = 400;
const red = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('annotationRectRedacted', () => {
  it('no redactions → never redacted', () => {
    expect(annotationRectRedacted([0, 0, 100, 100], [], TOP)).toBe(false);
  });

  it('an overlapping /Rect is redacted', () => {
    // /Rect y-up 280..340 → y-down 60..120. Redaction y-down 50..130 overlaps.
    expect(annotationRectRedacted([40, 280, 140, 340], [red(30, 50, 120, 80)], TOP)).toBe(true);
  });

  it('a /Rect clear of every redaction is kept', () => {
    // /Rect y-up 90..150 → y-down 250..310. Redaction y-down 50..130 does not reach it.
    expect(annotationRectRedacted([40, 90, 140, 150], [red(30, 50, 120, 80)], TOP)).toBe(false);
  });

  it('separates on the X axis alone', () => {
    expect(annotationRectRedacted([300, 280, 380, 340], [red(30, 50, 120, 80)], TOP)).toBe(false);
  });

  it('NORMALISES a /Rect whose corners are stored reversed', () => {
    // Same box as the overlapping case, corners given upper-right-first. Without the
    // min/max normalisation the raw comparison FAILS OPEN and the annotation survives.
    expect(annotationRectRedacted([140, 340, 40, 280], [red(30, 50, 120, 80)], TOP)).toBe(true);
  });

  it('fails CLOSED on an unreadable /Rect', () => {
    // The page carries a redaction, so an annotation we cannot place is one we cannot
    // prove is safe — it goes.
    expect(annotationRectRedacted([NaN, 280, 140, 340], [red(30, 50, 120, 80)], TOP)).toBe(true);
    expect(annotationRectRedacted([], [red(30, 50, 120, 80)], TOP)).toBe(true);
  });

  it('touching edges do not count as overlap (strict inequality)', () => {
    // /Rect y-down 60..120; a redaction ending exactly at y-down 60 only touches.
    expect(annotationRectRedacted([40, 280, 140, 340], [red(30, 0, 120, 60)], TOP)).toBe(false);
  });
});

describe('stripRedactedAnnotations', () => {
  const W = 200, H = 400;

  /** Build a one-page doc with `rects` as FreeText annotations, in /Rect (y-up) order. */
  async function build(rects: number[][]) {
    const { PDFDocument, PDFName, PDFArray, PDFNumber, PDFString } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([W, H]);
    const ctx = doc.context;
    const arr = PDFArray.withContext(ctx);
    for (const r of rects) {
      arr.push(ctx.register(ctx.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('FreeText'),
        Rect: ctx.obj(r),
        F: PDFNumber.of(4),
        Contents: PDFString.of(`annot-${r.join(',')}`),
      })));
    }
    page.node.set(PDFName.of('Annots'), arr);
    return { doc, page, PDFName, PDFArray };
  }

  const annotCount = async (
    page: import('@cantoo/pdf-lib').PDFPage,
    PDFName: typeof import('@cantoo/pdf-lib').PDFName,
    PDFArray: typeof import('@cantoo/pdf-lib').PDFArray,
  ) => page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0;

  const cropBox = { x: 0, y: 0, width: W, height: H };
  const redactionEl = (x: number, y: number, w: number, h: number) =>
    new RedactionElement(x, y, w, h, 'p1', '#000000') as unknown as PDFElement;

  it('removes a covered annotation and keeps an uncovered one', async () => {
    // covered: y-up 280..340 (y-down 60..120); clear: y-up 90..150 (y-down 250..310)
    const { page, PDFName, PDFArray } = await build([[40, 280, 140, 340], [40, 90, 140, 150]]);
    await stripRedactedAnnotations(page, [redactionEl(30, 50, 120, 80)], 'p1', cropBox, 0);
    expect(await annotCount(page, PDFName, PDFArray)).toBe(1);
  });

  it('removes BOTH of two adjacent covered annotations', async () => {
    // The backwards-iteration contract: PDFArray.remove shifts later indices down, so a
    // forward loop skips the entry after each removal and leaves the second one live.
    const { page, PDFName, PDFArray } = await build([[40, 280, 140, 340], [40, 290, 140, 350]]);
    await stripRedactedAnnotations(page, [redactionEl(30, 40, 120, 100)], 'p1', cropBox, 0);
    expect(await annotCount(page, PDFName, PDFArray)).toBe(0);
  });

  it('is a no-op when the page carries no redaction', async () => {
    const { page, PDFName, PDFArray } = await build([[40, 280, 140, 340]]);
    await stripRedactedAnnotations(page, [], 'p1', cropBox, 0);
    expect(await annotCount(page, PDFName, PDFArray)).toBe(1);
  });

  it('ignores redactions belonging to a DIFFERENT page', async () => {
    const { page, PDFName, PDFArray } = await build([[40, 280, 140, 340]]);
    const other = new RedactionElement(30, 50, 120, 80, 'OTHER-PAGE', '#000000') as unknown as PDFElement;
    await stripRedactedAnnotations(page, [other], 'p1', cropBox, 0);
    expect(await annotCount(page, PDFName, PDFArray)).toBe(1);
  });

  it('honours a non-zero CropBox ORIGIN', async () => {
    // The redaction rect is relative to the RENDERED (crop) box while /Rect is absolute, so
    // ignoring the origin compares two frames and the strip silently no-ops — the same defect
    // the CropBox-origin fix closed for the text channels.
    //
    // The FIXTURE is the load-bearing part. A first version used crop [50 50 250 450] with
    // generous boxes and was VACUOUS: sabotaging the origin term away left it green, because a
    // 50pt shift in both axes still overlapped. Per this repo's own rule the origin is
    // ASYMMETRIC (50, 120) on both axes, the crop is NON-SQUARE (200×300), and the redaction is
    // sized to sit snugly on the annotation — so dropping the origin moves it clear and the
    // case reds. Re-verify by sabotage, not by reading.
    const { PDFDocument, PDFName, PDFArray, PDFNumber, PDFString } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 500]);
    const ctx = doc.context;
    const arr = PDFArray.withContext(ctx);
    // Absolute /Rect x 100..160, y-up 300..340 → y-down from crop top (420): 80..120.
    arr.push(ctx.register(ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('FreeText'),
      Rect: ctx.obj([100, 300, 160, 340]),
      F: PDFNumber.of(4), Contents: PDFString.of('covered'),
    })));
    page.node.set(PDFName.of('Annots'), arr);

    const crop = { x: 50, y: 120, width: 200, height: 300 };
    // Display rect, crop-relative: x 45..115 → absolute 95..165; y-down 75..125.
    await stripRedactedAnnotations(page, [redactionEl(45, 75, 70, 50)], 'p1', crop, 0);
    expect(page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0).toBe(0);
  });

  it('fails CLOSED on a /Rect of the wrong TYPE, which throws rather than yielding NaN', async () => {
    // pdf-lib's lookupMaybe returns undefined only for an ABSENT or null object; on a present-
    // but-wrong-type object it THROWS. Without a catch this escaped the NaN path entirely and
    // propagated — and on the thumbnail path a throw degrades to a plain un-redacted raster.
    const { PDFDocument, PDFName, PDFArray, PDFNumber, PDFString } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([W, H]);
    const ctx = doc.context;
    const arr = PDFArray.withContext(ctx);
    arr.push(ctx.register(ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('FreeText'),
      Rect: PDFString.of('not-an-array'), F: PDFNumber.of(4),
    })));
    page.node.set(PDFName.of('Annots'), arr);
    await stripRedactedAnnotations(page, [redactionEl(30, 50, 120, 80)], 'p1', cropBox, 0);
    expect(page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0).toBe(0);
  });

  it('fails CLOSED on a /Rect containing a non-numeric entry', async () => {
    const { PDFDocument, PDFName, PDFArray, PDFNumber, PDFString } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([W, H]);
    const ctx = doc.context;
    const arr = PDFArray.withContext(ctx);
    arr.push(ctx.register(ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('FreeText'),
      Rect: ctx.obj([0, 0, 100, PDFString.of('x')]), F: PDFNumber.of(4),
    })));
    page.node.set(PDFName.of('Annots'), arr);
    await stripRedactedAnnotations(page, [redactionEl(30, 50, 120, 80)], 'p1', cropBox, 0);
    expect(page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0).toBe(0);
  });

  it('drops a non-array /Annots wholesale rather than leaving it unexamined', async () => {
    const { PDFDocument, PDFName, PDFArray, PDFString } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([W, H]);
    page.node.set(PDFName.of('Annots'), PDFString.of('malformed'));
    await stripRedactedAnnotations(page, [redactionEl(30, 50, 120, 80)], 'p1', cropBox, 0);
    expect(page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)).toBeUndefined();
  });

  it('leaves a page with no /Annots untouched', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([W, H]);
    await expect(
      stripRedactedAnnotations(page, [redactionEl(30, 50, 120, 80)], 'p1', cropBox, 0),
    ).resolves.toBeUndefined();
  });
});
