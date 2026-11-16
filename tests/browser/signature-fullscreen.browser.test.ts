/**
 * The ✍ dialog's full screen in REAL Chrome with the app's CSS (phone-signature-pad row 11, PC half). What jsdom cannot
 * show: the layout (the pad fills the room, nothing leaves the viewport at 1280 or 414 px, the hidden blocks are not
 * rendered), that the DRAWN box equals the logical size (overlay.css caps #signatureCanvas at 500 px — left on, every
 * stroke would land off the pointer), the stroke width in pixels before and after a stay, and Tab with the real keyboard
 * under the real focus trap. The browser Fullscreen API is faked off here (the CSS fill, the base): its logic is
 * jsdom's (tests/utils/fullscreenSession.test.ts), and a real grant needs a user gesture this harness does not promise.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import indexHtml from '../../index.html?raw';
import '../../src/styles/index.css';
import { bindSignatureFullscreen, type SignatureFullscreen } from '../../src/ui/signatureFullscreen';
import { bindSignatureInkBoxes } from '../../src/ui/signatureInkBoxes';
import { SignaturePad } from '../../src/utils/signaturePad';
import { trapFocus } from '../../src/utils/focusTrap';

const cleanups: Array<() => void> = [];
afterEach(async () => {
  cleanups.splice(0).forEach((f) => f());
  document.body.replaceChildren();
  await page.viewport(414, 896);
});

async function dialog(w: number, h: number) {
  await page.viewport(w, h);
  expect([innerWidth, innerHeight]).toEqual([w, h]); // the viewport took: a silent failure would test nothing
  const parsed = new DOMParser().parseFromString(indexHtml, 'text/html');
  const modal = parsed.getElementById('signatureModal');
  const notice = parsed.getElementById('storageBanner');
  if (!modal || !notice) throw new Error('#signatureModal or #storageBanner missing from index.html');
  document.body.append(document.importNode(modal, true));
  // The first-visit storage notice, shown as main.ts shows it (display cleared): fixed at the bottom at z-index 9000,
  // it covered the full-screen action row (measured in the real app 2026-11-16: Save unclickable).
  const shownNotice = document.importNode(notice, true);
  shownNotice.style.display = '';
  document.body.append(shownNotice);
  const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
  const root = $('signatureModal');
  root.classList.add('active');
  const canvas = $<HTMLCanvasElement>('signatureCanvas');
  canvas.width = canvas.offsetWidth || 500; // what openModal does
  canvas.height = Math.round(canvas.width * 0.4);
  canvas.setPointerCapture = () => {}; // synthetic pointers have no active id
  const pad = new SignaturePad(canvas);
  const content = root.querySelector('.signature-content') as HTMLElement;
  const full: SignatureFullscreen = bindSignatureFullscreen({
    modal: root, box: $('sigCanvasBox'), canvas, pad,
    enterBtn: $<HTMLButtonElement>('sigFullBtn'), exitBtn: $<HTMLButtonElement>('sigExitFullBtn'),
    hideOnFull: () => [$('sigModalTitle'), root.querySelector('.signature-settings') as HTMLElement, $('sigSources'), $('cancelSignature')],
    closePhonePanel: () => {},
    fullscreen: { enabled: () => false, request: async () => {}, exit: async () => {}, active: () => false, lockLandscape: async () => {}, unlock: () => {} },
  });
  const width = $<HTMLInputElement>('sigLineWidth');
  bindSignatureInkBoxes(pad, width, $<HTMLInputElement>('sigColor'), () => full.widthScale());
  cleanups.push(trapFocus(content, undefined, false), () => full.leave());
  const stroke = () => {
    const r = canvas.getBoundingClientRect();
    const fire = (type: string, x: number) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 5, pointerType: 'mouse', buttons: 1, clientX: r.left + r.width * x, clientY: r.top + r.height / 2, bubbles: true }));
    fire('pointerdown', 0.2);
    for (let i = 5; i <= 16; i++) fire('pointermove', i / 20); // integer steps: 0.25 + 0.05·11 overshoots 0.8
    fire('pointerup', 0.8);
  };
  return { $, root, canvas, pad, full, width, stroke };
}

/** Thickness: the sum of alpha / 255 down the column at x = width / 2 (dpr 1: buffer px = CSS px). */
function thickness(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const col = ctx.getImageData(Math.floor(canvas.width / 2), 0, 1, canvas.height).data;
  let sum = 0;
  for (let y = 0; y < canvas.height; y++) sum += col[y * 4 + 3] / 255;
  return sum;
}

function inViewport(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
}

describe('the ✍ dialog full screen — layout in real Chrome (row 11 PC half)', () => {
  for (const [w, h] of [[1280, 800], [414, 860]] as const) {
    it(`${w}x${h}: the pad fills the room at its logical size; only Clear, Exit and Save show, all inside the viewport`, async () => {
      const d = await dialog(w, h);
      const normal = d.canvas.width;
      await userEvent.click(d.$('sigFullBtn'));
      expect(d.full.isFull()).toBe(true);
      const r = d.canvas.getBoundingClientRect();
      const border = d.canvas.offsetWidth - d.canvas.clientWidth;
      expect(Math.abs(r.width - border - d.canvas.width)).toBeLessThan(0.5); // drawn box = logical size: no 500 px cap
      expect(d.canvas.width).toBeGreaterThan(normal);
      expect(d.canvas.height).toBe(Math.round(d.canvas.width * 0.4));
      expect(inViewport(d.canvas)).toBe(true);
      for (const id of ['clearSignature', 'sigExitFullBtn', 'saveSignature']) {
        expect(inViewport(d.$(id)), id).toBe(true);
        // On top, not only inside the viewport: a pointer at its centre reaches it (the storage notice is shown).
        const b = d.$(id).getBoundingClientRect();
        expect(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('button')?.id, id).toBe(id);
      }
      for (const id of ['sigModalTitle', 'sigSources', 'cancelSignature', 'sigFullBtn']) expect(d.$(id).checkVisibility(), id).toBe(false);
      expect((d.root.querySelector('.signature-settings') as HTMLElement).checkVisibility()).toBe(false);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
      const res = await axe.run(document, { resultTypes: ['violations'] });
      expect(res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id)).toEqual([]);
    });
  }
});

describe('the ✍ dialog full screen — drawing and the keyboard in real Chrome (row 11 PC half)', () => {
  it('a stroke drawn full at box width 4 is 4·k px; back at the normal size it is 4 px, where the pointer put it', async () => {
    const d = await dialog(1280, 800);
    d.width.value = '4';
    d.width.dispatchEvent(new Event('change'));
    await userEvent.click(d.$('sigFullBtn'));
    const k = d.full.widthScale();
    expect(k).toBeGreaterThan(1.5);
    d.stroke();
    expect(Math.abs(thickness(d.canvas) - 4 * k)).toBeLessThan(0.6);
    await userEvent.click(d.$('sigExitFullBtn'));
    expect(Math.abs(thickness(d.canvas) - 4)).toBeLessThan(0.6);
    const xs = d.pad.getStrokes()[0].map((p) => p.x / d.canvas.width);
    expect(Math.abs(xs[0] - 0.2)).toBeLessThan(0.02); // the stroke still spans 20 %–80 % of the pad
    expect(Math.abs(xs[xs.length - 1] - 0.8)).toBeLessThan(0.02);
  });

  it('Tab and Shift+Tab with the real keyboard stay among Clear, Exit and Save', async () => {
    const d = await dialog(1280, 800);
    await userEvent.click(d.$('sigFullBtn'));
    expect(document.activeElement).toBe(d.$('sigExitFullBtn'));
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await userEvent.keyboard('{Tab}');
      seen.push((document.activeElement as HTMLElement).id);
    }
    expect(seen).toEqual(['saveSignature', 'clearSignature', 'sigExitFullBtn', 'saveSignature']);
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(d.$('sigExitFullBtn'));
    d.$('clearSignature').focus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(d.$('saveSignature')); // wraps inside the dialog, never out of it
  });
});
