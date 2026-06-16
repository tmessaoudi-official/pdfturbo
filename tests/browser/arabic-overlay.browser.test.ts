/**
 * Arabic overlay rendering end-to-end (real Chrome, Phase C): draw Arabic onto a
 * pdf-lib page via the CID glyph-ID path, save, re-open with pdf.js, and assert
 * the text is recovered as real Arabic (ToUnicode roundtrip) — NOT the '?' that
 * the old StandardFonts path produced. jsdom can't fetch the font asset.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { drawArabicLine } from '../../src/export/arabicOverlay';
import { isArabicText } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

describe('drawArabicLine (real Chrome)', () => {
  it('renders shaped Arabic recoverable as real Unicode (no "?")', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    await drawArabicLine(doc, page, {
      text: 'مرحبا',
      x: 20,
      y: 100,
      right: 280,
      size: 24,
      color: { r: 0, g: 0, b: 0 },
    });
    const bytes = await doc.save();

    // The content stream must carry a hex-encoded show-text (Tj), not a literal
    // '?' substitution from a Latin standard font.
    const ascii = String.fromCharCode(...bytes.subarray(0, bytes.length));
    expect(ascii).not.toContain('(?');

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const p = await pdf.getPage(1);
    const content = await p.getTextContent();
    const extracted = content.items.map((item) => (item as { str: string }).str).join('');
    // ToUnicode roundtrip recovers Arabic codepoints → real glyphs were embedded.
    expect(isArabicText(extracted)).toBe(true);
    expect(extracted).not.toContain('?');

    // Rasterize: the Arabic must actually paint visible ink (not a blank/tofu box)
    // and sit in the RIGHT half of the box (RTL right-alignment), confirming the
    // CID-pair reversal placed it right-to-left rather than mirrored left.
    const scale = 3;
    const vp = p.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const cctx = canvas.getContext('2d');
    if (!cctx) throw new Error('no 2d context');
    await p.render({ canvas, canvasContext: cctx, viewport: vp }).promise;
    const px = cctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkCount = 0;
    let sumX = 0;
    let minX = canvas.width;
    let maxX = 0;
    for (let i = 0; i < px.length; i += 4) {
      // luminance < 128 = ink (white bg)
      if (px[i] < 128 && px[i + 1] < 128 && px[i + 2] < 128) {
        darkCount++;
        const x = (i / 4) % canvas.width;
        sumX += x;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    expect(darkCount).toBeGreaterThan(200); // visible ink, not blank
    const centroidX = sumX / darkCount;
    expect(centroidX).toBeGreaterThan(canvas.width / 2); // right-aligned (RTL)

    // Regression guard for the WOFF-embedding bug (2026-06-17): the broken `.woff`
    // font embedded only the `ا` (alef) outline — every other glyph rendered blank,
    // so the word collapsed to one narrow stroke (~840 dark px, ~25px wide at this
    // scale) yet still passed the weak ink/centroid checks above. A correctly
    // embedded font paints all 5 letters of "مرحبا" across a wide span. These
    // thresholds sit firmly between the two regimes (broken ~210/~25px vs fixed
    // ~1400/~135px at size 24, scale 3).
    expect(darkCount).toBeGreaterThan(900); // all glyphs paint, not just alef
    const inkWidthPx = maxX - minX;
    expect(inkWidthPx).toBeGreaterThan(80); // multi-glyph word width, not one stroke
  });
});
