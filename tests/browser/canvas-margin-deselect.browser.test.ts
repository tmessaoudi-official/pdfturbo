/**
 * Clicking the grey area AROUND the page must deselect — REAL mouse, real hit-testing.
 *
 * `.canvas-container` is `padding: 20px` + `overflow: auto` and `#pdfCanvas` is
 * `margin: 0 auto` (src/styles/editor.css), so whenever the page is narrower than the
 * viewport there is a grey band of the container's own background beside it. At
 * fit-to-width that band is only the 20px padding; every zoom-out step widens it (measured
 * on the running app: a 909px canvas in a 1200px container leaves 146px after five clicks,
 * and it keeps growing). Clicking that band left the selection untouched, while an
 * identical click on the page cleared it.
 *
 * WHY THIS NEEDS A REAL BROWSER, on top of the jsdom guard in
 * `tests/ui/binders/canvasClickRouting.test.ts`: that guard dispatches a synthetic click
 * whose target it chooses, so it asserts the predicate and the wiring but ASSUMES the
 * container is what a pointer in the gap actually hits. jsdom has no layout, so it cannot
 * see the gap exist, and cannot catch the failure mode where some overlay
 * (`.textLayer`, the annotation layer) is stretched to fill the container and swallows the
 * click before it ever reaches the background — which is exactly the shape of the bug this
 * gate already had once, one layer further in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  installCanvasClickRouting,
  isEmptyCanvasAreaClick,
} from '../../src/ui/binders/navigationBinder';
import type { PDFTurboApp } from '../../src/core/pdfTurboApp';

interface Harness {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLElement;
  handleCanvasClick: ReturnType<typeof vi.fn>;
}

/** Rebuild the real container/canvas geometry: 20px padding, auto-centred narrower canvas. */
function mount(canvasWidth: number): Harness {
  const container = document.createElement('div');
  container.id = 'canvasContainer';
  Object.assign(container.style, {
    position: 'relative', overflow: 'auto', padding: '20px',
    background: '#e9ecef', width: '800px', height: '400px',
  });

  const canvas = document.createElement('canvas');
  canvas.id = 'pdfCanvas';
  canvas.width = canvasWidth;
  canvas.height = 300;
  Object.assign(canvas.style, { display: 'block', margin: '0 auto' });

  // pdf.js's text layer is absolutely positioned OVER the canvas — never over the padding.
  const textLayer = document.createElement('div');
  textLayer.className = 'textLayer';
  Object.assign(textLayer.style, {
    position: 'absolute', top: '20px', left: `${(800 - canvasWidth) / 2 + 20}px`,
    width: `${canvasWidth}px`, height: '300px',
  });

  container.append(canvas, textLayer);
  document.body.appendChild(container);

  const handleCanvasClick = vi.fn();
  installCanvasClickRouting({ ui: { container, canvas }, handleCanvasClick } as unknown as PDFTurboApp);
  return { container, canvas, textLayer, handleCanvasClick };
}

let harness: Harness | null = null;
beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { harness = null; document.body.innerHTML = ''; });

describe('clicking the grey area around the page', () => {
  it('a real click in the wide zoom-out gap hits the container and routes', async () => {
    harness = mount(300); // 300px page in an 800px container → ~230px of grey each side
    const c = harness.container.getBoundingClientRect();
    const k = harness.canvas.getBoundingClientRect();
    const gapCentreX = (c.left + k.left) / 2;
    const y = k.top + 100;

    // The gap must physically exist, and the container must be what a pointer there hits.
    expect(k.left - c.left).toBeGreaterThan(100);
    expect(document.elementFromPoint(gapCentreX, y)).toBe(harness.container);

    await userEvent.click(harness.container, { position: { x: gapCentreX - c.left, y: y - c.top } });
    expect(harness.handleCanvasClick).toHaveBeenCalled();
  });

  it('a real click in the 20px fit-to-width gutter also routes', async () => {
    harness = mount(760); // 760px page in an 800px container → the bare 20px padding
    const c = harness.container.getBoundingClientRect();
    const k = harness.canvas.getBoundingClientRect();
    const gutterX = c.left + 10;
    const y = k.top + 100;

    expect(document.elementFromPoint(gutterX, y)).toBe(harness.container);
    await userEvent.click(harness.container, { position: { x: 10, y: y - c.top } });
    expect(harness.handleCanvasClick).toHaveBeenCalled();
  });

  it('the canvas and the text layer over it are NOT the grey area', () => {
    harness = mount(300);
    const k = harness.canvas.getBoundingClientRect();
    // A pointer over the page hits the text layer (it overlays the canvas), never the container.
    const hit = document.elementFromPoint(k.left + k.width / 2, k.top + 100);
    expect(hit).not.toBe(harness.container);
    expect(isEmptyCanvasAreaClick(hit, harness.container)).toBe(false);
  });
});
