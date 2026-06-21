/**
 * Task 11 — real-Chrome integration guard for the rich text toolbar (Slice 1).
 *
 * Approach:
 * - Visual pixel assertions (bg-color, opacity, line-spacing): reuse the
 *   renderOne + rasterize pattern from text-toolbar-bake.browser.test.ts and
 *   pdfElementRenderer.browser.test.ts.  We build TextElement objects with the
 *   new props and call renderElementToPdfLib → pdf.js rasterize → pixel sample.
 *   This is the same technique as Task 2; it exercises the full export bake path
 *   in a real Chrome without requiring a full PDFTurboApp mount.
 *
 * - Format-painter (copy→paste): create real TextElement instances, build a real
 *   FormattingService with a minimal mock context (all stubs, no DOM/canvas),
 *   and verify that copyTextStyle() + pasteTextStyle() propagates the full style
 *   bundle.  The FormattingService internal logic is 100% synchronous and DOM-free.
 *
 * - Color presets / recent colors: pure assertions — COLOR_PRESETS non-empty,
 *   pushRecentColor → getRecentColors round-trip.
 *
 * None of these tests require a full PDFTurboApp mount (the existing harness in
 * this repo does not expose one), which is the correct trade-off: visual features
 * are proven pixel-by-pixel via renderElementToPdfLib; behaviour logic is proven
 * via real objects (not mocks).
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, StandardFonts, degrees } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { renderElementToPdfLib, type PdfRenderCtx } from '../../src/export/pdfElementRenderer';
import type { PDFElement } from '../../src/elements/annotationElement';
import { TextElement } from '../../src/elements/textElement';
import { FormattingService, type IFormattingContext } from '../../src/core/formattingService';
import { HistoryManager } from '../../src/core/historyManager';
import { COLOR_PRESETS, getRecentColors, pushRecentColor } from '../../src/utils/recentColors';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

// ── helpers (same pattern as text-toolbar-bake.browser.test.ts) ──────────────

const W = 400;
const H = 400;
const SCALE = 2;

async function renderOne(element: PDFElement): Promise<Uint8Array> {
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

interface Img { data: Uint8ClampedArray; width: number; height: number; }

async function rasterize(bytes: Uint8Array): Promise<Img> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) throw new Error('no 2d context');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: c, viewport: vp }).promise;
  return c.getImageData(0, 0, canvas.width, canvas.height);
}

function px(img: Img, x: number, y: number): { r: number; g: number; b: number } {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
}

function meanDarkness(img: Img): number {
  let sum = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    sum += (255 - img.data[i]) + (255 - img.data[i + 1]) + (255 - img.data[i + 2]);
  }
  return sum / (img.data.length / 4 * 3 * 255);
}

function darkestRowY(img: Img, xLeft: number, xRight: number, yMin: number, yMax: number): number {
  let bestY = yMin;
  let bestDark = 0;
  for (let y = yMin; y <= yMax; y++) {
    let rowDark = 0;
    for (let x = xLeft; x <= xRight; x++) {
      const i = (y * img.width + x) * 4;
      rowDark += (255 - img.data[i]) + (255 - img.data[i + 1]) + (255 - img.data[i + 2]);
    }
    if (rowDark > bestDark) { bestDark = rowDark; bestY = y; }
  }
  return bestY;
}

const el = <T extends object>(o: T): PDFElement => o as unknown as PDFElement;

// ── pixel assertions: bg-color, opacity, line-spacing ────────────────────────

describe('rich text toolbar — export bake pixel assertions (Task 11)', () => {
  it('green background color reaches the exported PDF pixels', async () => {
    // Element at (50, 50), 240×60.
    // bg fill baked by renderElementToPdfLib → rasterize with real pdf.js.
    // tp(50, 110) → PDF rect at x=50, y=290, w=240, h=60.
    // canvas box: x∈[100,580], y∈[100,220]. Sample right-bottom glyph-free zone.
    const bytes = await renderOne(el({
      type: 'text', x: 50, y: 50, width: 240, height: 60,
      text: 'X', fontSize: 18,
      fontFamily: 'Arial', bold: false, italic: false, rotation: 0,
      color: '#000000', backgroundColor: '#00ff00',
    }));
    const img = await rasterize(bytes);
    // Right side of box, near bottom — glyph-free, should show green fill.
    const inside = px(img, 500, 210);
    expect(inside.g).toBeGreaterThan(150); // G high — green channel dominant
    expect(inside.r).toBeLessThan(150);    // R low
    expect(inside.b).toBeLessThan(150);    // B low
  });

  it('reduced opacity (0.3) produces less dark ink than fully opaque (1.0)', async () => {
    const opaqueBytes = await renderOne(el({
      type: 'text', x: 50, y: 150, width: 200, height: 40,
      text: 'O', fontSize: 36,
      fontFamily: 'Arial', bold: false, italic: false, rotation: 0,
      color: '#000000', opacity: 1,
    }));
    const fadedBytes = await renderOne(el({
      type: 'text', x: 50, y: 150, width: 200, height: 40,
      text: 'O', fontSize: 36,
      fontFamily: 'Arial', bold: false, italic: false, rotation: 0,
      color: '#000000', opacity: 0.3,
    }));
    const opaque = await rasterize(opaqueBytes);
    const faded = await rasterize(fadedBytes);
    expect(meanDarkness(faded)).toBeLessThan(meanDarkness(opaque));
  });

  it('larger lineHeight increases gap between two text lines in the baked PDF', async () => {
    // Same geometry as text-toolbar-bake.browser.test.ts Task 2 test — confirms
    // the feature is reachable via the element prop alone (no FormattingService needed).
    const tightBytes = await renderOne(el({
      type: 'text', x: 40, y: 40, width: 200, height: 180,
      text: 'a\nb', fontSize: 20,
      fontFamily: 'Arial', bold: false, italic: false, rotation: 0,
      color: '#000000', lineHeight: 1.0,
    }));
    const looseBytes = await renderOne(el({
      type: 'text', x: 40, y: 40, width: 200, height: 180,
      text: 'a\nb', fontSize: 20,
      fontFamily: 'Arial', bold: false, italic: false, rotation: 0,
      color: '#000000', lineHeight: 2.5,
    }));
    const tight = await rasterize(tightBytes);
    const loose = await rasterize(looseBytes);
    const tightY = darkestRowY(tight, 80, 200, 140, 250);
    const looseY = darkestRowY(loose, 80, 200, 140, 250);
    expect(looseY).toBeGreaterThan(tightY + 5);
  });
});

// ── format-painter: copy→apply across two real TextElement objects ────────────

/**
 * Build a minimal IFormattingContext mock backed by real TextElement/HistoryManager.
 * The selected element is kept as a mutable ref so the test can switch which element
 * is "selected" between copyTextStyle() and pasteTextStyle().
 */
function makeCtx(elements: PDFElement[]): {
  ctx: IFormattingContext;
  setSelected(el: PDFElement | null): void;
} {
  let _sel: PDFElement | null = null;
  const hm = new HistoryManager(50, () => {});
  // Minimal DOM stubs for the methods FormattingService calls
  const ui = {
    fillNoneBtn: { classList: { toggle: () => {} }, setAttribute: () => {} },
    fillColorInput: { style: {}, value: '#000000' },
  } as unknown as import('../../src/ui/uiController').AppDOMRefs;

  const ctx: IFormattingContext = {
    get selectedElement() { return _sel; },
    get historyManager() { return hm; },
    get elements() { return elements; },
    get ui() { return ui; },
    get mode() { return 'select' as import('../../src/types/tools').ToolMode; },
    rebuildElementLayer() {},
    autosave() {},
    syncFormattingUIDisplay() {},
  };
  return {
    ctx,
    setSelected(elem) { _sel = elem; },
  };
}

describe('format-painter — copy→apply via real TextElement + FormattingService (Task 11)', () => {
  it('propagates bold, color, and fontSize from source to destination element', () => {
    const src = new TextElement(10, 10, 'p1', {
      fontSize: 24, color: '#ff0000', bold: true, italic: false,
    });
    src.text = 'src';

    const dst = new TextElement(10, 60, 'p1', {
      fontSize: 14, color: '#000000', bold: false,
    });
    dst.text = 'dst';

    const elements: PDFElement[] = [src, dst];
    const { ctx, setSelected } = makeCtx(elements);
    const svc = new FormattingService(ctx);

    // Step 1: select src and copy its style
    setSelected(src);
    const copied = svc.copyTextStyle();
    expect(copied).toBe(true);
    expect(svc.painterArmed).toBe(true);

    // Step 2: select dst and paste (simulates the on-select hook in the real app)
    setSelected(dst);
    svc.pasteTextStyle();

    // The paste must clear the armed state
    expect(svc.painterArmed).toBe(false);

    // dst must now carry src's style
    expect(dst.bold).toBe(true);
    expect(dst.color).toBe('#ff0000');
    expect(dst.fontSize).toBe(24);
  });

  it('also copies lineHeight, opacity, and backgroundColor', () => {
    const src = new TextElement(0, 0, 'p1', { fontSize: 16, color: '#0000ff' });
    src.text = 'src';
    src.lineHeight = 2.0;
    src.opacity = 0.7;
    src.backgroundColor = '#ffee00';

    const dst = new TextElement(0, 40, 'p1', { fontSize: 12 });
    dst.text = 'dst';

    const elements: PDFElement[] = [src, dst];
    const { ctx, setSelected } = makeCtx(elements);
    const svc = new FormattingService(ctx);

    setSelected(src);
    svc.copyTextStyle();

    setSelected(dst);
    svc.pasteTextStyle();

    expect(dst.lineHeight).toBe(2.0);
    expect(dst.opacity).toBe(0.7);
    expect(dst.backgroundColor).toBe('#ffee00');
  });

  it('pasteTextStyle is a no-op when no style has been copied', () => {
    const dst = new TextElement(0, 0, 'p1', { fontSize: 14 });
    dst.text = 'dst';
    const elements: PDFElement[] = [dst];
    const { ctx, setSelected } = makeCtx(elements);
    const svc = new FormattingService(ctx);

    setSelected(dst);
    svc.pasteTextStyle(); // no prior copy — should not throw

    expect(dst.fontSize).toBe(14); // unchanged
    expect(svc.painterArmed).toBe(false);
  });

  it('cancelPainter disarms the painter without modifying any element', () => {
    const src = new TextElement(0, 0, 'p1', { fontSize: 22, bold: true });
    src.text = 'src';
    const dst = new TextElement(0, 40, 'p1', { fontSize: 12 });
    dst.text = 'dst';
    const elements: PDFElement[] = [src, dst];
    const { ctx, setSelected } = makeCtx(elements);
    const svc = new FormattingService(ctx);

    setSelected(src);
    svc.copyTextStyle();
    expect(svc.painterArmed).toBe(true);

    svc.cancelPainter();
    expect(svc.painterArmed).toBe(false);

    // A paste after cancel must not apply anything
    setSelected(dst);
    svc.pasteTextStyle();
    expect(dst.fontSize).toBe(12); // unchanged
  });
});

// ── color presets + recent-color round-trip ───────────────────────────────────

describe('color presets + recent colors (Task 11)', () => {
  it('COLOR_PRESETS is non-empty and contains well-formed hex values', () => {
    expect(COLOR_PRESETS.length).toBeGreaterThan(0);
    for (const c of COLOR_PRESETS) {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('pushRecentColor → getRecentColors round-trip preserves order and deduplicates', () => {
    pushRecentColor('#aabbcc');
    pushRecentColor('#112233');
    // Push the first one again — it should move to the front, not duplicate
    pushRecentColor('#aabbcc');

    const recent = getRecentColors();
    expect(recent[0]).toBe('#aabbcc');
    // '#112233' should still be present exactly once
    expect(recent.filter((c) => c === '#112233').length).toBe(1);
    expect(recent.filter((c) => c === '#aabbcc').length).toBe(1);
  });
});
