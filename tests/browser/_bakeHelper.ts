/**
 * Shared bake helper for browser-test suites that need to render a single
 * PDFElement onto a blank pdf-lib page and get back raw PDF bytes.
 *
 * Extracted from tests/browser/text-toolbar-bake.browser.test.ts so that
 * multiple browser-test files can reuse the same minimal page setup without
 * duplication.
 */
import { PDFDocument, rgb, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { renderElementToPdfLib, type PdfRenderCtx } from '../../src/export/pdfElementRenderer';
import type { PDFElement } from '../../src/elements/annotationElement';

const W = 400;
const H = 400;

/**
 * Render a single PDFElement onto a 400×400 blank page and return the
 * resulting PDF as a Uint8Array. Page geometry mirrors what the existing
 * text-toolbar-bake tests use: no page rotation, no crop offset.
 */
export async function bakeElementToPdf(element: PDFElement): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([W, H]);
  const ctx: PdfRenderCtx = {
    pdfDoc, page,
    libs: { rgb, StandardFonts, degrees },
    h: H, w: W, W_orig: W, H_orig: H,
    totalRot: 0, cropOriginX: 0, cropOriginY: 0,
  };
  await renderElementToPdfLib(element, ctx);
  return pdfDoc.save();
}
