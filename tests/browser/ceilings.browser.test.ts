/**
 * CEILING pins that need a real browser — canvas for the ink raster, fontkit + a real font subset for
 * the Arabic shaping. Companion to tests/blockers/layout-flatten.blockers.test.ts (C10, C12).
 *
 * Per the tests/blockers convention, a CEILING is a normal PASSING test that pins current degraded
 * behaviour so a future change is noticed. Neither of these is a defect.
 *
 * Covers C21 (raster ink — no per-stroke edit) and C19 (Arabic tashkeel reaches the glyph stream, but
 * its GPOS mark positioning is not modelled).
 */
import { describe, it, expect } from 'vitest';
import { renderInkForExport } from '../../src/export/exportPipeline';
import { getArabicFont } from '../../src/export/arabicOverlay';
import { InkLayer } from '../../src/infra/inkLayer';

// ── C21 — ink is RASTERISED on export, by design ──────────────────────────────────────────────────
// The freehand ink layer is baked to a PNG and stamped onto the page, so nothing downstream can
// recover an individual stroke: no per-stroke edit, no re-colour, no selective erase after export.
// The escape hatch is to use the VECTOR freehand tool instead. This pins the mechanism — the export
// helper hands back an image, not drawing operators.
describe('C21 (CEILING) — ink bakes to a raster image, so strokes are not individually editable', () => {
  it('renderInkForExport returns a PNG data URL, not vector operators', () => {
    const ink = new InkLayer();
    ink.addStroke('p1', {
      type: 'ink', width: 4, color: '#ff0000',
      points: [{ x: 10, y: 10 }, { x: 90, y: 60 }, { x: 150, y: 20 }],
    });
    const out = renderInkForExport(ink, 'p1', 200, 200, 0);
    expect(out).toBeTruthy();
    expect(out as string).toMatch(/^data:image\/png;base64,/);
  });

  it('two distinct strokes collapse into ONE image — the identity loss is the ceiling', () => {
    const one = new InkLayer();
    one.addStroke('p1', { type: 'ink', width: 4, color: '#ff0000', points: [{ x: 10, y: 10 }, { x: 90, y: 60 }] });
    const two = new InkLayer();
    two.addStroke('p1', { type: 'ink', width: 4, color: '#ff0000', points: [{ x: 10, y: 10 }, { x: 90, y: 60 }] });
    two.addStroke('p1', { type: 'ink', width: 4, color: '#0000ff', points: [{ x: 120, y: 30 }, { x: 180, y: 90 }] });

    const a = renderInkForExport(one, 'p1', 200, 200, 0) as string;
    const b = renderInkForExport(two, 'p1', 200, 200, 0) as string;
    // Both are a single flat image. They differ (the 2nd stroke IS drawn) but the result carries no
    // per-stroke structure at all — one opaque blob either way.
    expect(a).toMatch(/^data:image\/png;base64,/);
    expect(b).toMatch(/^data:image\/png;base64,/);
    expect(a).not.toEqual(b);
  });

  it('an empty ink layer bakes nothing (no stray transparent image on every page)', () => {
    expect(renderInkForExport(new InkLayer(), 'p1', 200, 200, 0)).toBeNull();
  });
});

// ── C19 — Arabic tashkeel: encoded, but not GPOS-positioned ───────────────────────────────────────
// fontkit's GSUB shaping runs (letters join correctly, which is why the overlay is legible), but there
// is no GPOS mark-positioning pass, so vowel marks sit at their default advance rather than being
// optically placed over their base letter. The pin distinguishes the two halves: the marks ARE present
// in the glyph stream (they are not silently dropped, which would be a defect), while their placement
// is what remains approximate. The route out is EH-B, a HarfBuzz-WASM shaper.
describe('C19 (CEILING) — tashkeel marks reach the glyph stream; their positioning is not modelled', () => {
  it('a vowelled word encodes MORE glyphs than its unvowelled form (marks are not dropped)', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const font = await getArabicFont(doc);

    const bare = 'محمد';              // 4 letters, no marks
    const vowelled = 'مُحَمَّد';          // same letters + damma/fatha/shadda

    // encodeText returns a PDFHexString, so unwrap it exactly as arabicOverlay.ts does; each 2-byte
    // CID is 4 hex chars. Using `.length` on the PDFHexString itself silently yields NaN.
    const cids = (s: string) => font.encodeText(s).toString().replace(/^<|>$/g, '');
    const bareGlyphs = cids(bare).length / 4;
    const vowelledGlyphs = cids(vowelled).length / 4;

    expect(bareGlyphs).toBeGreaterThan(0);
    // The marks survive shaping as their own glyphs rather than being swallowed.
    expect(vowelledGlyphs).toBeGreaterThan(bareGlyphs);
  });

  it('shaping is real: the joined form of a letter differs from its isolated form', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const font = await getArabicFont(doc);
    // Same base letter, isolated vs medial context — GSUB must pick different glyphs, which is what
    // makes the overlay legible and is precisely the half of shaping that DOES work.
    const cids = (s: string) => font.encodeText(s).toString().replace(/^<|>$/g, '');
    const isolated = cids('ب');
    const joined = cids('ببب');
    expect(joined.length / 4).toBeGreaterThanOrEqual(3);
    // If no contextual substitution happened, three joined letters would be the isolated CID thrice.
    expect(joined).not.toEqual(isolated.repeat(3));
  });
});
