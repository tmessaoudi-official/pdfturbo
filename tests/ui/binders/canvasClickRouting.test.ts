/**
 * Clicking the page must deselect — even where pdf.js's text layer covers it.
 *
 * The click that deselects an annotation was bound to `<canvas id="pdfCanvas">`. In SELECT
 * mode `TextLayerManager.setPointerEvents(mode === 'select')` turns the text layer
 * interactive so the user can select and copy PDF text — and that layer is a SIBLING
 * overlay covering the whole page. Every click on empty page area therefore landed on
 * `.textLayer`, never reached the canvas, and `CanvasClickRouter`'s `selectElement(null)`
 * branch became dead code on any page with a text layer.
 *
 * Proven by single-variable experiment on the running app: with the layer interactive a
 * click on empty page area leaves the element selected; setting ONLY that layer's
 * `pointer-events` to `none` makes the identical click deselect. Nothing else changed.
 * It is also page-type-inconsistent — a page with no text layer deselects fine — which is
 * what marks it an accident rather than a design choice.
 *
 * The listener therefore moves to the container and is gated on the click having landed on
 * the page SURFACE. The gate is the point: `#exportPreviewOverlay` and the annotation
 * layer are also children of that container, and routing their clicks into
 * `handleCanvasClick` would deselect (and, in editText/fillBucket modes, run canvas-relative
 * coordinate maths) for clicks that are not page clicks at all.
 */
import { describe, it, expect, vi } from 'vitest';
import { installCanvasClickRouting, isPageSurfaceClick } from '../../../src/ui/binders/navigationBinder';
import type { PDFTurboApp } from '../../../src/core/pdfTurboApp';

interface Built {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLElement;
  textSpan: HTMLElement;
  previewOverlay: HTMLElement;
  element: HTMLElement;
  handleCanvasClick: ReturnType<typeof vi.fn>;
}

/** Rebuild the real #canvasContainer child set (see ElementLayerRenderer + TextLayerManager). */
function build(): Built {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.id = 'canvasContainer';

  const canvas = document.createElement('canvas');
  canvas.id = 'pdfCanvas';

  const previewOverlay = document.createElement('div');
  previewOverlay.className = 'export-preview-overlay';

  const textLayer = document.createElement('div');
  textLayer.className = 'textLayer';
  const textSpan = document.createElement('span');
  textLayer.appendChild(textSpan);

  const element = document.createElement('div');
  element.className = 'pdf-element text-element';

  container.append(canvas, previewOverlay, textLayer, element);
  document.body.appendChild(container);

  const handleCanvasClick = vi.fn();
  const app = {
    ui: { container, canvas },
    handleCanvasClick,
  } as unknown as PDFTurboApp;
  installCanvasClickRouting(app);

  return { container, canvas, textLayer, textSpan, previewOverlay, element, handleCanvasClick };
}

const click = (node: Element): void => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('isPageSurfaceClick — what counts as a click on the page', () => {
  it('the canvas itself is the page surface', () => {
    const { canvas } = build();
    expect(isPageSurfaceClick(canvas, canvas)).toBe(true);
  });

  it('the text layer and its per-glyph spans are the page surface', () => {
    const { canvas, textLayer, textSpan } = build();
    expect(isPageSurfaceClick(textLayer, canvas)).toBe(true);
    // pdf.js renders one span per glyph, so the real target is almost never the layer itself.
    expect(isPageSurfaceClick(textSpan, canvas)).toBe(true);
  });

  it('an annotation element is NOT the page surface', () => {
    const { canvas, element } = build();
    expect(isPageSurfaceClick(element, canvas)).toBe(false);
  });

  it('the export-preview overlay is NOT the page surface', () => {
    const { canvas, previewOverlay } = build();
    expect(isPageSurfaceClick(previewOverlay, canvas)).toBe(false);
  });

  it('a non-Element target is not the page surface', () => {
    const { canvas } = build();
    expect(isPageSurfaceClick(null, canvas)).toBe(false);
    expect(isPageSurfaceClick(document, canvas)).toBe(false);
  });
});

describe('installCanvasClickRouting — wiring', () => {
  it('routes a click on the text layer (the regression) to handleCanvasClick', () => {
    const { textSpan, handleCanvasClick } = build();
    click(textSpan);
    expect(handleCanvasClick).toHaveBeenCalledTimes(1);
  });

  it('still routes a plain canvas click', () => {
    const { canvas, handleCanvasClick } = build();
    click(canvas);
    expect(handleCanvasClick).toHaveBeenCalledTimes(1);
  });

  it('does NOT route a click inside the export-preview overlay', () => {
    const { previewOverlay, handleCanvasClick } = build();
    click(previewOverlay);
    expect(handleCanvasClick).not.toHaveBeenCalled();
  });

  it('does NOT route a click on an annotation element', () => {
    const { element, handleCanvasClick } = build();
    click(element);
    expect(handleCanvasClick).not.toHaveBeenCalled();
  });
});
