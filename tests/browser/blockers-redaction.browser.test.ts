/**
 * CORE-P0-1 confirming test (real Chrome) — does a redaction on a ROTATED page
 * actually cover the secret pixels?
 *
 * Research claim (source-read only, never run): exportPipeline.rasterizePageWithRedactions
 * draws the burn `fillRect` with unrotated `el.x/el.y` on a rotated-viewport canvas, so on
 * 90/270 pages the cover is misplaced and the secret leaks. This test settles it empirically:
 * it builds a 1-page PDF with a pure-red "secret", rotates the DocumentPage 90°, places a
 * black redaction over the secret's DISPLAYED location (computed with the project's OWN
 * inverseTransformPoint — the same convention the editor stores element coords in), runs the
 * real rasterizer, renders the output with pdf.js, and counts red pixels.
 *
 * PASS contract: 0 red pixels (secret fully covered). A control pass WITHOUT the redaction
 * asserts the red secret IS present (the test can actually see leakage), so a green result is
 * meaningful and not a false negative. jsdom cannot run getViewport/render — hence browser.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { rasterizePageWithRedactions } from '../../src/export/exportPipeline';
import { inverseTransformPoint } from '../../src/utils/geometry';
import { RedactionElement } from '../../src/elements/redactionElement';
import { InkLayer } from '../../src/infra/inkLayer';
import { reconstructPage, type RawTextItem, type FontInfoMap, type RedactionRect } from '../../src/utils/flowDoc';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W_ORIG = 200;
const H_ORIG = 400;
// Secret rect in pdf-lib content space (bottom-left origin): near the top-left of the
// unrotated page so its displayed position is unambiguous after a 90° rotation.
const SECRET = { x: 30, y: 300, w: 120, h: 60 };

const noopReporter: IErrorReporter = {
  info() {}, warn() {}, error() {}, silent() {},
} as unknown as IErrorReporter;

const noWatermark: WatermarkSettings = {
  enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10,
};

async function buildSecretPdf(): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W_ORIG, H_ORIG]);
  page.drawRectangle({ x: 0, y: 0, width: W_ORIG, height: H_ORIG, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: SECRET.x, y: SECRET.y, width: SECRET.w, height: SECRET.h, color: rgb(1, 0, 0) });
  return doc;
}

/** Displayed-space (editor, top-left origin) AABB of the secret at the given rotation. */
function secretDisplayedBox(totalRot: number) {
  const corners = [
    [SECRET.x, SECRET.y],
    [SECRET.x + SECRET.w, SECRET.y],
    [SECRET.x, SECRET.y + SECRET.h],
    [SECRET.x + SECRET.w, SECRET.y + SECRET.h],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [cx, cy] of corners) {
    const d = inverseTransformPoint(cx, cy, W_ORIG, H_ORIG, totalRot);
    if (d.x < minX) minX = d.x; if (d.x > maxX) maxX = d.x;
    if (d.y < minY) minY = d.y; if (d.y > maxY) maxY = d.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

async function renderAndCountRed(targetDoc: import('@cantoo/pdf-lib').PDFDocument): Promise<number> {
  const bytes = await targetDoc.save({ useObjectStreams: false });
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const p = await pdf.getPage(1);
  const vp = p.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  await p.render({ canvas, viewport: vp }).promise;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let red = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) red++;
  }
  return red;
}

// srcRot is 0 for our freshly-built page, so totalRot === userRot === rotation.
describe.each([0, 90, 180, 270])('CORE-P0-1 — redaction on a %i° page covers the secret', (rotation) => {
  const docPage: DocumentPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation };

  it('CONTROL: without redaction the red secret IS visible in the rendered output', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const src = await buildSecretPdf();
    const target = await PDFDocument.create();
    const libs = await import('@cantoo/pdf-lib');
    await rasterizePageWithRedactions(
      src, docPage, [], target,
      { rgb: libs.rgb, StandardFonts: libs.StandardFonts, degrees: libs.degrees },
      noWatermark, new InkLayer(), noopReporter,
    );
    const red = await renderAndCountRed(target);
    expect(red).toBeGreaterThan(500); // secret present → leak detectable
  });

  it('redaction over the secret leaves ZERO red pixels (no leak on rotated page)', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const src = await buildSecretPdf();
    const target = await PDFDocument.create();
    const box = secretDisplayedBox(rotation);
    const redaction = new RedactionElement(box.x, box.y, box.width, box.height, docPage.id, '#000000') as unknown as PDFElement;
    const libs = await import('@cantoo/pdf-lib');
    await rasterizePageWithRedactions(
      src, docPage, [redaction], target,
      { rgb: libs.rgb, StandardFonts: libs.StandardFonts, degrees: libs.degrees },
      noWatermark, new InkLayer(), noopReporter,
    );
    const red = await renderAndCountRed(target);
    expect(red).toBe(0);
  });
});

// ── Flow-export (DOCX/MD/TXT) redaction on rotated pages ──────────────────────
// This is the ACTUAL rotated-redaction bug (the raster path above is correct).
// _extractFlowDoc passes redaction rects in editor DISPLAYED space but calls
// reconstructPage with the UNROTATED content viewport — isItemRedacted compares
// mismatched spaces, so redacted text leaks into DOCX/MD/TXT on rotated pages.

async function buildTextPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W_ORIG, H_ORIG]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // SECRET inside the SECRET region [30,300]-[150,360] (y-up); VISIBLE near the bottom.
  page.drawText('SECRET', { x: 35, y: 318, size: 22, font, color: rgb(0, 0, 0) });
  page.drawText('VISIBLE', { x: 35, y: 60, size: 22, font, color: rgb(0, 0, 0) });
  return doc.save();
}

/** Run the exact _extractFlowDoc redaction path for one rotation; return the flowed text. */
async function flowTextWithRedaction(rotation: number): Promise<string> {
  const bytes = await buildTextPdf();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const p = await pdf.getPage(1);
  const content = await p.getTextContent();
  const items = content.items as unknown as RawTextItem[];
  const vp = p.getViewport({ scale: 1 }); // exportService: unrotated content viewport
  const box = secretDisplayedBox(rotation);
  const redactions: RedactionRect[] = [{ x: box.x, y: box.y, width: box.width, height: box.height }];
  // 9th arg = page rotation; reconstructPage un-rotates the redaction rect (the fix).
  const flowPage = reconstructPage(items, {} as FontInfoMap, vp.width, vp.height, undefined, redactions, undefined, undefined, rotation);
  return flowPage.paragraphs.flatMap((pp) => pp.runs).map((r) => r.text).join(' ');
}

describe.each([0, 90, 180, 270])('CORE-P0-1 flow-export — redaction drops SECRET on a %i° page', (rotation) => {
  it('redacted SECRET does NOT leak into DOCX/MD/TXT flow text; VISIBLE survives', async () => {
    const text = await flowTextWithRedaction(rotation);
    expect(text).toContain('VISIBLE'); // sanity: non-redacted text is present
    expect(text).not.toContain('SECRET'); // redacted text must be gone
  });
});
