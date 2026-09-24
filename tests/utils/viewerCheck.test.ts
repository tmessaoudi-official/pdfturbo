// @vitest-environment node
/**
 * WS8: the viewer check compares, page by page, what pdf.js shows for a document with what pdf.js shows for the
 * copy pdf-lib will export (its pages copied into a fresh document). docs/archive/plans/ws8-viewer-check.plan.md step 2.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { viewerMismatch } from '../../src/utils/viewerCheck';
import { buildPageOrderPdf, buildXrefCountPdf, buildXrefShapePdf } from './_invalidObjectFixture';
import { buildDupContentPdf, buildLayerPdf } from './_viewerCheckFixture';

// Opened with the SAME options the check uses for its copy (as `viewerVerdict` does): the operand hash sees glyph
// widths, which change with `standardFontDataUrl`, so opening the two sides differently mismatches every text page.
const open = (bytes: Uint8Array) => pdfjs.getDocument({ data: bytes.slice(0), verbosity: 0 }).promise;

async function check(bytes: Uint8Array) {
  const original = await open(bytes);
  const libDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  try {
    return await viewerMismatch(libDoc, original, pdfjs);
  } finally {
    await original.loadingTask.destroy();
  }
}

describe('viewerMismatch — WS8 step 2', () => {
  it('finds nothing when both readers agree (control)', async () => {
    expect(await check(buildXrefShapePdf('clean'))).toEqual({ pages: [], hiddenLayers: false });
  });

  it('flags the page whose TEXT differs between screen and export', async () => {
    expect((await check(buildXrefShapePdf('dupFirst'))).pages).toEqual([1]);
    expect((await check(buildDupContentPdf('text'))).pages).toEqual([1]);
  });

  it('flags a page whose text matches and whose GRAPHICS differ (a caption over a swapped image)', async () => {
    expect((await check(buildDupContentPdf('graphicsOnly'))).pages).toEqual([1]);
  });

  it('flags a page whose operators match and whose OPERANDS differ — a colour, a position', async () => {
    expect((await check(buildDupContentPdf('colourOnly'))).pages).toEqual([1]);
    expect((await check(buildDupContentPdf('moved'))).pages).toEqual([1]);
  });

  it('does not flag two identical copies (control for the graphics case)', async () => {
    expect((await check(buildDupContentPdf('same'))).pages).toEqual([]);
  });

  it('flags a /Count lie that shows one page and exports another', async () => {
    expect((await check(buildPageOrderPdf('countHidesFirst'))).pages).not.toEqual([]);
  });

  it('allows pdf.js showing FEWER pages than pdf-lib holds when those it shows match', async () => {
    expect((await check(buildPageOrderPdf('countHonest'))).pages).toEqual([]);
  });

  it('agrees with pdf.js on a table whose declared row count is wrong (P3a, both readers repair it the same way)', async () => {
    expect((await check(buildXrefCountPdf('countShort'))).pages).toEqual([]);
    expect((await check(buildXrefCountPdf('countLong'))).pages).toEqual([]);
    expect((await check(buildXrefCountPdf('countHonest'))).pages).toEqual([1]);
  });

  it('reports a layer the document switches OFF, and not one it switches ON', async () => {
    expect(await check(buildLayerPdf('OFF'))).toEqual({ pages: [], hiddenLayers: true });
    expect(await check(buildLayerPdf('ON'))).toEqual({ pages: [], hiddenLayers: false });
  });
});
