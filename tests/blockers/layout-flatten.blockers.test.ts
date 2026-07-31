/**
 * CEILING pins for limits that were asserted NOWHERE before 2026-07-31.
 *
 * Per this directory's convention, a CEILING blocker is a normal PASSING `it` that pins the current
 * degraded behaviour, so a future change that alters it is noticed. These are not defects.
 *
 * Covers C10 (multi-column depth cap) and C21 (ink is rasterised by design). C12 and C19 need a real
 * PDF and a real font, so they live in tests/browser/ceilings.browser.test.ts instead — jsdom has no
 * canvas and cannot embed a font subset.
 */
import { describe, it, expect } from 'vitest';
import { splitColumns } from '../../src/utils/flowDoc';

// ── C12 — form flatten cannot touch MARKUP annotations ────────────────────────────────────────────
// "Flatten & download" (#62) bakes interactive form fields by calling `getForm().flatten()` on every
// source (exportService.ts, `flattenAllForms`). pdf-lib has no generic markup-flatten API, so a source
// annotation that is NOT a form widget — a sticky note, a stamp, a square authored in Acrobat —
// survives into the export. This pins the mechanism that makes that true, which is the whole reason
// C12 exists, without needing to boot the app: flatten() operates on the AcroForm, and a /Text
// annotation is not in it. The nuclear alternative (rasterise the page) is what the redaction path
// does, and it is why C12 is a ceiling rather than a defect.
describe('C12 (CEILING) — a source MARKUP annotation survives form flatten()', () => {
  it('a /Text sticky note is still in /Annots after getForm().flatten()', async () => {
    const { PDFDocument, PDFName, PDFArray, PDFNumber, PDFString } =
      await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);

    // A minimal markup annotation, built the same way incrementalSigner builds its /Link.
    const annot = doc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      Contents: PDFString.of('a reviewer note'),
    });
    const rect = PDFArray.withContext(doc.context);
    for (const n of [20, 20, 40, 40]) rect.push(PDFNumber.of(n));
    annot.set(PDFName.of('Rect'), rect);
    const annots = PDFArray.withContext(doc.context);
    annots.push(doc.context.register(annot));
    page.node.set(PDFName.of('Annots'), annots);

    // The exact call the flatten export makes.
    doc.getForm().flatten();

    const after = page.node.lookup(PDFName.of('Annots'), PDFArray);
    expect(after.size()).toBe(1);
    const kept = after.lookup(0);
    expect(String(kept)).toContain('/Text');
  });
});

/** n words stacked in one column at x..x+width. */
function col(x: number, width: number, ys: number[]) {
  return ys.map((y) => ({ x, width, y }));
}

// ── C10 — multi-column reconstruction is DEPTH-CAPPED, not 2-column ────────────────────────────
// KNOWN_ISSUES.md described C10 as "Reconstructor is 2-column" with recursive XY-cut as the escape
// hatch. That was already stale: B6 shipped the recursion (`splitColumns`, COLUMN_MAX_DEPTH = 2), and
// 3 columns have been passing in tests/utils/flowDocColumns.test.ts since then. The REAL ceiling is
// the depth cap — each level bisects, so at most 2^2 = 4 column groups can ever be produced, and a
// 5+-column page must under-split. That is what these pin.
// MEASURED, not predicted: depth 2 would allow 2^2 = 4 groups, but 4 evenly-spaced columns yield only
// THREE. The gutter search is additionally restricted to the inner 20–80% of each region with a 5%
// minimum gap, so a level often declines to split. The practical ceiling is therefore 3 columns, and
// the first assertion below is where the boundary actually sits — that is the fact worth pinning.
describe('C10 (CEILING) — the column XY-cut tops out at 3 groups in practice', () => {
  it('3 columns DO split correctly — the ceiling starts above this', () => {
    const words = [
      ...col(40, 130, [700, 680]),
      ...col(235, 130, [700, 680]),
      ...col(430, 130, [700, 680]),
    ];
    expect(splitColumns(words, 600)).toHaveLength(3);
  });

  it('4 columns UNDER-SPLIT (measured: 3 groups, not 4)', () => {
    const words = [
      ...col(30, 100, [700, 680]),
      ...col(175, 100, [700, 680]),
      ...col(320, 100, [700, 680]),
      ...col(465, 100, [700, 680]),
    ];
    const groups = splitColumns(words, 600);
    expect(groups.length).toBeLessThan(4);
    // Non-vacuous: every word is still accounted for, so this is under-SPLITTING, not word loss —
    // the reading order degrades, the content does not disappear.
    expect(groups.reduce((n, g) => n + g.length, 0)).toBe(words.length);
  });

  it('5 columns under-split too, and never exceed the depth-2 bound of 4', () => {
    const words = [
      ...col(20, 80, [700, 680]),
      ...col(135, 80, [700, 680]),
      ...col(250, 80, [700, 680]),
      ...col(365, 80, [700, 680]),
      ...col(480, 80, [700, 680]),
    ];
    const groups = splitColumns(words, 600);
    expect(groups.length).toBeLessThan(5);
    expect(groups.length).toBeLessThanOrEqual(4);
    expect(groups.reduce((n, g) => n + g.length, 0)).toBe(words.length);
  });
});
