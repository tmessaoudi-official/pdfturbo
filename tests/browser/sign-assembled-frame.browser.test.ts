/**
 * WS4-E — the sign-rect prefill and the page it will actually land on are in DIFFERENT frames,
 * and the recorded bound understates by how much.
 *
 * `PdfSigner` signs `assemblePdfBytes()`. For a page carrying a redaction that assembly does not
 * copy the source page at all: `rasterizePageWithRedactions` renders it and adds a FRESH page at
 * origin (0,0), sized to the crop box, with the rotation already baked into the pixels
 * (`exportPipeline.ts:499-503`). Meanwhile `_pageGeomForSign` reports the SOURCE page's `viewBox`
 * and the caller applies `totalRot`, because a `/Rect` is absolute — correct for every other page.
 *
 * CLAUDE.md recorded this as "off by the crop origin". That is true only at rotation 0. These
 * cases measure the real frame of the assembled page so the disclosure can state the bound at the
 * size it actually is: at 90/270 the width and height SWAP as well, so the displacement is a
 * rotation, not a translation.
 *
 * These tests PIN a bound rather than a fix — WS4-E is refuted, see the Decisions Log. They exist
 * so that a future attempt starts from the measured frame instead of from the prose.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { rasterizePageWithRedactions } from '../../src/export/exportPipeline';
import { RedactionElement } from '../../src/elements/redactionElement';
import { displayRectToPageUserSpaceRect, displayRectToUserSpaceRect } from '../../src/utils/geometry';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';
import { InkLayer } from '../../src/infra/inkLayer';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const MEDIA = 400;
const CROP_W = 300, CROP_H = 240;   // non-square on purpose: a square box hides a dimension swap
const ORIGIN = { x: 30, y: 70 };    // asymmetric on purpose, for the same reason on the other axis

const noWatermark: WatermarkSettings =
  { enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10 };
const loudReporter = {
  info() {}, silent() {},
  warn(k: string) { throw new Error(`warned: ${k}`); },
  error(k: string, e?: unknown) { throw new Error(`errored: ${k} — ${String(e)}`); },
} as unknown as IErrorReporter;

async function sourceDoc(pageRot: number) {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([MEDIA, MEDIA]);
  page.setCropBox(ORIGIN.x, ORIGIN.y, CROP_W, CROP_H);
  if (pageRot) page.setRotation(degrees(pageRot));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('SECRET', { x: ORIGIN.x + 70, y: ORIGIN.y + CROP_H - 50, size: 14, font, color: rgb(0, 0, 0) });
  return doc;
}

/** The frame of the page the signer will actually see, measured from the real assembly. */
async function assembledFrame(pageRot: number): Promise<{ w: number; h: number; x0: number; y0: number }> {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const src = await sourceDoc(pageRot);
  const out = await PDFDocument.create();
  const docPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } as DocumentPage;
  const red = new RedactionElement(50, 20, 200, 50, 'p1') as unknown as PDFElement;
  await rasterizePageWithRedactions(
    src, docPage, [red], out, { rgb, StandardFonts, degrees },
    noWatermark, new InkLayer(), loudReporter,
  );
  const p = out.getPage(0);
  const mb = p.getMediaBox();
  return { w: p.getWidth(), h: p.getHeight(), x0: mb.x, y0: mb.y };
}

describe('WS4-E — the signer sees a different frame than the sign prefill computes', () => {
  it('at rotation 0 the assembled page drops the crop origin — the recorded bound, confirmed', async () => {
    const f = await assembledFrame(0);
    expect({ w: f.w, h: f.h }).toEqual({ w: CROP_W, h: CROP_H });
    // The origin is GONE: the page the /Rect is validated against starts at (0,0).
    expect({ x0: f.x0, y0: f.y0 }).toEqual({ x0: 0, y0: 0 });

    // What the prefill produces for a rect drawn at the top-left of the displayed page…
    const drawn = { x: 10, y: 10, width: 80, height: 20 };
    const prefill = displayRectToPageUserSpaceRect(drawn, [ORIGIN.x, ORIGIN.y, ORIGIN.x + CROP_W, ORIGIN.y + CROP_H], 0);
    // …versus what that page actually needs (origin-free, rotation already baked in).
    const needed = displayRectToUserSpaceRect(drawn, f.w, f.h, 0);
    expect(prefill.x - needed.x).toBe(ORIGIN.x);
    expect(prefill.y - needed.y).toBe(ORIGIN.y);
  });

  it('at /Rotate 90 the width and height SWAP too — so the bound is a rotation, not an offset', async () => {
    const f = await assembledFrame(90);
    // The rotation is baked into the pixels, so the assembled page is the SWAPPED crop box and
    // carries no /Rotate of its own. `_pageGeomForSign` reports the unswapped viewBox and lets the
    // caller apply totalRot — a mapping that cannot be corrected by translating an origin.
    expect({ w: f.w, h: f.h }).toEqual({ w: CROP_H, h: CROP_W });
    expect({ x0: f.x0, y0: f.y0 }).toEqual({ x0: 0, y0: 0 });

    const drawn = { x: 10, y: 10, width: 80, height: 20 };
    const prefill = displayRectToPageUserSpaceRect(drawn, [ORIGIN.x, ORIGIN.y, ORIGIN.x + CROP_W, ORIGIN.y + CROP_H], 90);
    const needed = displayRectToUserSpaceRect(drawn, f.w, f.h, 0);
    // Not a constant offset on either axis — the two mappings disagree in SHAPE, which is the
    // half the "off by the crop origin" wording misses.
    const dx = prefill.x - needed.x, dy = prefill.y - needed.y;
    expect(dx === ORIGIN.x && dy === ORIGIN.y).toBe(false);
  });
});
