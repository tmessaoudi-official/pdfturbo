/**
 * Searchable-OCR layer — coordinate-transform + op-structure unit tests (jsdom).
 *
 * The risky part of the searchable-OCR spike is the OCR-pixel → PDF-point
 * transform (top-left image origin → bottom-left PDF origin) and the invisible
 * (`3 Tr`) text-op emission. pdf-lib's standard-font path is pure JS (no fontkit,
 * no canvas) so both are exercisable in jsdom; the pdf.js round-trip
 * "is it actually selectable" proof lives in the real-Chrome browser test.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, StandardFonts, degrees, type PDFOperator } from '@cantoo/pdf-lib';
import {
  wordToTextPlacement,
  buildInvisibleTextLayerOps,
  partitionWordsByFont,
  applySearchableLayerToPdf,
  rotateBBoxToUnrotated,
  SearchableLayerError,
} from '../../src/ocr/searchableTextLayer';

describe('wordToTextPlacement', () => {
  const pageHeight = 200;
  const scale = 2;

  it('maps x0 to x divided by the render scale', () => {
    const p = wordToTextPlacement({ x0: 40, y0: 10, x1: 100, y1: 30 }, scale, pageHeight);
    expect(p.x).toBe(20); // 40 / 2
  });

  it('flips the y axis: baseline = pageHeight - (bbox bottom / scale)', () => {
    const p = wordToTextPlacement({ x0: 40, y0: 10, x1: 100, y1: 30 }, scale, pageHeight);
    expect(p.baselineY).toBe(185); // 200 - (30 / 2)
  });

  it('derives font size from the bbox height over the scale', () => {
    const p = wordToTextPlacement({ x0: 40, y0: 10, x1: 100, y1: 30 }, scale, pageHeight);
    expect(p.size).toBe(10); // (30 - 10) / 2
  });

  it('floors size at a positive minimum for degenerate (zero-height) boxes', () => {
    const p = wordToTextPlacement({ x0: 0, y0: 50, x1: 10, y1: 50 }, scale, pageHeight);
    expect(p.size).toBeGreaterThan(0);
  });
});

describe('rotateBBoxToUnrotated', () => {
  // A rotated-canvas render whose pixel dimensions are 120 (w) × 80 (h).
  // A word sits in the top-left of the rendered (rotated) image: x0=0,y0=0,x1=30,y1=20.
  const RW = 120;
  const RH = 80;
  const tl = { x0: 0, y0: 0, x1: 30, y1: 20 };

  it('is the identity at 0° (rotation-0 byte-identical guarantee)', () => {
    expect(rotateBBoxToUnrotated(tl, 0, RW, RH)).toEqual(tl);
  });

  it('maps a top-left word to a top-right word and swaps w/h at 90°', () => {
    // 90° display rotation (CW): unrotated canvas is RH×RW = 80×120.
    // Top-left of the rotated render came from the top-right of the unrotated page.
    // (rx,ry)=(0,0) → (ux,uy)=(ry, RW-rx)=(0,120) bottom edge; corner (30,20)→(20,90).
    // Normalized: x∈[0,20], y∈[90,120]. Width 20 = old height, height 30 = old width (swapped).
    const r = rotateBBoxToUnrotated(tl, 90, RW, RH);
    expect(r).toEqual({ x0: 0, y0: 90, x1: 20, y1: 120 });
    expect(r.x1 - r.x0).toBe(20); // old height
    expect(r.y1 - r.y0).toBe(30); // old width
  });

  it('mirrors both axes (no swap) at 180°', () => {
    // (rx,ry)→(RW-rx, RH-ry). Corners (0,0)&(30,20) → (120,80)&(90,60).
    // Normalized: x∈[90,120], y∈[60,80].
    expect(rotateBBoxToUnrotated(tl, 180, RW, RH)).toEqual({ x0: 90, y0: 60, x1: 120, y1: 80 });
  });

  it('maps a top-left word to a bottom-left word and swaps w/h at 270°', () => {
    // 270° display: unrotated canvas RH×RW = 80×120. (rx,ry)→(RH-ry, rx).
    // Corners (0,0)&(30,20) → (80,0)&(60,30). Normalized: x∈[60,80], y∈[0,30].
    const r = rotateBBoxToUnrotated(tl, 270, RW, RH);
    expect(r).toEqual({ x0: 60, y0: 0, x1: 80, y1: 30 });
    expect(r.x1 - r.x0).toBe(20); // old height
    expect(r.y1 - r.y0).toBe(30); // old width
  });

  it('round-trips a 90° remap through wordToTextPlacement onto the unrotated page', () => {
    // Unrotated page is 120pt wide × 240pt tall (portrait); rendered at scale 2
    // with a 90° /Rotate → rotated canvas is 480w × 240h px (landscape).
    // A word at the rotated render's top-left maps to the unrotated page's top edge.
    const scale = 2;
    const unrotatedPageH = 240; // points
    const renderW = 480;
    const renderH = 240;
    const word = { x0: 0, y0: 0, x1: 40, y1: 20 }; // rotated-canvas px
    const u = rotateBBoxToUnrotated(word, 90, renderW, renderH);
    const p = wordToTextPlacement(u, scale, unrotatedPageH);
    // u = (ry, RW-rx): (0,0)&(40,20) → (0,480)&(20,440) → x∈[0,20], y∈[440,480].
    // x = 0/2 = 0; baselineY = 240 - 480/2 = 0 (bottom edge ⇒ top of the unrotated page
    //   becomes the visual top after the page's own /Rotate re-applies); size=(480-440)/2=20.
    expect(p.x).toBe(0);
    expect(p.baselineY).toBe(0);
    expect(p.size).toBe(20);
  });
});

describe('buildInvisibleTextLayerOps', () => {
  async function helvetica() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 200]);
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    return { doc, font, page, fontKey };
  }

  it('emits 6 text operators (BT · Tr · Tf · Tm · Tj · ET) per non-empty word', async () => {
    const { font, fontKey } = await helvetica();
    const ops = buildInvisibleTextLayerOps(
      [
        { text: 'Hello', bbox: { x0: 0, y0: 0, x1: 60, y1: 20 } },
        { text: 'World', bbox: { x0: 70, y0: 0, x1: 130, y1: 20 } },
      ],
      { scale: 2, pageHeight: 200, font, fontKey },
    );
    expect(ops).toHaveLength(12); // 2 words × 6 ops
  });

  it('skips empty / whitespace-only words', async () => {
    const { font, fontKey } = await helvetica();
    const ops = buildInvisibleTextLayerOps(
      [
        { text: '   ', bbox: { x0: 0, y0: 0, x1: 60, y1: 20 } },
        { text: 'Real', bbox: { x0: 70, y0: 0, x1: 130, y1: 20 } },
      ],
      { scale: 2, pageHeight: 200, font, fontKey },
    );
    expect(ops).toHaveLength(6); // only the one real word
  });

  it('sets the invisible text render mode (3 Tr) on every word', async () => {
    const { font, fontKey } = await helvetica();
    const ops = buildInvisibleTextLayerOps(
      [{ text: 'Hi', bbox: { x0: 0, y0: 0, x1: 20, y1: 20 } }],
      { scale: 2, pageHeight: 200, font, fontKey },
    );
    // `op.toString()` is the public surface; a Tr op serialises as "<mode> Tr".
    const trOps = ops.filter((o: PDFOperator) => o.toString().trim().endsWith(' Tr'));
    expect(trOps).toHaveLength(1);
    expect(trOps[0].toString().trim()).toBe('3 Tr'); // TextRenderingMode.Invisible
  });
});

describe('partitionWordsByFont', () => {
  const bbox = { x0: 0, y0: 0, x1: 10, y1: 10 };

  it('routes Arabic words to the Arabic group', () => {
    const r = partitionWordsByFont([{ text: 'مرحبا', bbox }]);
    expect(r.arabic.map((w) => w.text)).toEqual(['مرحبا']);
    expect(r.latin).toHaveLength(0);
  });

  it('routes WinAnsi-safe Latin words (incl. accents) to the Latin group', () => {
    const r = partitionWordsByFont([
      { text: 'Hello', bbox },
      { text: 'café', bbox }, // é, ñ, ü, ã etc. are all WinAnsi
      { text: 'Düsseldorf', bbox },
    ]);
    expect(r.latin).toHaveLength(3);
    expect(r.arabic).toHaveLength(0);
    expect(r.skipped).toHaveLength(0);
  });

  it('skips non-Arabic words that fall outside WinAnsi (e.g. CJK)', () => {
    const r = partitionWordsByFont([{ text: '日本語', bbox }]);
    expect(r.skipped.map((w) => w.text)).toEqual(['日本語']);
    expect(r.latin).toHaveLength(0);
    expect(r.arabic).toHaveLength(0);
  });

  it('skips empty / whitespace-only words', () => {
    const r = partitionWordsByFont([{ text: '   ', bbox }]);
    expect(r.skipped).toHaveLength(1);
    expect(r.latin).toHaveLength(0);
  });
});

describe('applySearchableLayerToPdf (Latin / jsdom)', () => {
  async function makeSourcePdf(rotation = 0): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    if (rotation) page.setRotation(degrees(rotation));
    return doc.save();
  }

  it('returns a valid PDF carrying the invisible Latin layer', async () => {
    const src = await makeSourcePdf();
    const out = await applySearchableLayerToPdf(
      src,
      1,
      [{ text: 'Searchable', bbox: { x0: 40, y0: 20, x1: 230, y1: 60 } }],
      2,
    );
    expect(out).toBeInstanceOf(Uint8Array);
    if (!out) throw new Error('expected layer bytes');
    expect(out.length).toBeGreaterThan(src.length);
    // Re-loadable as a PDF (structurally valid).
    await expect(PDFDocument.load(out)).resolves.toBeTruthy();
  });

  it('returns null when no word survives partitioning', async () => {
    const src = await makeSourcePdf();
    const out = await applySearchableLayerToPdf(src, 1, [{ text: '日本', bbox: { x0: 0, y0: 0, x1: 9, y1: 9 } }], 2);
    expect(out).toBeNull();
  });

  it('writes a layer (does NOT throw) on a 90° cardinal-rotated page', async () => {
    const src = await makeSourcePdf(90);
    // Page is 300×200, /Rotate 90 → rendered canvas is 400w × 600h px at scale 2.
    const out = await applySearchableLayerToPdf(
      src,
      1,
      [{ text: 'Rotated', bbox: { x0: 10, y0: 10, x1: 120, y1: 50 } }],
      2,
    );
    expect(out).toBeInstanceOf(Uint8Array);
    if (!out) throw new Error('expected layer bytes');
    expect(out.length).toBeGreaterThan(src.length);
    await expect(PDFDocument.load(out)).resolves.toBeTruthy();
  });

  it('writes a layer on 180° and 270° cardinal-rotated pages', async () => {
    for (const angle of [180, 270]) {
      const src = await makeSourcePdf(angle);
      const out = await applySearchableLayerToPdf(
        src,
        1,
        [{ text: 'Word', bbox: { x0: 10, y0: 10, x1: 80, y1: 40 } }],
        2,
      );
      expect(out, `angle ${angle}`).toBeInstanceOf(Uint8Array);
    }
  });

  it('still throws ROTATED_PAGE for a genuinely non-cardinal angle (malformed /Rotate)', async () => {
    // pdf-lib's setRotation REJECTS non-multiples of 90, so build a /Rotate 45 page
    // by hand (the reader getRotation() does NOT validate, mirroring a real-world
    // malformed PDF). The cardinal-rotation support must still refuse 45°.
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    page.node.set(PDFName.of('Rotate'), doc.context.obj(45));
    const src = await doc.save();
    await expect(
      applySearchableLayerToPdf(src, 1, [{ text: 'Hi', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }], 2),
    ).rejects.toMatchObject({ code: 'ROTATED_PAGE' });
    expect(new SearchableLayerError('ROTATED_PAGE')).toBeInstanceOf(Error);
  });
});
