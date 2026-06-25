/**
 * Live watermark overlay (2026-06-25) — the watermark was export-only; a user who enabled it
 * saw nothing on the editing canvas ("watermark not working"). The fix draws it onto a
 * `#watermarkOverlay` canvas over the page during `renderCurrentPage` (lifecycle guarded by the
 * jsdom test tests/core/pageRenderPipeline.test.ts). jsdom has no canvas backend, so this
 * real-Chrome test guards the PIXEL output of the shared painter (`WatermarkPanel.drawOnCanvas`):
 * an enabled red watermark must paint visible reddish ink; a disabled one must paint nothing.
 */
import { describe, it, expect } from 'vitest';
import { WatermarkPanel, type IWatermarkContext } from '../../src/ui/watermarkPanel';
import type { WatermarkSettings } from '../../src/core/documentModel';

function makePanel(): WatermarkPanel {
  // drawOnCanvas only reads zoomScale (and only when scale is omitted — we pass it explicitly),
  // so a minimal stub context is enough to exercise the painter.
  const ctx = { zoomScale: 1 } as unknown as IWatermarkContext;
  return new WatermarkPanel(ctx);
}

function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const c = canvas.getContext('2d');
  if (!c) throw new Error('no 2d context');
  return c;
}

function countReddish(ctx: CanvasRenderingContext2D, w: number, h: number): { nonTransparent: number; reddish: number } {
  const d = ctx.getImageData(0, 0, w, h).data;
  let nonTransparent = 0, reddish = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] !== 0) {
      nonTransparent++;
      if (d[i] > 120 && d[i + 1] < 100 && d[i + 2] < 100) reddish++;
    }
  }
  return { nonTransparent, reddish };
}

const W = 240, H = 320;

describe('live watermark painter (drawOnCanvas)', () => {
  it('paints visible reddish watermark ink when enabled', () => {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = ctx2d(canvas);
    const wm: WatermarkSettings = { enabled: true, text: 'WATERMARK', color: '#ff0000', fontSize: 40, opacity: 0.6, angle: -45, density: 3 };
    makePanel().drawOnCanvas(ctx, W, H, wm, 1);
    const { nonTransparent, reddish } = countReddish(ctx, W, H);
    expect(nonTransparent).toBeGreaterThan(0);
    expect(reddish).toBeGreaterThan(0);
  });

  it('paints nothing when the watermark is disabled', () => {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = ctx2d(canvas);
    const wm: WatermarkSettings = { enabled: false, text: 'WATERMARK', color: '#ff0000', fontSize: 40, opacity: 0.6, angle: -45, density: 3 };
    makePanel().drawOnCanvas(ctx, W, H, wm, 1);
    expect(countReddish(ctx, W, H).nonTransparent).toBe(0);
  });

  it('paints nothing when the text is empty', () => {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = ctx2d(canvas);
    const wm: WatermarkSettings = { enabled: true, text: '', color: '#ff0000', fontSize: 40, opacity: 0.6, angle: -45, density: 3 };
    makePanel().drawOnCanvas(ctx, W, H, wm, 1);
    expect(countReddish(ctx, W, H).nonTransparent).toBe(0);
  });
});
