// @vitest-environment jsdom
// The ✍ modal's two ink boxes (#sigLineWidth, #sigColor) and the pad (phone-signature-pad 7b commit B, rulings
// 2026-11-12 09:56 / 10:15). Bound by modalBinder for every user (the flag off too): the boxes drive the pad LIVE on
// `input` with a clamped value and are written back only on `change` (writing back on `input` fights the typing). The
// same boxes are the ONE source of the ink the phone link carries (`inkBoxes().get()`), and a scan writes them back.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { bindSignatureInkBoxes, inkBoxes } from '../../src/ui/signatureInkBoxes';
import { SignaturePad } from '../../src/utils/signaturePad';

function setup(width = '2', color = '#000000') {
  document.body.innerHTML = `<input id="w" type="number" min="1" max="10" value="${width}"><input id="c" type="color" value="${color}"><canvas id="pad"></canvas>`;
  const w = document.getElementById('w') as HTMLInputElement;
  const c = document.getElementById('c') as HTMLInputElement;
  const canvas = document.getElementById('pad') as HTMLCanvasElement;
  canvas.width = 640;
  canvas.height = 256;
  const pad = new SignaturePad(canvas);
  const type = (el: HTMLInputElement, value: string, ev: 'input' | 'change') => {
    el.value = value;
    el.dispatchEvent(new Event(ev, { bubbles: true }));
  };
  return { w, c, canvas, pad, type };
}

describe('bindSignatureInkBoxes — the boxes drive the pad', () => {
  it('width on input: the pad takes the CLAMPED value, the box keeps what is being typed', () => {
    const { w, pad, type } = setup();
    bindSignatureInkBoxes(pad, w, document.getElementById('c') as HTMLInputElement);
    type(w, '7', 'input');
    expect(pad.lineWidth).toBe(7);
    type(w, '50', 'input');
    expect(pad.lineWidth).toBe(10);
    expect(w.value).toBe('50');
  });

  it('width on input: not a number (a box being emptied) leaves the pad alone', () => {
    const { w, c, pad, type } = setup('4');
    bindSignatureInkBoxes(pad, w, c);
    type(w, '4', 'input');
    type(w, '', 'input');
    expect(pad.lineWidth).toBe(4);
  });

  it('width on change: the box is written back clamped — "", "0", "50", "3.7"', () => {
    const { w, c, pad, type } = setup('3');
    bindSignatureInkBoxes(pad, w, c);
    type(w, '3', 'change');
    type(w, '', 'change');
    expect([w.value, pad.lineWidth]).toEqual(['3', 3]); // NaN keeps the previous value
    type(w, '0', 'change');
    expect([w.value, pad.lineWidth]).toEqual(['1', 1]);
    type(w, '50', 'change');
    expect([w.value, pad.lineWidth]).toEqual(['10', 10]);
    type(w, '3.7', 'change');
    expect([w.value, pad.lineWidth]).toEqual(['4', 4]);
  });

  it('colour on input (live while the picker is dragged) and on change', () => {
    const { w, c, pad, type } = setup();
    bindSignatureInkBoxes(pad, w, c);
    type(c, '#ff0000', 'input');
    expect(pad.color).toBe('#ff0000');
    type(c, '#0000ff', 'change');
    expect(pad.color).toBe('#0000ff');
  });

  it('when the pad stops following a scan, its ink is reset FROM THE BOXES (a 30 px scan → Clear → the box width)', () => {
    const { w, c, pad } = setup('3', '#00cc00');
    bindSignatureInkBoxes(pad, w, c);
    pad.replay({ gridWidth: 1023, gridHeight: 409, color: '#00cc00', lineWidth: 48, strokes: [[{ x: 0, y: 0 }, { x: 1000, y: 400 }]] });
    expect(pad.lineWidth).toBeGreaterThan(29); // 48 × 640/1023 ≈ 30 px — over anything the box can show
    pad.clear();
    expect([pad.color, pad.lineWidth]).toEqual(['#00cc00', 3]);
  });
});

describe('inkBoxes — the ink the phone link carries, and the scan writing it back', () => {
  it('get(): the boxes, the width clamped and WRITTEN BACK, cw = the pad canvas width clamped 200–4000', () => {
    const { w, c, canvas } = setup('50', '#1D4ED8');
    const ink = inkBoxes(w, c, canvas);
    expect(ink.get()).toEqual({ color: '#1d4ed8', width: 10, cw: 640 });
    expect(w.value).toBe('10');
    canvas.width = 150;
    expect(ink.get().cw).toBe(200);
    canvas.width = 5000;
    expect(ink.get().cw).toBe(4000);
    w.value = '';
    expect(ink.get().width).toBe(2); // an empty box reads as the box default
  });

  it('set(): the colour box and the ROUNDED width box (0.25 → 1, 3.4 → 3, 40 → 10), firing no event', () => {
    const { w, c, canvas } = setup();
    const ink = inkBoxes(w, c, canvas);
    const heard = vi.fn();
    w.addEventListener('change', heard);
    w.addEventListener('input', heard);
    c.addEventListener('change', heard);
    ink.set({ color: '#00cc00', width: 3.4 });
    expect([c.value, w.value]).toEqual(['#00cc00', '3']);
    ink.set({ color: '#00cc00', width: 0.25 });
    expect(w.value).toBe('1');
    ink.set({ color: '#00cc00', width: 40 });
    expect(w.value).toBe('10');
    expect(heard).not.toHaveBeenCalled();
  });

  it('onChange(fn): runs on a `change` of either box, not on `input`', () => {
    const { w, c, canvas, type } = setup();
    const fn = vi.fn();
    inkBoxes(w, c, canvas).onChange(fn);
    type(w, '5', 'input');
    type(c, '#ff0000', 'input');
    expect(fn).not.toHaveBeenCalled();
    type(w, '5', 'change');
    type(c, '#ff0000', 'change');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('the wiring — modalBinder binds the boxes for every user (no test imports modalBinder)', () => {
  // Comments blanked, so a commented-out call cannot satisfy it.
  const src = readFileSync('src/ui/binders/modalBinder.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it('calls bindSignatureInkBoxes on the app pad and the two boxes, and keeps no listener of its own on them', () => {
    expect(src).toMatch(/bindSignatureInkBoxes\(\s*app\.signaturePad,\s*app\.ui\.sigLineWidthInput,\s*app\.ui\.sigColorInput\s*\)/);
    expect(src).not.toMatch(/sig(LineWidth|Color)Input\.addEventListener/);
  });
});
