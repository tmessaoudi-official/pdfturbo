/**
 * CEILING pins for limits that were asserted NOWHERE before 2026-07-31.
 *
 * Per this directory's convention, a CEILING blocker is a normal PASSING `it` that pins the current
 * degraded behaviour, so a future change that alters it is noticed. These are not defects.
 *
 * Covers C12 (markup annotations survive form flatten); C10 was lifted by limits row 21. C21 and
 * C19 need a real canvas and a real font, so they live in tests/browser/ceilings.browser.test.ts
 * instead — jsdom has no canvas and cannot embed a font subset.
 */
import { describe, it, expect } from 'vitest';

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

// C10 (4+ columns) is no longer a ceiling — limits row 21 made the split central and three levels deep; its guards
// live in tests/utils/flowDocColumns.test.ts.
