// @vitest-environment jsdom
// The phone pad page's behaviour (phone-signature-pad plan step 4, rulings 2026-11-10 22:41): the pad, Done, the QR
// view, the 1-second cycle of a multi-QR signature, Edit, Download, and the layout. The QR read-back, the real pointer
// and the built page are pinned in real Chrome (tests/browser/pad-page.browser.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const drawQr = vi.hoisted(() => vi.fn(() => ({ modules: 21, modulePx: 4 })));
const encode = vi.hoisted(() => ({ override: null as null | (() => { frames: string[]; tolerance: number }) }));
vi.mock('../../src/utils/qrCanvas', () => ({ drawQr }));
vi.mock('../../src/utils/signatureStrokes', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/utils/signatureStrokes')>();
  return { ...real, encodeSignatureFrames: (sig: Parameters<typeof real.encodeSignatureFrames>[0]) => (encode.override ? encode.override() : real.encodeSignatureFrames(sig)) };
});

import { mountPadPage, type PadPageOptions } from '../../src/pad/padPage';
import { PtsigError, decodeSignatureFrames, encodeSignatureFrames } from '../../src/utils/signatureStrokes';

const mounted: Array<{ destroy(): void }> = [];
const mount = (...a: Parameters<typeof mountPadPage>) => { const p = mountPadPage(...a); mounted.push(p); return p; };

const T = (k: string, o?: Record<string, string | number>) => (o ? `${k}:${o.index}/${o.total}` : k);

function setup(width = 368, extra: Partial<PadPageOptions> = {}) {
  const root = document.createElement('main');
  Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => width });
  document.body.replaceChildren(root);
  const page = mount(root, { dpr: () => 2.8125, t: T, hash: () => '', setLanguage: vi.fn(), ...extra });
  const q = <E extends HTMLElement = HTMLElement>(name: string) => root.querySelector(`[data-pad="${name}"]`) as E;
  const view = (name: string) => root.querySelector(`[data-pad-view="${name}"]`) as HTMLElement;
  const canvas = q<HTMLCanvasElement>('canvas');
  canvas.setPointerCapture = vi.fn();
  const fire = (type: string, x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', buttons: 1, clientX: x, clientY: y, bubbles: true }));
  const draw = (pts: Array<[number, number]>) => {
    fire('pointerdown', pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) fire('pointermove', x, y);
    const last = pts[pts.length - 1];
    fire('pointerup', last[0], last[1]);
  };
  return { root, page, q, view, canvas, draw, setWidth: (w: number) => { width = w; } };
}

beforeEach(() => { drawQr.mockClear(); encode.override = null; });
afterEach(() => { mounted.splice(0).forEach((p) => p.destroy()); vi.useRealTimers(); });

describe('pad page — layout and pad', () => {
  it('lays the pad out at the root width (max 600) x 0.4 on the device dpr', () => {
    const { canvas } = setup(368);
    expect([canvas.style.width, canvas.style.height]).toEqual(['368px', '147px']);
    expect([canvas.width, canvas.height]).toEqual([1035, 413]);
    expect(setup(900).canvas.style.width).toBe('600px');
  });

  it('lays out in the root CONTENT box: its padding is not drawing room (the built page overflowed a 412 px phone)', () => {
    const root = document.createElement('main');
    root.style.padding = '12px 16px';
    Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => 412 }); // clientWidth includes padding
    document.body.replaceChildren(root);
    mount(root, { dpr: () => 1, t: T });
    const canvas = root.querySelector('[data-pad="canvas"]') as HTMLCanvasElement;
    expect(canvas.style.width).toBe('380px');
  });

  it('re-lays out on a WIDTH change only (a height-only resize is the on-screen keyboard or the URL bar)', () => {
    const s = setup(368);
    const spy = vi.spyOn(s.page.pad, 'setSize');
    window.dispatchEvent(new Event('resize'));
    expect(spy).not.toHaveBeenCalled();
    s.setWidth(500);
    window.dispatchEvent(new Event('resize'));
    expect(spy).toHaveBeenCalledWith(500, 200, 2.8125);
  });

  it('sizes the QR to the content box too (at most 480 px)', () => {
    const root = document.createElement('main');
    root.style.padding = '0 16px';
    Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => 412 });
    document.body.replaceChildren(root);
    const page = mount(root, { dpr: () => 2, t: T });
    const canvas = root.querySelector('[data-pad="canvas"]') as HTMLCanvasElement;
    canvas.setPointerCapture = vi.fn();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', buttons: 1, clientX: 5, clientY: 5 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 5 }));
    expect(page.pad.getStrokes()).toHaveLength(1);
    (root.querySelector('[data-pad="done"]') as HTMLButtonElement).click();
    expect((drawQr.mock.calls[0] as unknown as [unknown, string, number, number]).slice(2)).toEqual([380, 2]);
  });

  it('the pad is the phone pad: a link without ink draws black at 2 PC px (2 × 368/500 phone px), a tap draws a dot', () => {
    const { page, draw, canvas } = setup();
    expect(page.pad.color).toBe('#000000');
    expect(page.pad.lineWidth).toBeCloseTo((2 * 368) / 500, 9);
    const arc = vi.spyOn(canvas.getContext('2d') as CanvasRenderingContext2D, 'arc');
    draw([[50, 50]]);
    expect(arc).toHaveBeenCalledTimes(1);
  });

  it('Done stays disabled until something is drawn; Clear disables it again', () => {
    const { q, draw } = setup();
    expect(q<HTMLButtonElement>('done').disabled).toBe(true);
    draw([[10, 10], [60, 40]]);
    expect(q<HTMLButtonElement>('done').disabled).toBe(false);
    q('clear').click();
    expect(q<HTMLButtonElement>('done').disabled).toBe(true);
  });
});

describe('pad page — Done and the QR view', () => {
  it('encodes the pad in its LOGICAL size and shows one QR, with no counter and no timer', () => {
    vi.useFakeTimers();
    const { q, view, draw } = setup(368);
    draw([[10, 10], [300, 120]]);
    q('done').click();
    expect(view('draw').hidden).toBe(true);
    expect(view('qr').hidden).toBe(false);
    expect(drawQr).toHaveBeenCalledTimes(1);
    const [, text] = drawQr.mock.calls[0] as unknown as [HTMLCanvasElement, string, number, number];
    const sig = decodeSignatureFrames([text]);
    expect([sig.gridWidth, sig.gridHeight]).toEqual([1023, Math.round((147 * 1023) / 368)]);
    expect(sig.color).toBe('#000000');
    expect(q('count').hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a multi-QR signature cycles every second with "QR k of n"; Edit stops the cycle and keeps the drawing', () => {
    vi.useFakeTimers();
    encode.override = () => ({ frames: ['A', 'B', 'C'], tolerance: 1 });
    const { q, view, draw, page } = setup();
    draw([[10, 10], [60, 40]]);
    q('done').click();
    const shown = () => drawQr.mock.calls.map((c) => (c as unknown as [unknown, string])[1]);
    expect(shown()).toEqual(['A']);
    expect(q('count').hidden).toBe(false);
    expect(q('count').textContent).toBe('pad.qrCount:1/3');
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(shown()).toEqual(['A', 'B', 'C', 'A']);
    expect(q('count').textContent).toBe('pad.qrCount:1/3');
    q('edit').click();
    expect(vi.getTimerCount()).toBe(0);
    expect(view('draw').hidden).toBe(false);
    expect(page.pad.getStrokes()).toHaveLength(1);
  });

  it('a rotation while the QR shows redraws the current QR at the new width (it would overflow a narrower screen)', () => {
    vi.useFakeTimers();
    encode.override = () => ({ frames: ['A', 'B'], tolerance: 1 });
    const s = setup(800); // landscape: QR 480
    s.draw([[10, 10], [60, 40]]);
    s.q('done').click();
    vi.advanceTimersByTime(1000); // showing B
    s.setWidth(380); // portrait
    window.dispatchEvent(new Event('resize'));
    const last = drawQr.mock.calls[drawQr.mock.calls.length - 1] as unknown as [unknown, string, number, number];
    expect(last.slice(1)).toEqual(['B', 380, 2.8125]);
  });

  it('a landscape phone: the QR side is capped by the room below its top as well (a 480 px QR in a 360 px screen cannot be scanned)', () => {
    const s = setup(800, { viewport: () => ({ width: 800, height: 360 }) });
    s.draw([[10, 10], [60, 40]]);
    s.q('done').click();
    const [, , side] = drawQr.mock.calls[0] as unknown as [unknown, string, number];
    expect(side).toBe(360 - 12); // jsdom puts the QR's top at 0; 12 px kept below it
  });

  it('the QR re-fits when only the HEIGHT changes (the browser bars return after a full-screen Done, the width does not change)', () => {
    let vp = { width: 800, height: 360 };
    const s = setup(800, { viewport: () => vp });
    s.draw([[10, 10], [60, 40]]);
    s.q('done').click();
    expect((drawQr.mock.calls.at(-1) as unknown as [unknown, string, number])[2]).toBe(348);
    vp = { width: 800, height: 300 };
    window.dispatchEvent(new Event('resize'));
    expect((drawQr.mock.calls.at(-1) as unknown as [unknown, string, number])[2]).toBe(288);
    const n = drawQr.mock.calls.length;
    window.dispatchEvent(new Event('resize')); // nothing changed: no redraw
    expect(drawQr.mock.calls.length).toBe(n);
  });

  it('a hidden page stops the cycle and a visible one resumes it', () => {
    vi.useFakeTimers();
    encode.override = () => ({ frames: ['A', 'B'], tolerance: 1 });
    const { q, draw } = setup();
    draw([[10, 10], [60, 40]]);
    q('done').click();
    const vis = (v: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    vis('hidden');
    expect(vi.getTimerCount()).toBe(0);
    vis('visible');
    expect(vi.getTimerCount()).toBe(1);
    q('edit').click();
    vis('hidden');
    vis('visible'); // back on the pad: nothing to cycle
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a signature too large for four QRs shows the message and stays on the pad', () => {
    encode.override = () => { throw new PtsigError('too-large', 'test'); };
    const { q, view, draw } = setup();
    draw([[10, 10], [60, 40]]);
    q('done').click();
    expect(view('draw').hidden).toBe(false);
    expect(view('qr').hidden).toBe(true);
    expect(q('error').hidden).toBe(false);
    expect(q('error').dataset.i18n).toBe('pad.tooComplex');
    expect(drawQr).not.toHaveBeenCalled();
    q('clear').click();
    expect(q('error').hidden).toBe(true);
  });
});

describe('pad page — Download', () => {
  it('saves signature.png made from the strokes', () => {
    const { q, draw } = setup();
    draw([[10, 10], [60, 40]]);
    q('done').click();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    q('download').click();
    expect(click).toHaveBeenCalledTimes(1);
    const a = click.mock.contexts[0] as HTMLAnchorElement;
    expect(a.download).toBe('signature.png');
    expect(a.href.startsWith('data:image/png')).toBe(true);
  });
});

describe('padLanguageFromHash — the PC hands its language to the phone (step 5a)', () => {
  it('reads lang= from the fragment, for the three app languages only', async () => {
    const { padLanguageFromHash } = await import('../../src/pad/padPage');
    expect(padLanguageFromHash('#lang=fr')).toBe('fr');
    expect(padLanguageFromHash('#lang=ar')).toBe('ar');
    expect(padLanguageFromHash('#x=1&lang=en')).toBe('en');
    expect(padLanguageFromHash('#lang=de')).toBeNull();
    expect(padLanguageFromHash('#lang=FR')).toBeNull();
    expect(padLanguageFromHash('')).toBeNull();
    expect(padLanguageFromHash('#lang=fr<script>')).toBeNull();
  });
});

// 7b commit B (F2, rulings 2026-11-12 09:56 / 10:15): the PC hands its ink over in the fragment; the phone can change it
// (the shared swatch row without white, a 1–10 stepper), every change repaints every stroke (PTSIG carries ONE ink), and
// a new link (hashchange) re-applies language and ink. `w` is in PC px for a PC canvas `cw` wide: the phone draws at
// w × padWidth / cw, so the PC's replay comes back at w.
describe('pad page — the ink (7b)', () => {
  const H = '#lang=en&c=ff0000&w=4&cw=640';
  function inked(hash = H, width = 320) {
    let h = hash;
    const setLanguage = vi.fn();
    const s = setup(width, { hash: () => h, setLanguage });
    const swatches = () => [...s.root.querySelectorAll<HTMLButtonElement>('[data-pad="swatches"] button')];
    const pressed = () => swatches().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.title);
    const swatch = (hex: string) => swatches().find((b) => b.title === hex) as HTMLButtonElement;
    return {
      ...s, setLanguage, swatches, pressed, swatch,
      setHash: (v: string) => { h = v; window.dispatchEvent(new HashChangeEvent('hashchange')); },
      custom: () => s.root.querySelector<HTMLButtonElement>('[data-pad="customColor"]') as HTMLButtonElement,
      picker: () => s.root.querySelector<HTMLInputElement>('[data-pad="colorPicker"]') as HTMLInputElement,
      up: () => s.q<HTMLButtonElement>('widthUp'), down: () => s.q<HTMLButtonElement>('widthDown'), num: () => s.q('width'),
    };
  }
  beforeEach(() => { localStorage.clear(); });

  it('opens on the link\'s ink: red, 4 PC px on a 640 px PC canvas = 2 px on this 320 px pad', () => {
    const { page } = inked();
    expect(page.pad.color).toBe('#ff0000');
    expect(page.pad.lineWidth).toBe(2);
  });

  it('the swatch row: the shared presets and recents, never white, the link\'s colour selected and added when new', () => {
    localStorage.setItem('pdfturbo.recentColors', JSON.stringify(['#FFFFFF', '#123456', '#FF0000']));
    const { swatches, pressed } = inked('#lang=en&c=1d4ed8&w=4&cw=640');
    const titles = swatches().map((b) => b.title).filter(Boolean);
    expect(titles.map((x) => x.toLowerCase())).not.toContain('#ffffff');
    expect(titles).toEqual(['#000000', '#ff0000', '#ff9900', '#ffff00', '#00cc00', '#0066ff', '#9900ff', '#888888', '#a52a2a', '#123456', '#1d4ed8']);
    expect(pressed()).toEqual(['#1d4ed8']);
    for (const b of swatches()) expect(b.type).toBe('button');
  });

  it('a swatch: the pad takes the colour, repaints, and the pressed state moves', () => {
    const { page, swatch, pressed } = inked();
    const repaint = vi.spyOn(page.pad, 'repaint');
    swatch('#00cc00').click();
    expect(page.pad.color).toBe('#00cc00');
    expect(repaint).toHaveBeenCalledTimes(1);
    expect(pressed()).toEqual(['#00cc00']);
  });

  it('the custom swatch opens the picker; a pick is used, remembered and shown; a WHITE pick is refused', () => {
    const { page, custom, picker, pressed } = inked();
    expect(custom().getAttribute('aria-label')).toBe('toolbar.customColorTitle');
    const click = vi.spyOn(picker(), 'click').mockImplementation(() => {});
    custom().click();
    expect(click).toHaveBeenCalledTimes(1);
    picker().value = '#abcdef';
    picker().dispatchEvent(new Event('change'));
    expect(page.pad.color).toBe('#abcdef');
    expect(JSON.parse(localStorage.getItem('pdfturbo.recentColors') ?? '[]')[0]).toBe('#abcdef');
    expect(pressed()).toEqual(['#abcdef']);
    picker().value = '#ffffff';
    picker().dispatchEvent(new Event('change'));
    expect(page.pad.color).toBe('#abcdef');
    expect(JSON.parse(localStorage.getItem('pdfturbo.recentColors') ?? '[]')).not.toContain('#ffffff');
  });

  it('the stepper: whole steps 1–10, the pad width = w × pad / cw, a repaint each step, the ends disabled', () => {
    const { page, up, down, num } = inked();
    const repaint = vi.spyOn(page.pad, 'repaint');
    expect(num().textContent).toBe('4');
    expect(num().getAttribute('aria-live')).toBe('polite');
    expect(up().getAttribute('aria-label')).toBe('pad.widthUp');
    expect(down().getAttribute('aria-label')).toBe('pad.widthDown');
    up().click();
    expect([num().textContent, page.pad.lineWidth]).toEqual(['5', 2.5]);
    expect(repaint).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 9; i++) up().click();
    expect([num().textContent, up().disabled, down().disabled]).toEqual(['10', true, false]);
    for (let i = 0; i < 12; i++) down().click();
    expect([num().textContent, up().disabled, down().disabled, page.pad.lineWidth]).toEqual(['1', false, true, 0.5]);
  });

  it('Clear → draw → change the ink: the new stroke is repainted in the new ink (the phone repaint is not gated)', () => {
    const { page, q, draw, canvas, swatch } = inked();
    draw([[10, 10], [60, 40]]);
    q('clear').click();
    draw([[20, 20], [90, 50]]);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const seen: unknown[] = [];
    vi.spyOn(ctx, 'stroke').mockImplementation(() => { seen.push(ctx.strokeStyle); });
    swatch('#0066ff').click();
    expect(seen).toEqual(['#0066ff']);
    expect(page.pad.getStrokes()).toHaveLength(1);
  });

  it('a rotation keeps the link\'s width: the pad width is recomputed BEFORE setSize repaints', () => {
    const s = inked(H, 320);
    const at: number[] = [];
    vi.spyOn(s.page.pad, 'setSize').mockImplementation(function (this: { lineWidth: number }) { at.push(this.lineWidth); });
    s.setWidth(480);
    window.dispatchEvent(new Event('resize'));
    expect(at).toEqual([3]); // 4 × 480 / 640
  });

  it('a new link (hashchange) re-applies the language and the ink, and repaints', () => {
    const { page, setHash, setLanguage, pressed, num } = inked();
    const repaint = vi.spyOn(page.pad, 'repaint');
    setHash('#lang=fr&c=0066ff&w=6&cw=640');
    expect(setLanguage).toHaveBeenCalledWith('fr');
    expect([page.pad.color, page.pad.lineWidth]).toEqual(['#0066ff', 3]);
    expect(repaint).toHaveBeenCalled();
    expect(pressed()).toEqual(['#0066ff']);
    expect(num().textContent).toBe('6');
    setHash('#c=000000&w=2&cw=640'); // no lang: the language is left alone
    expect(setLanguage).toHaveBeenCalledTimes(1);
  });

  it('a new link while the QR shows: back to the draw view, the cycle stopped (no frame in the old ink stays)', () => {
    vi.useFakeTimers();
    encode.override = () => ({ frames: ['A', 'B'], tolerance: 1 });
    const { q, view, draw, setHash } = inked();
    draw([[10, 10], [60, 40]]);
    q('done').click();
    expect(view('qr').hidden).toBe(false);
    setHash('#lang=en&c=0066ff&w=6&cw=640');
    expect([view('qr').hidden, view('draw').hidden]).toEqual([true, false]);
    const calls = drawQr.mock.calls.length;
    vi.advanceTimersByTime(3000);
    expect(drawQr.mock.calls.length).toBe(calls);
  });

  it('destroy() removes the hashchange listener', () => {
    const { page, setHash, setLanguage } = inked();
    page.destroy();
    setHash('#lang=fr&c=0066ff&w=6&cw=640');
    expect(setLanguage).not.toHaveBeenCalled();
    expect(page.pad.color).toBe('#ff0000');
  });

  it('the controls are named: the two groups by translated labels, every swatch by its hex (no visible text)', () => {
    const { root, swatches } = inked();
    const groups = [...root.querySelectorAll('[data-pad-view="draw"] [role="group"]')].map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['pad.color', 'pad.width']);
    for (const b of swatches()) if (b.dataset.pad !== 'customColor') expect([b.textContent, /^#[0-9a-f]{6}$/.test(b.title)]).toEqual(['', true]);
  });
});

// Full screen (plan row 11, phone half; rulings 2026-11-12 19:09 / 23:09 / 23:15). The Fullscreen API and the viewport
// are injected here, except the one case below that runs the DEFAULT wiring where the API is absent (jsdom has none, like
// iPhone Safari). Real Chrome pins the CSS, the default wiring into element fullscreen and the landscape QR
// (pad-fullscreen.browser.test.ts).
describe('pad page — full screen (row 11, phone half)', () => {
  const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });
  function full(o: { box?: { w: number; h: number }; vp?: { width: number; height: number }; enabled?: boolean; hash?: string } = {}) {
    let active = false;
    const pending: Array<() => void> = []; // one resolver per request, oldest first
    const api = {
      enabled: vi.fn(() => o.enabled ?? true),
      request: vi.fn(() => new Promise<void>((r) => { pending.push(() => { active = true; r(); }); })),
      exit: vi.fn(() => { active = false; return Promise.resolve(); }),
      active: vi.fn(() => active),
      lockLandscape: vi.fn(() => Promise.resolve()),
      unlock: vi.fn(),
    };
    let vp = o.vp ?? { width: 800, height: 360 };
    let box = o.box ?? { w: 776, h: 280 };
    let h = o.hash ?? '';
    const seenHint: Array<HTMLElement['hidden']> = [];
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const setLanguage = vi.fn();
    const s = setup(380, { fullscreen: api, viewport: () => vp, hash: () => h, setLanguage });
    const hint = s.q('rotateHint');
    const b = s.q('box');
    Object.defineProperty(b, 'clientWidth', { configurable: true, get: () => box.w });
    Object.defineProperty(b, 'clientHeight', { configurable: true, get: () => { seenHint.push(hint.hidden); return box.h; } });
    const visibleActions = () => [...s.root.querySelectorAll<HTMLElement>('[data-pad-view="draw"] .pad-actions > button')].filter((e) => !e.hidden).map((e) => e.dataset.pad);
    return {
      ...s, api, hint, seenHint, scrollTo, setLanguage, visibleActions,
      grant: async () => { pending.shift()?.(); await flush(); },
      setActive: (v: boolean) => { active = v; },
      setVp: (v: { width: number; height: number }) => { vp = v; },
      setBox: (v: { w: number; h: number }) => { box = v; },
      setHash: (v: string) => { h = v; window.dispatchEvent(new HashChangeEvent('hashchange')); },
      isFull: () => s.root.classList.contains('pad-full'),
      enter: () => s.q('fullscreen').click(),
      exit: () => s.q('exitFullscreen').click(),
      size: () => [s.canvas.style.width, s.canvas.style.height],
    };
  }
  afterEach(() => { vi.restoreAllMocks(); });

  it('the toggle sits between Clear and Done; entering swaps it for Exit, moves focus, marks the root and scrolls to the top', () => {
    const f = full();
    expect(f.visibleActions()).toEqual(['clear', 'fullscreen', 'done']);
    expect(f.q('fullscreen').textContent).toBe('pad.fullscreen');
    expect(f.isFull()).toBe(false);
    f.enter();
    expect(f.isFull()).toBe(true);
    expect(f.visibleActions()).toEqual(['clear', 'exitFullscreen', 'done']);
    expect(f.q('exitFullscreen').textContent).toBe('pad.exitFullscreen');
    expect(document.activeElement).toBe(f.q('exitFullscreen'));
    expect(f.scrollTo).toHaveBeenCalledWith(0, 0);
    f.exit();
    expect(f.isFull()).toBe(false);
    expect(f.visibleActions()).toEqual(['clear', 'fullscreen', 'done']);
    expect(document.activeElement).toBe(f.q('fullscreen'));
  });

  it('full mode sizes the pad from the MEASURED box, with no 600 px cap: min(box width, box height ÷ 0.4)', () => {
    const f = full({ box: { w: 776, h: 280 } });
    expect(f.size()).toEqual(['380px', '152px']);
    f.enter();
    expect(f.size()).toEqual(['700px', '280px']);
    f.exit();
    expect(f.size()).toEqual(['380px', '152px']);
    f.setBox({ w: 1200, h: 470 }); // a tablet: wider than the normal 600 px cap
    f.enter();
    expect(f.size()).toEqual(['1175px', '470px']);
  });

  it('in full mode a height-only resize re-lays out (no text input shows there); normal mode is width-only again after', () => {
    const f = full({ box: { w: 776, h: 280 } });
    f.enter();
    const spy = vi.spyOn(f.page.pad, 'setSize');
    f.setBox({ w: 776, h: 200 }); // the URL bar or a fullscreen grant changed the height only
    window.dispatchEvent(new Event('resize'));
    expect(spy).toHaveBeenCalledWith(500, 200, 2.8125);
    f.exit();
    spy.mockClear();
    f.setBox({ w: 776, h: 100 });
    window.dispatchEvent(new Event('resize'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('where the Fullscreen API exists: request, then the landscape lock once granted; without it (iPhone Safari) the CSS fill alone', async () => {
    const f = full();
    f.enter();
    expect(f.api.request).toHaveBeenCalledTimes(1);
    expect(f.api.lockLandscape).not.toHaveBeenCalled();
    await f.grant();
    expect(f.api.lockLandscape).toHaveBeenCalledTimes(1);
    const g = full({ enabled: false });
    g.enter();
    expect(g.api.request).not.toHaveBeenCalled();
    expect(g.isFull()).toBe(true);
    expect(g.size()).toEqual(['700px', '280px']);
  });

  it('the CSS-only path (no Fullscreen API) undoes nothing it did not take: no unlock, no exit', () => {
    const f = full({ enabled: false });
    f.enter();
    f.exit();
    f.enter();
    f.draw([[10, 10], [60, 40]]);
    f.q('done').click();
    expect([f.api.unlock.mock.calls.length, f.api.exit.mock.calls.length, f.api.active.mock.calls.length]).toEqual([0, 0, 0]);
  });

  it('enter, exit, enter again before the first grant: the first grant does not take away the second entry\'s fullscreen', async () => {
    const f = full();
    f.enter();
    f.exit();
    f.enter();
    await f.grant(); // the FIRST request's grant, while the second entry is current
    expect(f.isFull()).toBe(true);
    expect(f.api.exit).not.toHaveBeenCalled();
    expect(f.api.lockLandscape).toHaveBeenCalledTimes(1);
  });

  it('an entry left before fullscreen is granted never locks landscape, and leaves the fullscreen it gets', async () => {
    const f = full();
    f.enter();
    f.exit();
    await f.grant();
    expect(f.api.lockLandscape).not.toHaveBeenCalled();
    expect(f.api.exit).toHaveBeenCalledTimes(1);
    expect(f.isFull()).toBe(false);
  });

  it('Exit leaves the API fullscreen and unlocks; a fullscreenchange to no element (Android back, Esc) leaves full mode', async () => {
    const f = full();
    f.enter();
    await f.grant();
    document.dispatchEvent(new Event('fullscreenchange')); // the grant's own change: still full
    expect(f.isFull()).toBe(true);
    f.exit();
    expect(f.api.exit).toHaveBeenCalledTimes(1);
    expect(f.api.unlock).toHaveBeenCalled();
    f.enter();
    await f.grant();
    f.setActive(false); // the browser left fullscreen on its own
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(f.isFull()).toBe(false);
    expect(f.api.exit).toHaveBeenCalledTimes(1); // not asked to leave a fullscreen that is already gone
    expect(f.q('fullscreen').hidden).toBe(false);
  });

  it('Done in full screen leaves it FIRST, then shows the QR of the normal-size pad; the drawing is kept; Edit returns to the normal pad', () => {
    const f = full();
    f.enter();
    f.draw([[10, 10], [600, 200]]);
    f.q('done').click();
    expect(f.isFull()).toBe(false);
    expect([f.view('draw').hidden, f.view('qr').hidden]).toEqual([true, false]);
    const [, text] = drawQr.mock.calls[0] as unknown as [HTMLCanvasElement, string];
    expect(decodeSignatureFrames([text]).gridHeight).toBe(Math.round((152 * 1023) / 380));
    expect(f.page.pad.getStrokes()).toHaveLength(1);
    f.q('edit').click();
    expect([f.view('draw').hidden, f.isFull()]).toEqual([false, false]);
  });

  it('a signature too large for the QRs, Done in full screen: the error shows on the NORMAL pad', () => {
    encode.override = () => { throw new PtsigError('too-large', 'test'); };
    const f = full();
    f.enter();
    f.draw([[10, 10], [60, 40]]);
    f.q('done').click();
    expect(f.isFull()).toBe(false);
    expect([f.view('draw').hidden, f.q('error').hidden]).toEqual([false, false]);
  });

  it('the line width follows the bigger pad: w × padWidth / cw', () => {
    const f = full({ hash: '#c=ff0000&w=4&cw=640', box: { w: 776, h: 280 } });
    f.enter();
    expect(f.page.pad.lineWidth).toBeCloseTo((4 * 700) / 640, 9);
  });

  it('the rotate hint: only in full mode while upright, and set BEFORE the box is measured', () => {
    const f = full({ vp: { width: 412, height: 800 }, box: { w: 388, h: 600 } });
    expect(f.hint.hidden).toBe(true);
    f.enter();
    expect(f.hint.hidden).toBe(false);
    expect(f.seenHint.at(-1)).toBe(false);
    f.setVp({ width: 800, height: 412 });
    f.setBox({ w: 776, h: 300 });
    window.dispatchEvent(new Event('resize'));
    expect(f.hint.hidden).toBe(true);
    expect(f.seenHint.at(-1)).toBe(true);
    f.setVp({ width: 412, height: 800 });
    f.exit();
    expect(f.hint.hidden).toBe(true);
  });

  it('a new link while full keeps full mode, and each button keeps its own translation key (a language change re-translates both)', () => {
    const f = full();
    f.enter();
    f.setHash('#lang=fr&c=0066ff&w=6&cw=640');
    expect(f.setLanguage).toHaveBeenCalledWith('fr');
    expect(f.isFull()).toBe(true);
    expect([f.q('fullscreen').dataset.i18n, f.q('exitFullscreen').dataset.i18n]).toEqual(['pad.fullscreen', 'pad.exitFullscreen']);
    expect(f.visibleActions()).toEqual(['clear', 'exitFullscreen', 'done']);
  });

  it('destroy() removes the fullscreenchange listener', async () => {
    const f = full();
    f.enter();
    await f.grant();
    f.page.destroy();
    f.setActive(false);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(f.isFull()).toBe(true);
  });

  it('the DEFAULT wiring where the Fullscreen API does not exist (iPhone Safari; jsdom has none either): Exit and Done still leave', () => {
    expect('fullscreenElement' in document).toBe(false); // the premise: no API at all here
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); };
    window.addEventListener('error', onError);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    try {
      const s = setup(368); // no `fullscreen` option: browserFullscreen
      s.q('fullscreen').click();
      expect(s.root.classList.contains('pad-full')).toBe(true);
      s.q('exitFullscreen').click();
      expect([s.root.classList.contains('pad-full'), s.canvas.style.width]).toEqual([false, '368px']);
      s.q('fullscreen').click();
      s.draw([[10, 10], [60, 40]]);
      s.q('done').click();
      expect([s.view('qr').hidden, s.root.classList.contains('pad-full')]).toEqual([false, false]);
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener('error', onError);
    }
  });

  it('PTSIG does not see the pad size: a 1150×460 full-screen pad encodes onto the same 1023 grid and decodes', () => {
    const f = full({ box: { w: 1200, h: 460 } });
    f.enter();
    expect(f.size()).toEqual(['1150px', '460px']);
    f.draw([[10, 10], [500, 300], [1100, 450]]);
    const { frames } = encodeSignatureFrames(f.page.pad.toSignatureInput());
    const sig = decodeSignatureFrames(frames);
    expect([sig.gridWidth, sig.gridHeight]).toEqual([1023, Math.round((460 * 1023) / 1150)]);
    expect(sig.strokes).toHaveLength(1);
  });
});
