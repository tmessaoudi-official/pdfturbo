/**
 * OCR handler — pure word→element coordinate mapping.
 *
 * The full run() path (render page → tesseract → add elements) needs a real
 * browser (canvas + WASM worker) and is covered by the browser harness; here we
 * unit-test the deterministic bbox→TextElement mapping in jsdom.
 */
import { describe, it, expect } from 'vitest';
import { ocrWordToTextElement, ocrAssetPaths } from '../../src/handlers/ocrHandler';

describe('ocrWordToTextElement', () => {
  it('divides the image-px bbox by the render scale (no Y-flip)', () => {
    const el = ocrWordToTextElement(
      { text: 'Hello', bbox: { x0: 100, y0: 200, x1: 260, y1: 240 } },
      2,
      'page-1',
    );
    expect(el.x).toBe(50);   // 100 / 2
    expect(el.y).toBe(100);  // 200 / 2  (top-left origin preserved)
    expect(el.width).toBe(80);   // 160 / 2
    expect(el.height).toBe(20);  // 40 / 2
    expect(el.text).toBe('Hello');
    expect(el.pageId).toBe('page-1');
  });

  it('derives fontSize from glyph height (~0.8x)', () => {
    const el = ocrWordToTextElement(
      { text: 'X', bbox: { x0: 0, y0: 0, x1: 40, y1: 50 } },
      2,
      'p',
    );
    // height = 25 → fontSize round(25*0.8) = 20
    expect(el.height).toBe(25);
    expect(el.fontSize).toBe(20);
  });

  it('clamps tiny boxes to minimum width/height/fontSize', () => {
    const el = ocrWordToTextElement(
      { text: '.', bbox: { x0: 10, y0: 10, x1: 12, y1: 12 } },
      2,
      'p',
    );
    expect(el.width).toBe(8);
    expect(el.height).toBe(8);
    expect(el.fontSize).toBeGreaterThanOrEqual(6);
  });
});

describe('ocrAssetPaths — CSP-safe local tesseract assets', () => {
  it('builds same-origin paths under the app base URL', () => {
    const p = ocrAssetPaths('/pdfturbo/');
    expect(p.corePath).toBe('/pdfturbo/tesseract/core');
    expect(p.workerPath).toBe('/pdfturbo/tesseract/worker.min.js');
    expect(p.langPath).toBe('/pdfturbo/tesseract/lang');
  });

  it('normalizes a base URL without a trailing slash', () => {
    const p = ocrAssetPaths('/pdfturbo');
    expect(p.corePath).toBe('/pdfturbo/tesseract/core');
    expect(p.workerPath).toBe('/pdfturbo/tesseract/worker.min.js');
    expect(p.langPath).toBe('/pdfturbo/tesseract/lang');
  });

  it('works at root base "/"', () => {
    const p = ocrAssetPaths('/');
    expect(p.corePath).toBe('/tesseract/core');
    expect(p.workerPath).toBe('/tesseract/worker.min.js');
    expect(p.langPath).toBe('/tesseract/lang');
  });

  // The whole point of the fix: never hand tesseract a remote/CDN path (the
  // production CSP `connect-src 'self'` blocks those → broken OCR). Guard it.
  it('never produces a remote/CDN path', () => {
    for (const base of ['/pdfturbo/', '/', '/app/sub/']) {
      const all = Object.values(ocrAssetPaths(base)).join(' ');
      expect(all).not.toMatch(/https?:|cdn|jsdelivr|unpkg|tessdata\.projectnaptha/i);
      expect(all.startsWith(base.endsWith('/') ? base : `${base}/`)).toBe(true);
    }
  });
});
