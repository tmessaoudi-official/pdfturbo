/**
 * Styled overlay TEXT must survive the RASTER export path — the one a redaction forces.
 *
 * Why this exists, and what it is NOT. CLAUDE.md claimed the raster path "ALSO honors
 * lineHeight/opacity/backgroundColor now (globalAlpha scoped inside the existing ctx.save()/
 * restore())" and was code-reviewed but not pixel-guarded. Read on 2026-07-31, that description is
 * wrong: `globalAlpha` appears nowhere in src/, and the only ctx.save()/restore() pair in
 * exportPipeline.ts is in the INK stroke rasterizer. There is exactly ONE text renderer
 * (pdfElementRenderer.renderText), and rasterizePageWithRedactions calls it through
 * buildPageOverlays BEFORE rasterizing. So the attributes are applied by code the vector tests
 * already pixel-guard (text-toolbar-bake, text-toolbar-slice2).
 *
 * What is genuinely unguarded is the COMPOSITION: on a redaction-bearing page the whole page is
 * re-rendered through pdf.js and re-embedded as a PNG, and nothing asserted that the styling
 * survived that extra round-trip. A regression there — alpha flattened on rasterize, the background
 * rect clipped away, the PNG embedded without its blend — would leave every existing test green.
 * That is the gap this closes, and it is narrower than the CLAUDE.md text suggested.
 *
 * Method: white page, one opaque BLACK redaction (which is what forces the raster branch) plus a
 * text element carrying backgroundColor + opacity placed well away from it. Render the output with
 * pdf.js and sample the background rect:
 *   - opacity 1   over white -> pure RED           (the rect survived rasterization at all)
 *   - opacity 0.5 over white -> PINK, not red      (alpha survived the round-trip)
 *   - no backgroundColor     -> still WHITE        (the samples above are not passing by accident)
 * jsdom has no canvas and cannot render, hence a real-browser pixel test.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { rasterizePageWithRedactions } from '../../src/export/exportPipeline';
import { RedactionElement } from '../../src/elements/redactionElement';
import { TextElement } from '../../src/elements/textElement';
import { InkLayer } from '../../src/infra/inkLayer';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W = 300;
const H = 400;
const SCALE = 2;

// Editor display space (top-left origin), well clear of the redaction so neither can mask the other.
const TEXT = { x: 40, y: 40, w: 200, h: 60 };
const REDACTION = { x: 40, y: 260, w: 200, h: 60 };
// A point comfortably inside the text element's background rect.
const PROBE = { x: TEXT.x + TEXT.w / 2, y: TEXT.y + TEXT.h / 2 };

const noopReporter: IErrorReporter = {
  info() {}, warn() {}, error() {}, silent() {},
} as unknown as IErrorReporter;

const noWatermark: WatermarkSettings = {
  enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10,
};

// NB sourcePageNum is 1-BASED, and the fields are sourcePdfId/sourcePageNum — getting either wrong
// fails deep inside pdf-lib with "Cannot read properties of undefined (reading 'node')".
function makePage(): DocumentPage {
  return { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } as DocumentPage;
}

async function whitePage(): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  return doc;
}

/** Run the REAL raster path with a redaction present, plus the given text element. */
async function rasterize(text: TextElement | null): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const docPage = makePage();
  const src = await whitePage();
  const target = await PDFDocument.create();
  // The redaction is what selects the raster branch — this is not decoration.
  const redaction = new RedactionElement(
    REDACTION.x, REDACTION.y, REDACTION.w, REDACTION.h, docPage.id, '#000000',
  ) as unknown as PDFElement;
  const elements: PDFElement[] = text
    ? [text as unknown as PDFElement, redaction]
    : [redaction];
  await rasterizePageWithRedactions(
    src, docPage, elements, target,
    { rgb, StandardFonts, degrees },
    noWatermark, new InkLayer(), noopReporter,
  );
  return target;
}

/** Average a 5×5 patch of the rendered output at a display-space point. */
async function sample(
  doc: import('@cantoo/pdf-lib').PDFDocument,
  at: { x: number; y: number },
): Promise<{ r: number; g: number; b: number }> {
  const bytes = await doc.save({ useObjectStreams: false });
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  await page.render({ canvas, viewport: vp }).promise;
  const img = ctx.getImageData(
    Math.round(at.x * SCALE) - 2, Math.round(at.y * SCALE) - 2, 5, 5,
  ).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < img.length; i += 4) { r += img[i]; g += img[i + 1]; b += img[i + 2]; }
  const n = img.length / 4;
  return { r: r / n, g: g / n, b: b / n };
}

function styled(opts: { backgroundColor?: string; opacity?: number }): TextElement {
  const te = new TextElement(TEXT.x, TEXT.y, 'p1', {
    width: TEXT.w, height: TEXT.h, fontSize: 12, color: '#000000', ...opts,
  });
  te.text = 'styled';
  return te;
}

describe('raster export path — styled text survives the rasterize round-trip', () => {
  it('CONTROL: with no backgroundColor the probe point stays white', async () => {
    const out = await rasterize(styled({}));
    const px = await sample(out, PROBE);
    expect(px.r).toBeGreaterThan(230);
    expect(px.g).toBeGreaterThan(230);
    expect(px.b).toBeGreaterThan(230);
  });

  it('an opaque backgroundColor survives rasterize + embedPng', async () => {
    const out = await rasterize(styled({ backgroundColor: '#ff0000', opacity: 1 }));
    const px = await sample(out, PROBE);
    // Pure red: the rect is there, and it is not blended away.
    expect(px.r).toBeGreaterThan(200);
    expect(px.g).toBeLessThan(60);
    expect(px.b).toBeLessThan(60);
  });

  it('opacity is preserved through the round-trip (red at 0.5 reads PINK, not red)', async () => {
    const out = await rasterize(styled({ backgroundColor: '#ff0000', opacity: 0.5 }));
    const px = await sample(out, PROBE);
    // Red over white at ~50%: red stays high while green/blue rise to mid — the discriminator
    // against a lost alpha, which would render the same pure red as the opaque case above.
    expect(px.r).toBeGreaterThan(200);
    expect(px.g).toBeGreaterThan(90);
    expect(px.g).toBeLessThan(190);
    expect(px.b).toBeGreaterThan(90);
    expect(px.b).toBeLessThan(190);
  });

  it('the redaction that forces this path still burns opaquely', async () => {
    // Guards the premise: if the redaction stopped rendering, the tests above would no longer be
    // exercising the raster branch at all and would silently become vector-path duplicates.
    const out = await rasterize(styled({ backgroundColor: '#ff0000', opacity: 1 }));
    const px = await sample(out, { x: REDACTION.x + REDACTION.w / 2, y: REDACTION.y + REDACTION.h / 2 });
    expect(px.r).toBeLessThan(40);
    expect(px.g).toBeLessThan(40);
    expect(px.b).toBeLessThan(40);
  });
});
