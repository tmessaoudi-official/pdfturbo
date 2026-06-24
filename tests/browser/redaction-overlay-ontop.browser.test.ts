/**
 * Redaction layering 2026-06-24 — "I should be able to put anything on top of a redaction."
 *
 * Before: rasterizePageWithRedactions baked non-text overlays UNDER the burn (the burn was a
 * post-raster canvas fillRect), so a shape/signature placed on top of a redaction in the editor
 * still exported buried beneath the black box. After: all elements draw in ARRAY (stacking) order
 * through the vector bake, then the page is rasterized — so an overlay placed AFTER a redaction
 * renders ABOVE the burn, while the redaction (opaque filled rect, now rotation-correct via
 * rectAnchor) still destroys the SOURCE beneath it.
 *
 * Method: green "secret" band → BLACK redaction exactly over it (array[0]) → RED filled rect on
 * top, overlapping (array[1] = later = on top). Rasterize, render, sample:
 *   - shape centre → RED  (overlay above the burn — the feature)
 *   - redaction area NOT under the shape → BLACK (source destroyed — the security invariant)
 * Run at 0° AND 90° to prove the reorder is rotation-safe (the rectAnchor fix).
 * jsdom can't run getViewport/render — hence a real-browser pixel test.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { rasterizePageWithRedactions } from '../../src/export/exportPipeline';
import { inverseTransformPoint } from '../../src/utils/geometry';
import { RedactionElement } from '../../src/elements/redactionElement';
import { ShapeElement } from '../../src/elements/shapeElement';
import { InkLayer } from '../../src/infra/inkLayer';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;
const W = 200, H = 400, SCALE = 2;
// secret in pdf-lib content space (bottom-left); redaction + shape placed at its DISPLAYED box.
const SECRET = { x: 40, y: 200, w: 120, h: 80 };
const noWM: WatermarkSettings = { enabled: false, text: '', opacity: 0, angle: 0, color: '#000', fontSize: 10 };
const rep = { info() {}, warn() {}, error() {}, silent() {} } as unknown as IErrorReporter;

function dispBox(rot: number, r: { x: number; y: number; w: number; h: number }) {
  const cs = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  for (const [cx, cy] of cs) { const d = inverseTransformPoint(cx, cy, W, H, rot); mnx = Math.min(mnx, d.x); mny = Math.min(mny, d.y); mxx = Math.max(mxx, d.x); mxy = Math.max(mxy, d.y); }
  return { x: mnx, y: mny, width: mxx - mnx, height: mxy - mny };
}
async function buildSecret() {
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const d = await PDFDocument.create(); const p = d.addPage([W, H]);
  p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  p.drawRectangle({ x: SECRET.x, y: SECRET.y, width: SECRET.w, height: SECRET.h, color: rgb(0, 1, 0) });
  return d;
}
async function sample(doc: import('@cantoo/pdf-lib').PDFDocument, dx: number, dy: number) {
  const bytes = await doc.save({ useObjectStreams: false });
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise; const pg = await pdf.getPage(1);
  const vp = pg.getViewport({ scale: SCALE }); const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const cx = c.getContext('2d') as CanvasRenderingContext2D; await pg.render({ canvas: c, viewport: vp }).promise;
  const img = cx.getImageData(Math.round(dx * SCALE) - 1, Math.round(dy * SCALE) - 1, 3, 3).data;
  let r = 0, g = 0, b = 0; for (let i = 0; i < img.length; i += 4) { r += img[i]; g += img[i + 1]; b += img[i + 2]; }
  const n = img.length / 4; return { r: r / n, g: g / n, b: b / n };
}

describe('redaction layering — overlay on top of a redaction (export, rotation-safe)', () => {
  it.each([0, 90])('a shape over a redaction renders ABOVE the burn while source stays destroyed (%i°)', async (rot) => {
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    const src = await buildSecret(); const target = await PDFDocument.create();
    const docPage: DocumentPage = { id: 'p1', sourcePdfId: 's', sourcePageNum: 1, rotation: rot };
    const rBox = dispBox(rot, SECRET);                                  // redaction == secret's displayed box
    const sBox = { x: rBox.x + 8, y: rBox.y + 8, w: 40, h: rBox.height - 16 }; // shape inside it, left side
    const redaction = new RedactionElement(rBox.x, rBox.y, rBox.width, rBox.height, 'p1', '#000000') as unknown as PDFElement;
    const shape = new ShapeElement('rect', sBox.x, sBox.y, sBox.w, sBox.h, 'p1', { strokeColor: '#ff0000', fillColor: '#ff0000', strokeWidth: 2 }) as unknown as PDFElement;
    await rasterizePageWithRedactions(src, docPage, [redaction, shape], target, { rgb, StandardFonts, degrees }, noWM, new InkLayer(), rep);

    // shape centre → RED (overlay on top of the burn)
    const onShape = await sample(target, sBox.x + sBox.w / 2, sBox.y + sBox.h / 2);
    expect(onShape.r).toBeGreaterThan(150);
    expect(onShape.g).toBeLessThan(90);
    expect(onShape.b).toBeLessThan(90);

    // redaction area to the RIGHT of the shape → BLACK (green secret destroyed)
    const onBurn = await sample(target, rBox.x + rBox.width - 8, rBox.y + rBox.height / 2);
    expect(onBurn.r).toBeLessThan(50);
    expect(onBurn.g).toBeLessThan(50);
    expect(onBurn.b).toBeLessThan(50);
  });
});
