/**
 * WS4-A — handwriting under a redaction used to stay visible on every export path.
 *
 * The burn is drawn inside `buildPageOverlays`' element loop; the ink layer is stamped AFTER it
 * (`exportPipeline.ts`), so a stroke crossing a redaction was composited on top of the opaque box
 * and baked into the exported pixels. Same grade as the 2026-08-29 annotation leak — visibly
 * readable, not merely extractable.
 *
 * The fix clips the ink CANVAS rather than dropping whole strokes: ink is rasterised to its own
 * canvas before being stamped, so a `destination-out` fill of the redaction rects removes exactly
 * the covered pixels and leaves the rest of the same stroke untouched. That is a strictly better
 * outcome than the drop-whole floor, and it is why every case below has a control asserting the
 * uncovered part of the SAME stroke survives — a leak guard needs a case that fails when the fix
 * over-reaches, not only one that fails when it under-reaches.
 *
 * Why the assertions are pixel samples at points derived from the stroke's own coordinates: the
 * clip is only correct if the rects travel through the IDENTICAL transform the stroke points do.
 * Sampling "wherever the covered part of the stroke lands" is what discriminates a right mapping
 * from a wrong one — a clip computed in the wrong frame leaves that pixel inked, at some rotation.
 */
import { describe, it, expect } from 'vitest';
import { renderInkForExport } from '../../src/export/exportPipeline';
import { ExportService } from '../../src/export/exportService';
import { InkLayer } from '../../src/infra/inkLayer';
import { transformPoint, contentRectToDisplay } from '../../src/utils/geometry';
import { buildRedactedCtx, countColours, COVERED, CONTROL, CROP, W as PW, H as PH } from './_redactedAnnotationFixture';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

/**
 * NON-SQUARE, and the redaction is OFF-CENTRE on both axes. Both properties are load-bearing and
 * were found by sabotage, not by design: with a 200×200 page and a rect centred on it, mapping the
 * clip rects through the WRONG frame (bypassing `toCanvas`) left every case here GREEN — the
 * rotated and unrotated AABBs coincide under central symmetry, so the fixture could not see a
 * rotation error at all. Same family as CLAUDE.md's "a square fixture cannot detect a dimension
 * swap", one step further in: a CENTRED one cannot detect a rotation.
 */
const W = 200, H = 260, SCALE = 2;
/** A horizontal stroke across the page, in editor DISPLAY space. */
const STROKE = { type: 'ink' as const, width: 8, color: '#ff0000', points: [{ x: 20, y: 70 }, { x: 180, y: 70 }] };
/** Covers a LEFT-OF-CENTRE span of the stroke, so "erased inside" and "kept outside" share it. */
const RED = { x: 60, y: 50, width: 40, height: 40 };
const INSIDE = { x: 80, y: 70 };   // on the stroke, under the redaction
const OUTSIDE = { x: 150, y: 70 }; // on the stroke, clear of it

function inkOf(): InkLayer {
  const ink = new InkLayer();
  ink.addStroke('p1', { ...STROKE, points: [...STROKE.points] });
  return ink;
}

/**
 * The same display → ink-canvas mapping the stroke rendering uses. Duplicated here on purpose: the
 * assertions are about ALPHA, and this only says where to look.
 */
function toCanvas(px: number, py: number, rot: number): { x: number; y: number } {
  const p = transformPoint(px, py, W, H, rot);
  return { x: Math.round(p.x * SCALE), y: Math.round((H - p.y) * SCALE) };
}

async function pixelAt(dataUrl: string, x: number, y: number): Promise<[number, number, number, number]> {
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('img')); img.src = dataUrl; });
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

describe('WS4-A — ink under a redaction is clipped out of the baked layer', () => {
  for (const rot of [0, 90, 180, 270]) {
    it(`the covered part of the stroke is erased at rotation ${rot}`, async () => {
      const url = renderInkForExport(inkOf(), 'p1', W, H, rot, [RED]) as string;
      expect(url).toBeTruthy();
      const mid = toCanvas(INSIDE.x, INSIDE.y, rot);
      const [, , , alpha] = await pixelAt(url, mid.x, mid.y);
      // Positive evidence: the pixel where the covered part of the stroke lands carries NO ink.
      expect(alpha).toBe(0);
    }, 60_000);

    it(`the uncovered part of the SAME stroke survives at rotation ${rot} (over-reach control)`, async () => {
      const url = renderInkForExport(inkOf(), 'p1', W, H, rot, [RED]) as string;
      const outside = toCanvas(OUTSIDE.x, OUTSIDE.y, rot);
      const [r, , , alpha] = await pixelAt(url, outside.x, outside.y);
      // A clip that erases the whole stroke (or the whole canvas) satisfies the case above and
      // fails here. This is the half that makes the guard worth having.
      expect(alpha).toBeGreaterThan(0);
      expect(r).toBeGreaterThan(200);
    }, 60_000);
  }

  it('a page with no redaction bakes a byte-identical ink layer', () => {
    // The "no change to ink elsewhere" guarantee, as a string compare of the PNG data URL —
    // ~85% of pages take this path and must be unaffected.
    const before = renderInkForExport(inkOf(), 'p1', W, H, 0) as string;
    const after = renderInkForExport(inkOf(), 'p1', W, H, 0, []) as string;
    expect(after).toBe(before);
  });

  it('the redaction actually changes the output (the probe is not vacuous)', () => {
    const plain = renderInkForExport(inkOf(), 'p1', W, H, 0) as string;
    const clipped = renderInkForExport(inkOf(), 'p1', W, H, 0, [RED]) as string;
    expect(clipped).not.toBe(plain);
  });

  it('a ROTATED redaction clips the ink its upright box would miss (WS4-B)', async () => {
    // A tall thin bar: upright it is x 70..90 / y 20..120, which does NOT reach the sample point.
    // Rotated 90° about its centre (80,70) it becomes x 30..130 / y 60..80 and crosses the stroke
    // there. The A fix mapped the STORED rect, so without B's footprint the ink at (110,70) rides
    // over the burn — the leak B closes, on the one path B's own rect-building sites do not reach.
    const bar = { x: 70, y: 20, width: 20, height: 100, rotation: 90 };
    const url = renderInkForExport(inkOf(), 'p1', W, H, 0, [bar]) as string;
    const p = toCanvas(110, 70, 0);
    const [, , , alpha] = await pixelAt(url, p.x, p.y);
    expect(alpha).toBe(0);
  }, 60_000);

  it('a redaction nowhere near the ink leaves it byte-identical', () => {
    const plain = renderInkForExport(inkOf(), 'p1', W, H, 0) as string;
    const far = renderInkForExport(inkOf(), 'p1', W, H, 0, [{ x: 0, y: 0, width: 10, height: 10 }]) as string;
    expect(far).toBe(plain);
  });
});

/**
 * The WIRING, driven end-to-end — the half the helper cases above cannot see.
 *
 * Everything above still passes if `buildPageOverlays` never passes the redactions in, which is
 * exactly the shape that left the sign-rect prefill uncertified until 2026-09-02: a pure function
 * pinned, its only production caller not. `renderThumbnailWithOverlays` is one of the two paths
 * that draw the burn as a vector rect and then stamp ink over it, so it is where the leak lives.
 *
 * The assertions are comparative rather than absolute, which is what buys the over-reach control
 * for free: RED must vanish (covered annotation + covered ink), and GREEN must RISE above the
 * ink-free baseline (the clear stroke survived). Dropping every stroke satisfies the first and
 * fails the second.
 */
describe('WS4-A — end to end: ink under the burn does not reach the rasterised page', () => {
  // The CROP row is not decoration. Reasoning says it must pass — ink and redactions both stay in
  // source-box display space and `effBox` only moves the watermark and Bates stamp — but every
  // frame bug in this repo shipped inside a fixture that was missing one dimension, and "reasoning
  // says it passes" is the sentence the Gotchas exist to distrust.
  const CASES: Array<{ rotation: number; crop?: typeof CROP }> = [
    { rotation: 0 }, { rotation: 90 }, { rotation: 180 }, { rotation: 270 },
    { rotation: 90, crop: CROP },
  ];
  for (const { rotation, crop } of CASES) {
    it(`rotation ${rotation}${crop ? ' + crop' : ''}: covered ink is gone, clear ink survives`, async () => {
      const rot = ((rotation % 360) + 360) % 360;
      const cov = contentRectToDisplay({ x: COVERED.x, y: COVERED.y, width: COVERED.w, height: COVERED.h }, PW, PH, rot);
      const ctl = contentRectToDisplay({ x: CONTROL.x, y: CONTROL.y, width: CONTROL.w, height: CONTROL.h }, PW, PH, rot);
      const across = (d: { x: number; y: number; width: number; height: number }) =>
        [{ x: d.x + 4, y: d.y + d.height / 2 }, { x: d.x + d.width - 4, y: d.y + d.height / 2 }];

      const base = await countColours(
        (await new ExportService(await buildRedactedCtx({ rotation, crop })).renderThumbnailWithOverlays(0, 2)) as string,
      );
      const withInk = await countColours(
        (await new ExportService(await buildRedactedCtx({
          rotation, crop,
          strokes: [
            { type: 'ink', width: 10, color: '#ff0000', points: across(cov) },
            { type: 'ink', width: 10, color: '#00ff00', points: across(ctl) },
          ],
        })).renderThumbnailWithOverlays(0, 2)) as string,
      );

      // Pre-fix the red stroke is composited on top of the opaque burn and rasterised with it.
      expect(withInk.red).toBe(0);
      // And the fix must not have simply thrown the ink away.
      expect(withInk.green).toBeGreaterThan(base.green);
    }, 60_000);
  }
});
