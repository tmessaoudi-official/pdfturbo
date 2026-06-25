/**
 * A1 (true-edit) — a Path-3 standard-font redraw of ROTATED text must keep the
 * rotation, not land axis-aligned upright. buildPath3Redraw used to hard-code an
 * identity `1 0 0 1 x y Tm`; A1 emits the captured text→user matrix (textMatrix×CTM)
 * as the Tm, using the base Tf size so the scale doesn't double-apply.
 *
 * Path-3 is forced the same way as the alpha/spot-color tests: a STANDARD Helvetica
 * font edited to text with a non-ASCII WinAnsi char (`ö`). The text is drawn with a
 * 90° rotation Tm, so its inked bounding box is TALLER than wide; after the edit it
 * must still be taller than wide (rotation preserved). jsdom can't rasterize this.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, PDFName } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { replaceTextAt } from '../../src/utils/contentStreamEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE = 200;
const ORIGIN = { x: 110, y: 30 }; // Tm translation → page-space origin (identity CTM)

/** One-page PDF: "Hello" in Helvetica drawn with a 90° rotation Tm (reads upward). */
async function makeRotatedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([PAGE, PAGE]);
  page.node.set(PDFName.of('Resources'), pdf.context.register(pdf.context.obj({ Font: { Helv: helv.ref } })));
  // 90° CCW rotation matrix [0 1 -1 0]; glyphs march UP the page from the origin.
  const content = `0 0 0 rg BT /Helv 26 Tf 0 1 -1 0 ${ORIGIN.x} ${ORIGIN.y} Tm (Hello) Tj ET`;
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(bytes)));
  return pdf.save();
}

/** Inked bounding box; returns height/width aspect (>1 = taller than wide = vertical). */
async function inkAspect(bytes: Uint8Array, scale = 3): Promise<{ aspect: number; ink: number }> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no ctx');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width, maxX = -1, minY = height, maxY = -1, ink = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (255 - data[i] + (255 - data[i + 1]) + (255 - data[i + 2]) > 60) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        ink++;
      }
    }
  }
  if (ink === 0) return { aspect: 0, ink: 0 };
  return { aspect: (maxY - minY + 1) / Math.max(1, maxX - minX + 1), ink };
}

describe('true-edit — Path-3 redraw keeps rotation (A1)', () => {
  it('redraws rotated text rotated (vertical bbox), not upright', async () => {
    const original = await makeRotatedPdf();
    const before = await inkAspect(original);
    expect(before.ink).toBeGreaterThan(50);
    expect(before.aspect).toBeGreaterThan(1.3); // sanity: the source really is vertical

    const doc = await PDFDocument.load(original.slice(0));
    expect(await replaceTextAt(doc, 0, ORIGIN, 'Wörld', 6)).toBe(true); // ö → Path 3
    const after = await inkAspect(await doc.save());
    expect(after.ink).toBeGreaterThan(50);          // the redraw drew glyphs
    expect(after.aspect).toBeGreaterThan(1.3);        // STILL vertical → rotation preserved
  });
});
