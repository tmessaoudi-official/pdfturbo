/**
 * Feature 2 — overlay-text list markers in the export bake (real Chrome).
 *
 * Builds three overlay TextElements (bullet, ordered, plain control), bakes them with the
 * real export renderer onto a blank pdf-lib page, then re-reads the page text with pdf.js
 * and asserts the markers are present for the list elements and ABSENT for the control
 * (which catches a silent regression to the marker-less path).
 *
 * Why a real browser: the bake embeds StandardFonts and pdf.js extracts the drawn glyphs —
 * jsdom cannot rasterize/extract.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import * as pdfLib from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { renderElementToPdfLib } from '../../src/export/pdfElementRenderer';
import { TextElement } from '../../src/elements/textElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function bakeText(te: TextElement): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  await renderElementToPdfLib(te, {
    pdfDoc: doc,
    page,
    libs: { rgb, StandardFonts: pdfLib.StandardFonts, degrees: pdfLib.degrees },
    w: 300, h: 300, W_orig: 300, H_orig: 300, totalRot: 0,
    cropOriginX: 0, cropOriginY: 0,
  });
  const bytes = await doc.save();
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const p = await pdf.getPage(1);
  const tc = await p.getTextContent();
  return tc.items.map((item) => ('str' in item ? item.str : '')).join(' ');
}

describe('Feature 2 — overlay list markers bake into the export', () => {
  it('draws bullet markers for a bullet list', async () => {
    const te = new TextElement(20, 20, 'p1', { list: 'bullet', fontSize: 18, width: 240 });
    te.text = 'apple\nbanana';
    const text = await bakeText(te);
    expect(text).toContain('•');
    expect(text).toContain('apple');
    expect(text).toContain('banana');
  });

  it('draws 1. 2. ordinals for a numbered list', async () => {
    const te = new TextElement(20, 20, 'p1', { list: 'ordered', fontSize: 18, width: 240 });
    te.text = 'first\nsecond';
    const text = await bakeText(te);
    expect(text).toContain('1.');
    expect(text).toContain('2.');
  });

  it('draws NO markers for a plain text element (regression guard)', async () => {
    const te = new TextElement(20, 20, 'p1', { fontSize: 18, width: 240 });
    te.text = 'first\nsecond';
    const text = await bakeText(te);
    expect(text).not.toContain('•');
    expect(text).not.toMatch(/\b1\.\s/);
  });
});
