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
import { PDFDocument, StandardFonts, degrees, type PDFOperator } from '@cantoo/pdf-lib';
import {
  wordToTextPlacement,
  buildInvisibleTextLayerOps,
  partitionWordsByFont,
  applySearchableLayerToPdf,
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

  it('throws SearchableLayerError("ROTATED_PAGE") on a rotated page', async () => {
    const src = await makeSourcePdf(90);
    await expect(
      applySearchableLayerToPdf(src, 1, [{ text: 'Hi', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }], 2),
    ).rejects.toMatchObject({ code: 'ROTATED_PAGE' });
    expect(new SearchableLayerError('ROTATED_PAGE')).toBeInstanceOf(Error);
  });
});
