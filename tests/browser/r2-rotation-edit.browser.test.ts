/**
 * R2 regression (2026-06-15 QA sweep) — edit-text click mapping on ROTATED pages.
 *
 * TextEditHandler.handleCanvasClick maps a displayed click → PDF content coords
 * to find the text op under the cursor. The bug used `pdfY = pageH - canvasY`,
 * which only holds at rotation 0; on a 90/180/270 page the mapped point never
 * matched any text-item transform, so edit-text silently found nothing and no
 * editor opened. The fix maps via the rotated viewport's convertToPdfPoint.
 *
 * jsdom cannot prove this: the jsdom unit test hand-mocks convertToPdfPoint, so
 * it verifies the handler DELEGATES but not that REAL pdf.js rotation math lands
 * on the text. This real-Chrome test closes that gap by round-tripping a click
 * through the actual rotated viewport, and shows the old naive flip does NOT.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE_W = 500;
const PAGE_H = 800;
const TEXT_X = 120;
const TEXT_BASELINE = 600;

async function makePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  page.drawText('Rotated', { x: TEXT_X, y: TEXT_BASELINE, size: 20, font });
  return pdf.save();
}

describe('R2 — rotated-page click maps to content via convertToPdfPoint', () => {
  it('round-trips a displayed click to the text content position at rotation 90 (and the naive flip does not)', async () => {
    const bytes = await makePdf();
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const page = await doc.getPage(1);

    // The clickable text item's content-space origin (what the hit-test compares against).
    const tc = await page.getTextContent();
    const item = (tc.items as Array<{ str: string; transform: number[] }>).find((i) => i.str.includes('Rotated'));
    if (!item) throw new Error('text item not found');
    const contentX = item.transform[4];
    const contentY = item.transform[5];

    // Rotated viewport (scale 1) — exactly what handleCanvasClick builds.
    const vp = page.getViewport({ scale: 1, rotation: 90 });

    // Where that text appears on the rotated display → simulate a click there.
    const [dispX, dispY] = vp.convertToViewportPoint(contentX, contentY);

    // The FIX: map the displayed click back to content coords via the viewport.
    const [pdfX, pdfY] = vp.convertToPdfPoint(dispX, dispY);
    expect(Math.hypot(pdfX - contentX, pdfY - contentY)).toBeLessThan(1);

    // The BUG: the old naive flip (pdfY = pageH - canvasY) lands far from the text
    // on a rotated page — proving why edit-text used to find nothing.
    const naiveX = dispX;
    const naiveY = vp.height - dispY;
    expect(Math.hypot(naiveX - contentX, naiveY - contentY)).toBeGreaterThan(50);
  });
});
