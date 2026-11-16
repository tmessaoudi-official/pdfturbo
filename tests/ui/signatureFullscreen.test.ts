// @vitest-environment jsdom
// The ✍ dialog's full screen (phone-signature-pad row 11, PC half; rulings 2026-11-12 19:09 and 2026-11-16 11:08).
// ⛶ turns the dialog into a big pad — only Clear, Exit full screen and Save stay — and everything on the pad survives
// the stay: the strokes come back to the same place and width, a scan keeps its exact width, an imported image is
// kept, the phone link's `cw` and the saved size are those of the normal pad. Real SignaturePad, the real dialog markup
// from index.html, a stubbed box size (jsdom has no layout) and a fake Fullscreen API.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { bindSignatureFullscreen } from '../../src/ui/signatureFullscreen';
import { bindSignatureInkBoxes, inkBoxes } from '../../src/ui/signatureInkBoxes';
import { SignaturePad } from '../../src/utils/signaturePad';
import type { FullscreenApi } from '../../src/utils/fullscreenSession';

afterEach(() => { document.body.replaceChildren(); });

function fakeFs(enabled: boolean) {
  let active = false;
  const fs = {
    enabled: () => enabled,
    request: vi.fn(() => { active = true; return Promise.resolve(); }),
    exit: vi.fn(() => { active = false; return Promise.resolve(); }),
    active: () => active,
    lockLandscape: vi.fn(() => Promise.reject(new DOMException('desktop', 'NotSupportedError'))),
    unlock: vi.fn(),
  } satisfies FullscreenApi;
  return { fs, browserLeaves: () => { active = false; document.dispatchEvent(new Event('fullscreenchange')); } };
}

function setup(opts: { sources?: boolean; fsEnabled?: boolean; width?: string } = {}) {
  const html = readFileSync('index.html', 'utf8');
  const modal = new DOMParser().parseFromString(html, 'text/html').getElementById('signatureModal');
  if (!modal) throw new Error('#signatureModal missing');
  document.body.append(document.importNode(modal, true));
  if (opts.sources === false) document.getElementById('sigSources')?.remove(); // the phonePad flag off
  const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
  const canvas = $<HTMLCanvasElement>('signatureCanvas');
  canvas.width = 500; // what openModal sets (dpr 1)
  canvas.height = 200;
  const pad = new SignaturePad(canvas);
  const widthBox = $<HTMLInputElement>('sigLineWidth');
  if (opts.width) widthBox.value = opts.width;
  const box = $('sigCanvasBox');
  const size = { w: 1200, h: 600 };
  Object.defineProperty(box, 'clientWidth', { get: () => size.w, configurable: true });
  Object.defineProperty(box, 'clientHeight', { get: () => size.h, configurable: true });
  const phoneBtn = document.getElementById('sigPhoneBtn');
  const closePhonePanel = vi.fn();
  const { fs, browserLeaves } = fakeFs(opts.fsEnabled ?? false);
  const full = bindSignatureFullscreen({
    modal: $('signatureModal'), box, canvas, pad,
    enterBtn: $<HTMLButtonElement>('sigFullBtn'), exitBtn: $<HTMLButtonElement>('sigExitFullBtn'),
    hideOnFull: () => [$('sigModalTitle'), document.querySelector('#signatureModal .signature-settings') as HTMLElement,
      document.getElementById('sigSources'), $('cancelSignature')].filter((e): e is HTMLElement => e !== null),
    closePhonePanel, fullscreen: fs,
  });
  bindSignatureInkBoxes(pad, widthBox, $<HTMLInputElement>('sigColor'), () => full.widthScale());
  const enter = () => $<HTMLButtonElement>('sigFullBtn').click();
  const exit = () => $<HTMLButtonElement>('sigExitFullBtn').click();
  const drawn = () => {
    pad.replay({ gridWidth: 100, gridHeight: 40, color: '#000000', lineWidth: 1, strokes: [[{ x: 10, y: 10 }, { x: 90, y: 30 }]] });
  };
  return { $, canvas, pad, box, size, full, enter, exit, fs, browserLeaves, closePhonePanel, phoneBtn, widthBox, drawn };
}

describe('the ✍ dialog full screen — entering and leaving (row 11 PC half)', () => {
  it('⛶ marks the dialog full, makes the h2, settings, sources and Cancel inert, swaps the buttons and closes the phone panel', () => {
    const s = setup();
    expect([s.$('sigExitFullBtn').hidden, s.$('sigFullBtn').hidden]).toEqual([true, false]); // the control
    s.enter();
    expect(s.$('signatureModal').classList.contains('sig-full')).toBe(true);
    for (const id of ['sigModalTitle', 'sigSources', 'cancelSignature']) expect(s.$(id).hasAttribute('inert'), id).toBe(true);
    expect((document.querySelector('#signatureModal .signature-settings') as HTMLElement).hasAttribute('inert')).toBe(true);
    for (const id of ['clearSignature', 'saveSignature', 'sigExitFullBtn']) expect(s.$(id).closest('[inert]'), id).toBeNull();
    expect([s.$('sigExitFullBtn').hidden, s.$('sigFullBtn').hidden]).toEqual([false, true]);
    expect(document.activeElement).toBe(s.$('sigExitFullBtn'));
    expect(s.closePhonePanel).toHaveBeenCalledTimes(1);
    expect(s.full.isFull()).toBe(true);
  });

  it('the pad fills the box at the 0.4 shape, at dpr 1, and the width scale follows: 1200x600 → 1200x480, k 2.4', () => {
    const s = setup();
    s.enter();
    expect([s.canvas.width, s.canvas.height]).toEqual([1200, 480]);
    expect(s.full.widthScale()).toBeCloseTo(2.4, 10);
    expect(s.pad.lineWidth).toBeCloseTo(2 * 2.4, 10);
  });

  it('a resize while full re-fits, and k is the CURRENT ratio, never compounded', () => {
    const s = setup();
    s.enter();
    s.size.w = 1000;
    s.size.h = 300; // height-bound: 750x300
    window.dispatchEvent(new Event('resize'));
    expect([s.canvas.width, s.canvas.height]).toEqual([750, 300]);
    expect(s.full.widthScale()).toBeCloseTo(1.5, 10);
    expect(s.pad.lineWidth).toBeCloseTo(3, 10);
  });

  it('Exit restores the normal pad: 500x200, no inline px, width 2, k 1, nothing inert, focus on ⛶', () => {
    const s = setup();
    s.enter();
    s.exit();
    expect([s.canvas.width, s.canvas.height, s.canvas.style.width, s.canvas.style.height]).toEqual([500, 200, '', '']);
    expect(s.pad.lineWidth).toBeCloseTo(2, 10);
    expect(s.full.widthScale()).toBe(1);
    expect(s.$('signatureModal').classList.contains('sig-full')).toBe(false);
    expect(document.querySelector('#signatureModal [inert]')).toBeNull();
    expect(document.activeElement).toBe(s.$('sigFullBtn'));
    window.dispatchEvent(new Event('resize')); // no longer listening
    expect(s.canvas.width).toBe(500);
  });

  it('leave() when not full changes nothing (the onClosed / before-save backstop on an ordinary close)', () => {
    const s = setup();
    const setSize = vi.spyOn(s.pad, 'setSize');
    s.full.leave();
    expect(setSize).not.toHaveBeenCalled();
  });

  it('works with the phonePad flag off (no sources block)', () => {
    const s = setup({ sources: false });
    s.enter();
    expect(s.canvas.width).toBe(1200);
    s.exit();
    expect(s.canvas.width).toBe(500);
  });
});

describe('the ✍ dialog full screen — what survives the stay (row 11 PC half)', () => {
  it('strokes come back to the same place; the phone link cw and the saved size are the normal pad\'s', () => {
    const s = setup();
    s.drawn();
    const before = s.pad.getStrokes();
    const cw = inkBoxes(s.widthBox, s.$<HTMLInputElement>('sigColor'), s.canvas).get().cw;
    s.enter();
    s.size.w = 900; // a resize mid-stay
    window.dispatchEvent(new Event('resize'));
    s.exit();
    const after = s.pad.getStrokes();
    after.flat().forEach((p, i) => {
      expect(p.x).toBeCloseTo(before.flat()[i].x, 6);
      expect(p.y).toBeCloseTo(before.flat()[i].y, 6);
    });
    expect(inkBoxes(s.widthBox, s.$<HTMLInputElement>('sigColor'), s.canvas).get().cw).toBe(cw);
    expect([s.canvas.width, s.canvas.height]).toEqual([500, 200]); // what Save's signatureNatural reads
  });

  it('a scan keeps its exact width ratio across the stay (3.4 stays 3.4, the box still 3)', () => {
    const s = setup({ width: '3' });
    s.pad.replay({ gridWidth: 500, gridHeight: 200, color: '#000000', lineWidth: 3.4, strokes: [[{ x: 0, y: 0 }, { x: 400, y: 100 }]] });
    expect(s.pad.lineWidth).toBeCloseTo(3.4, 10);
    s.enter();
    expect(s.pad.lineWidth).toBeCloseTo(3.4 * 2.4, 10);
    s.exit();
    expect(s.pad.lineWidth).toBeCloseTo(3.4, 10);
    expect(s.widthBox.value).toBe('3');
  });

  it('Clear in full screen resets the pad to the box width × k, and back to the box width on exit', () => {
    const s = setup({ width: '3' });
    s.pad.replay({ gridWidth: 500, gridHeight: 200, color: '#000000', lineWidth: 30, strokes: [[{ x: 0, y: 0 }, { x: 400, y: 100 }]] });
    s.enter();
    s.pad.clear(); // what the dialog's Clear runs (modalBinder)
    expect(s.pad.lineWidth).toBeCloseTo(3 * 2.4, 10);
    s.exit();
    expect(s.pad.lineWidth).toBeCloseTo(3, 10);
  });

  it('an imported image is kept: repainted at the full size, and still there after Exit', () => {
    const s = setup();
    const img = document.createElement('canvas');
    img.width = 10;
    img.height = 4;
    const ictx = img.getContext('2d') as CanvasRenderingContext2D;
    ictx.fillStyle = '#000';
    ictx.fillRect(0, 0, 10, 4);
    s.pad.drawImage(img);
    const drawImage = vi.spyOn(s.canvas.getContext('2d') as CanvasRenderingContext2D, 'drawImage');
    s.enter();
    expect(drawImage).toHaveBeenCalledWith(img, 0, 0, 1200, 480);
    s.exit();
    expect(s.pad.isEmpty()).toBe(false);
  });
});

describe('the ✍ dialog full screen — the browser Fullscreen API (row 11 PC half)', () => {
  it('asks for it where enabled; the browser leaving it (Esc, F11) leaves full mode; Exit gives it back', async () => {
    const s = setup({ fsEnabled: true });
    s.enter();
    expect(s.fs.request).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    s.browserLeaves();
    expect(s.full.isFull()).toBe(false);
    expect(s.canvas.width).toBe(500);
    s.enter();
    await new Promise<void>((r) => { setTimeout(r, 0); });
    s.exit();
    expect(s.fs.exit).toHaveBeenCalledTimes(1);
  });

  it('where not enabled (iPhone Safari) the CSS fill alone: no request, no exit', () => {
    const s = setup({ fsEnabled: false });
    s.enter();
    s.exit();
    expect([s.fs.request.mock.calls.length, s.fs.exit.mock.calls.length]).toEqual([0, 0]);
  });
});

describe('the wiring — modalBinder (no test imports it; comments blanked so a commented-out line cannot pass)', () => {
  const src = readFileSync('src/ui/binders/modalBinder.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it('binds the full screen on the app dialog, with Save and every close leaving it first', () => {
    expect(src).toMatch(/const sigFull = bindSignatureFullscreen\(\{/);
    expect(src).toMatch(/app\.onSignatureBeforeSave\(\(\) => sigFull\.leave\(\)\)/);
    expect(src).toMatch(/app\.onSignatureModalClosed\(\(\) => sigFull\.leave\(\)\)/);
  });
  it('closes an OPEN phone panel through its own button (its click stops the camera), and leaves a shut one alone', () => {
    expect(src).toMatch(/if \(phone\?\.getAttribute\('aria-expanded'\) === 'true'\) phone\.click\(\);/);
  });
});
