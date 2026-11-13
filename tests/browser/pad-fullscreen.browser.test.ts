/**
 * The phone pad's full screen in REAL Chrome with the real pad.css (plan row 11, phone half; rulings 2026-11-12 19:09 /
 * 23:09 / 23:15) — what jsdom cannot show: the CSS hides the title, hint and ink controls; the measured drawing box sizes
 * the pad with no 600 px cap; nothing leaves the viewport, portrait or landscape; the QR after a landscape Done is
 * wholly on screen; axe on the full view. The runner's iframe ALLOWS fullscreen (pinned): a real ⛶ click takes the
 * default `browserFullscreen` path into element fullscreen, and the iframe keeps its 800 × 360 size there. It also MEASURES the two rejections behind padPage.ts's `.catch` on the
 * fullscreen request (a request without a user gesture, and `screen.orientation.lock` on a desktop).
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { drawQr } from '../../src/utils/qrCanvas';
import { PTSIG_LIMITS } from '../../src/utils/signatureStrokes';
import { mountPadPage, type PadPageHandle } from '../../src/pad/padPage';
import '../../src/styles/pad.css';

let mounted: PadPageHandle | null = null;
let size0: [number, number] = [0, 0];
beforeAll(() => {
  size0 = [window.innerWidth, window.innerHeight];
  prepareZXingModule({ overrides: { locateFile: (p: string, prefix: string) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) } });
});
async function readQr(canvas: HTMLCanvasElement): Promise<string[]> {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const r = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
  return r.filter((b) => b.isValid).map((b) => b.text);
}
const FULL_FRAME = ' ' + 'PT0Z$%*+-./:9'.repeat(70).slice(0, PTSIG_LIMITS.maxFrameChars - 2) + ' ';
afterEach(async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  mounted?.destroy();
  mounted = null;
  document.body.replaceChildren();
  await page.viewport(size0[0], size0[1]);
});

function mountPage() {
  const root = document.createElement('main');
  document.body.appendChild(root);
  mounted = mountPadPage(root, { dpr: () => window.devicePixelRatio, t: (k) => k, hash: () => '', setLanguage: () => {} });
  const q = <E extends HTMLElement = HTMLElement>(name: string) => root.querySelector(`[data-pad="${name}"]`) as E;
  return { root, q, page: mounted };
}
const rect = (e: Element) => e.getBoundingClientRect();
const onScreen = (e: Element) => {
  const r = rect(e);
  return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5;
};
async function viewportTo(w: number, h: number) {
  await page.viewport(w, h);
  expect([window.innerWidth, window.innerHeight]).toEqual([w, h]); // vacuous if the resize did not take
}

describe('the measured rejections behind the .catch (evidence, not a test of padPage)', () => {
  it('prints fullscreenEnabled; a request with no user gesture rejects; the landscape lock rejects on a desktop', async () => {
    // eslint-disable-next-line no-console
    console.log(`[pad-fullscreen] document.fullscreenEnabled = ${document.fullscreenEnabled}`);
    const req = await document.documentElement.requestFullscreen().then(() => 'resolved', (e: Error) => `${e.name}: ${e.message}`);
    // eslint-disable-next-line no-console
    console.log(`[pad-fullscreen] requestFullscreen() without a gesture → ${req}`);
    expect(req).toMatch(/^TypeError: Permissions check failed/); // Chrome: no transient user activation
    const lockable = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    expect(typeof lockable.lock).toBe('function');
    const lock = await (lockable.lock as (o: string) => Promise<void>).call(screen.orientation, 'landscape').then(() => 'resolved', (e: Error) => `${e.name}: ${e.message}`);
    // eslint-disable-next-line no-console
    console.log(`[pad-fullscreen] screen.orientation.lock('landscape') → ${lock}`);
    expect(lock).toMatch(/^NotSupportedError/); // a desktop has no orientation to lock
  });
});

describe('full screen with the real CSS', () => {
  it('portrait (414 px wide): title, hint and ink controls hidden; the pad, the rotate hint and the three buttons on screen', async () => {
    await viewportTo(414, 800);
    const { root, q } = mountPage();
    await userEvent.click(q('fullscreen'));
    expect(root.classList.contains('pad-full')).toBe(true);
    // WHICH path this file runs, measured: the runner allows fullscreen, so the default wiring enters it.
    expect(document.fullscreenEnabled).toBe(true);
    expect(document.fullscreenElement?.tagName ?? null).toBe('HTML'); // the default wiring really went fullscreen here
    for (const sel of ['h1', '.pad-hint', '.pad-ink']) expect((root.querySelector(sel) as HTMLElement).checkVisibility(), sel).toBe(false);
    for (const name of ['canvas', 'rotateHint', 'clear', 'exitFullscreen', 'done']) {
      expect(q(name).checkVisibility(), name).toBe(true);
      expect(onScreen(q(name)), name).toBe(true);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const box = rect(q('box'));
    expect(rect(q('canvas')).width).toBeCloseTo(Math.floor(Math.min(box.width, box.height / 0.4)), 0);
  });

  it('landscape (800 × 360), entered from a scrolled page: the pad grows past 600 px inside its box, and Exit is on screen', async () => {
    await viewportTo(800, 360);
    const { root, q } = mountPage();
    window.scrollTo(0, 120);
    expect(window.scrollY).toBeGreaterThan(0); // the normal page is taller than a landscape phone
    await userEvent.click(q('fullscreen'));
    expect(document.fullscreenElement?.tagName ?? null).toBe('HTML');
    expect([window.innerWidth, window.innerHeight]).toEqual([800, 360]); // the iframe's fullscreen keeps its size: the numbers below are at 800 × 360
    expect(window.scrollY).toBe(0);
    expect(root.classList.contains('pad-full')).toBe(true);
    expect(q('rotateHint').checkVisibility()).toBe(false);
    const c = rect(q('canvas'));
    const b = rect(q('box'));
    expect(c.width).toBeGreaterThan(600);
    expect(c.left).toBeGreaterThanOrEqual(b.left - 0.5);
    expect(c.right).toBeLessThanOrEqual(b.right + 0.5);
    expect(c.top).toBeGreaterThanOrEqual(b.top - 0.5);
    expect(c.bottom).toBeLessThanOrEqual(b.bottom + 0.5);
    for (const name of ['canvas', 'clear', 'exitFullscreen', 'done']) expect(onScreen(q(name)), name).toBe(true);
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
  });

  it('a real stroke drawn in landscape full screen, then Done: the WHOLE QR is on screen', async () => {
    await viewportTo(800, 360);
    const { root, q } = mountPage();
    await userEvent.click(q('fullscreen'));
    const canvas = q<HTMLCanvasElement>('canvas');
    await userEvent.dragAndDrop(canvas, canvas, { sourcePosition: { x: 40, y: 60 }, targetPosition: { x: 600, y: 200 } });
    await userEvent.click(q('done'));
    expect(root.classList.contains('pad-full')).toBe(false);
    const qr = q('qr');
    expect(qr.checkVisibility()).toBe(true);
    const r = rect(qr);
    expect([r.top >= 0, r.bottom <= window.innerHeight + 0.5], `QR ${r.top}–${r.bottom} in a ${window.innerHeight} px viewport`).toEqual([true, true]);
    expect((await readQr(qr as HTMLCanvasElement)).length).toBe(1); // the signature's own QR reads back
    // The worst case at that capped side: a FULL 909-character frame, at dpr 1, still reads.
    const worst = document.createElement('canvas');
    drawQr(worst, FULL_FRAME, r.width, 1);
    expect(await readQr(worst)).toEqual([FULL_FRAME]);
  });

  it('after a landscape Done, a HEIGHT-only shrink (the browser bars coming back) re-fits the QR: still whole on screen, still reads', async () => {
    await viewportTo(800, 360);
    const { q } = mountPage();
    await userEvent.click(q('fullscreen'));
    const canvas = q<HTMLCanvasElement>('canvas');
    await userEvent.dragAndDrop(canvas, canvas, { sourcePosition: { x: 40, y: 60 }, targetPosition: { x: 600, y: 200 } });
    await userEvent.click(q('done'));
    const qr = q<HTMLCanvasElement>('qr');
    const before = rect(qr).width;
    await viewportTo(800, 300); // width unchanged: the pad's width-keyed layout alone would not redraw the QR
    await new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); });
    const r = rect(qr);
    expect(r.width).toBeLessThan(before); // it was re-fitted, not left at the 360 px side
    expect([r.top >= 0, r.bottom <= window.innerHeight + 0.5], `QR ${r.top}–${r.bottom} in a ${window.innerHeight} px viewport`).toEqual([true, true]);
    expect((await readQr(qr)).length).toBe(1);
  });

  it('axe on the full view (WCAG 2.1 A/AA): zero critical and zero serious violations', async () => {
    await viewportTo(800, 360);
    const { q } = mountPage();
    await userEvent.click(q('fullscreen'));
    const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    const blocking = res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking.flatMap((v) => v.nodes.map((n) => `${v.impact}:${v.id}:${n.target.join(' ')}`))).toEqual([]);
  });
});
