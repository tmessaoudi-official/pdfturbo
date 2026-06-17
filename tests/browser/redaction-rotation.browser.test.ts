/**
 * G2 confirming test (real Chrome) — does the redaction burn honour the ELEMENT'S
 * OWN rotation (`el.rotation`), as opposed to the PAGE rotation?
 *
 * The page-rotation case is already proven correct by blockers-redaction.browser.test.ts.
 * THIS file isolates the element-rotation case on a 0° page (so the two rotations never
 * interact): editor space maps to the offscreen-canvas pixel space by a plain ×SCALE,
 * with no Y-flip in the burn (see exportPipeline `rasterizePageWithRedactions` — the
 * fillRect uses `el.x*SCALE`/`el.y*SCALE` directly).
 *
 * Bug (verified by source read): the burn drew an axis-aligned rect from `el.x/el.y` and
 * ignored `el.rotation`. When a redaction box is rotated, the burned AABB covers area it
 * shouldn't AND leaves slivers of the intended-redacted content un-burned at the rotated
 * corners — a narrow content leak.
 *
 * Method: paint a GREEN band over the redaction's un-rotated AABB region, place a BLACK
 * redaction rotated 30° over it, run the real rasterizer, render with pdf.js, and sample:
 *   (a) BURNED point — inside the rotated quad (20px margin) → must be BLACK.
 *   (b) CONTROL point — inside the un-rotated AABB but ~19px OUTSIDE the rotated quad →
 *       must stay GREEN. This is the bug-prover: the old AABB fill burns it black (RED);
 *       the rotated fill misses it (GREEN). The +30° sign is pinned — at −30° the control
 *       would be covered and the burned point would leak (numerically verified).
 * An UNROTATED control case (rotation 0) confirms the axis-aligned path still fully burns.
 *
 * jsdom cannot run getViewport/render — hence a real-browser pixel test.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { rasterizePageWithRedactions } from '../../src/export/exportPipeline';
import { RedactionElement } from '../../src/elements/redactionElement';
import { InkLayer } from '../../src/infra/inkLayer';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W_ORIG = 200;
const H_ORIG = 400;
const SCALE = 2; // must match exportPipeline's rasterize scale

// Redaction box in EDITOR space (top-left origin) — the space el.x/el.y are stored in.
// Wide-short so a 30° rotation moves the corners far from the AABB.
const RB = { x: 40, y: 160, w: 120, h: 40 };
// GREEN band painted in pdf-lib content space (bottom-left origin) over the redaction's
// AABB region — Y-flipped from editor space: contentY = H_ORIG - editorY - height.
const BAND = { x: RB.x - 10, y: H_ORIG - RB.y - RB.h - 10, w: RB.w + 20, h: RB.h + 20 };

// Numerically pre-computed test points (see the node geometry in the implementing session).
// BURNED: along the rotated major axis, 20px margin inside the rotated quad at +30°.
const BURNED_PT = { x: 134.6, y: 200 };
// CONTROL: just inside the un-rotated AABB's top-right corner, ~19px OUTSIDE the +30° quad.
const CONTROL_PT = { x: 154, y: 166 };

const noopReporter: IErrorReporter = {
  info() {}, warn() {}, error() {}, silent() {},
} as unknown as IErrorReporter;

const noWatermark: WatermarkSettings = {
  enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10,
};

async function buildBandPdf(): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W_ORIG, H_ORIG]);
  page.drawRectangle({ x: 0, y: 0, width: W_ORIG, height: H_ORIG, color: rgb(1, 1, 1) });
  // Pure green band — distinct from the black redaction fill, so "not burned" is unambiguous.
  page.drawRectangle({ x: BAND.x, y: BAND.y, width: BAND.w, height: BAND.h, color: rgb(0, 1, 0) });
  return doc;
}

/** Sample one editor-space point in the rendered output as [r,g,b] (averaged over a 3×3 box). */
async function samplePoint(
  targetDoc: import('@cantoo/pdf-lib').PDFDocument,
  editorX: number,
  editorY: number,
): Promise<{ r: number; g: number; b: number }> {
  const bytes = await targetDoc.save({ useObjectStreams: false });
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const p = await pdf.getPage(1);
  const vp = p.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  await p.render({ canvas, viewport: vp }).promise;
  const px = Math.round(editorX * SCALE);
  const py = Math.round(editorY * SCALE);
  const img = ctx.getImageData(px - 1, py - 1, 3, 3).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < img.length; i += 4) { r += img[i]; g += img[i + 1]; b += img[i + 2]; }
  const n = img.length / 4;
  return { r: r / n, g: g / n, b: b / n };
}

const docPage: DocumentPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 };

async function rasterizeWith(redaction: PDFElement): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const src = await buildBandPdf();
  const target = await PDFDocument.create();
  await rasterizePageWithRedactions(
    src, docPage, [redaction], target,
    { rgb, StandardFonts, degrees },
    noWatermark, new InkLayer(), noopReporter,
  );
  return target;
}

describe('G2 — redaction burn honours the element\'s own rotation', () => {
  it('rotated 30°: covers the rotated rect (BURNED) and does NOT over-burn the AABB corner (CONTROL)', async () => {
    const redaction = new RedactionElement(RB.x, RB.y, RB.w, RB.h, docPage.id, '#000000') as unknown as PDFElement;
    redaction.rotation = 30;
    const target = await rasterizeWith(redaction);

    // (a) A point inside the ROTATED rect must be burned black.
    const burned = await samplePoint(target, BURNED_PT.x, BURNED_PT.y);
    expect(burned.r).toBeLessThan(40);
    expect(burned.g).toBeLessThan(40);
    expect(burned.b).toBeLessThan(40);

    // (b) A point inside the un-rotated AABB but OUTSIDE the rotated rect must stay GREEN.
    //     RED before the fix (AABB fill burns it black); GREEN after (rotated fill misses).
    const control = await samplePoint(target, CONTROL_PT.x, CONTROL_PT.y);
    expect(control.g).toBeGreaterThan(180); // green channel high → not burned
    expect(control.r).toBeLessThan(120);    // not pure-black-burned
  });

  it('rotation 0 (axis-aligned control): the AABB corner IS still fully burned', async () => {
    const redaction = new RedactionElement(RB.x, RB.y, RB.w, RB.h, docPage.id, '#000000') as unknown as PDFElement;
    redaction.rotation = 0;
    const target = await rasterizeWith(redaction);
    // With no rotation the same CONTROL point lies inside the burn → black.
    const control = await samplePoint(target, CONTROL_PT.x, CONTROL_PT.y);
    expect(control.r).toBeLessThan(40);
    expect(control.g).toBeLessThan(40);
    expect(control.b).toBeLessThan(40);
  });
});
