/**
 * Limits row 25 (D17) — brackets, guillemets and list bullets in an exported Arabic line.
 *
 * Noto Naskh Arabic has no glyph for `( ) [ ] •`, so they drew as `.notdef` boxes and extracted as U+0000;
 * and fontkit draws a Bidi_Mirrored character as given, so a bracket at an RTL level faced the wrong way
 * (UAX#9 L4 was never applied). The oracle is the one a reader sees: what pdf.js extracts, in the order
 * the items sit on the page — Arabic collapsed to `A` — plus, for the guillemets Noto DOES have, which way
 * the glyph at each end of the line points.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { drawArabicLine, measureArabicLine } from '../../src/export/arabicOverlay';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const SIZE = 32, SCALE = 3, W = 400, H = 80, RIGHT = 380;

interface Drawn { items: Array<{ str: string; x: number }>; canvas: HTMLCanvasElement }

async function draw(text: string): Promise<Drawn> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const pg = doc.addPage([W, H]);
  await drawArabicLine(doc, pg, { text, x: 20, y: 30, right: RIGHT, size: SIZE, color: { r: 0, g: 0, b: 0 } });
  const pdf = await pdfjsLib.getDocument({ data: await doc.save() }).promise;
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  const items = (tc.items as Array<{ str?: string; transform?: number[] }>)
    .filter(it => typeof it.str === 'string' && it.transform)
    .map(it => ({ str: it.str as string, x: (it.transform as number[])[4] }));
  const vp = page.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: vp }).promise;
  return { items, canvas };
}

/** Items left to right, Arabic letters collapsed to one `A` per stretch, whitespace dropped. */
function visual(d: Drawn): string {
  return [...d.items].sort((a, b) => a.x - b.x).map(i => i.str).join('')
    .replace(/[؀-ۿﭐ-﷿ﹰ-﻿]+/g, 'A').replace(/\s+/g, '').replace(/A+/g, 'A');
}

const noNul = (d: Drawn) => d.items.every(i => !i.str.includes('\u0000'));

/**
 * Which way the glyph at one end of the ink points: `<` when its middle row reaches further out than its
 * top row (a `«`-shaped chevron at the left end), `>` otherwise. Only the outer 0.3 em is read.
 */
function endGlyphPoints(canvas: HTMLCanvasElement, end: 'left' | 'right'): '<' | '>' {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const { width, height } = canvas;
  const d = ctx.getImageData(0, 0, width, height).data;
  const ink = (x: number, y: number) => d[(y * width + x) * 4] < 128;
  let edge = end === 'left' ? width : -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (ink(x, y)) edge = end === 'left' ? Math.min(edge, x) : Math.max(edge, x);
  }
  const span = Math.round(0.3 * SIZE * SCALE);
  const [x0, x1] = end === 'left' ? [edge, edge + span] : [edge - span, edge];
  const outer = (y: number) => {
    let best = end === 'left' ? Infinity : -Infinity;
    for (let x = x0; x <= x1; x++) if (ink(x, y)) best = end === 'left' ? Math.min(best, x) : Math.max(best, x);
    return best;
  };
  const rows: number[] = [];
  for (let y = 0; y < height; y++) if (Number.isFinite(outer(y))) rows.push(y);
  const top = rows[Math.round(rows.length * 0.12)], mid = rows[Math.round(rows.length / 2)];
  const midOut = end === 'left' ? outer(mid) < outer(top) : outer(mid) > outer(top);
  // Left end: middle further out → points left `<`. Right end: middle further out → points right `>`.
  return end === 'left' ? (midOut ? '<' : '>') : (midOut ? '>' : '<');
}

describe('Arabic overlay — mirrored brackets and list markers (row 25, D17)', () => {
  it('parentheses are drawn, mirrored, one at each end', async () => {
    const d = await draw('(مرحبا)');
    expect(noNul(d)).toBe(true);
    expect(visual(d)).toBe('(A)');
  });

  it('a DOUBLE bracket is mirrored AND reversed within its piece', async () => {
    const d = await draw('[(مرحبا)]');
    expect(noNul(d)).toBe(true);
    expect(visual(d)).toBe('[(A)]');
  });

  it('a bullet marker is drawn, at the right end', async () => {
    const d = await draw('• مرحبا');
    expect(noNul(d)).toBe(true);
    expect(visual(d)).toBe('A•');
  });

  it('brackets around a Latin word inside an Arabic line are drawn and face the word', async () => {
    const d = await draw('مرحبا [PDF] نعم');
    expect(noNul(d)).toBe(true);
    expect(visual(d)).toBe('A[PDF]A');
  });

  it('guillemets (Noto has them) are mirrored: the left end points left, the right end right', async () => {
    const d = await draw('«مرحبا»');
    expect(noNul(d)).toBe(true);
    expect(endGlyphPoints(d.canvas, 'left')).toBe('<');
    expect(endGlyphPoints(d.canvas, 'right')).toBe('>');
  });

  it('CONTROL: an ordered marker already sat on the right, and still does', async () => {
    const d = await draw('1. مرحبا');
    // The `.` resolves RTL and rides inside the Noto item, whose string pdf.js re-orders — so only the
    // digit's own item can be placed: it is the rightmost thing on the line.
    const rightmost = [...d.items].sort((a, b) => b.x - a.x)[0];
    expect(rightmost.str).toBe('1');
    expect(noNul(d)).toBe(true);
  });

  it('the line is right-aligned by the width measureArabicLine reports (the redaction footprint)', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    for (const t of ['[(مرحبا)]', '• مرحبا', 'مرحبا [PDF] نعم']) {
      const w = await measureArabicLine(await PDFDocument.create(), { text: t, size: SIZE });
      const d = await draw(t);
      const xs = d.items.map(i => i.x);
      // The leftmost item starts where a right-aligned run of the measured width starts.
      expect(Math.min(...xs)).toBeCloseTo(RIGHT - w, 1);
    }
  });
});
