/**
 * Feature 3 — overlay-text link annotation in the export bake (real Chrome).
 *
 * Bakes a linked TextElement with the real export renderer, then re-reads the page with
 * pdf.js and asserts a `/Link` annotation with the sanitized URL exists. A second case sets
 * a `javascript:` URL DIRECTLY on the element (bypassing the service) and asserts the bake's
 * own sanitiser drops it → NO annotation (defence-in-depth against a crafted saved blob).
 *
 * Why real Chrome: pdf.js getAnnotations parses the baked /Annots — jsdom can't.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, degrees, StandardFonts } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { renderElementToPdfLib } from '../../src/export/pdfElementRenderer';
import { TextElement } from '../../src/elements/textElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

interface LinkAnnot { subtype?: string; url?: string; unsafeUrl?: string; rect?: number[]; }

async function bakeAndGetAnnots(te: TextElement): Promise<LinkAnnot[]> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  await renderElementToPdfLib(te, {
    pdfDoc: doc, page,
    libs: { rgb, StandardFonts, degrees },
    w: 300, h: 300, W_orig: 300, H_orig: 300, totalRot: 0, cropOriginX: 0, cropOriginY: 0,
  });
  const bytes = await doc.save();
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const p = await pdf.getPage(1);
  return (await p.getAnnotations()) as LinkAnnot[];
}

describe('Feature 3 — overlay link annotation bakes into the export', () => {
  it('writes a Link annotation with the sanitized URL', async () => {
    const te = new TextElement(40, 40, 'p1', { linkUrl: 'https://example.com/x', fontSize: 18, width: 160, height: 30 });
    te.text = 'Click me';
    const annots = await bakeAndGetAnnots(te);
    const link = annots.find((a) => a.subtype === 'Link');
    expect(link).toBeTruthy();
    expect(link?.url ?? link?.unsafeUrl).toBe('https://example.com/x');
    // the rect should be a 4-number array roughly over the element box
    expect(Array.isArray(link?.rect)).toBe(true);
    expect(link?.rect?.length).toBe(4);
  });

  it('drops a javascript: URL set directly on the element (no annotation)', async () => {
    const te = new TextElement(40, 40, 'p1', { fontSize: 18, width: 160, height: 30 });
    te.text = 'evil';
    te.linkUrl = 'javascript:alert(1)'; // bypass the service to test the bake guard
    const annots = await bakeAndGetAnnots(te);
    expect(annots.find((a) => a.subtype === 'Link')).toBeFalsy();
  });
});
