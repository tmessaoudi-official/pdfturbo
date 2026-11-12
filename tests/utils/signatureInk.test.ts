// The phone pad's ink, handed over by the PC in the pad URL's fragment (phone-signature-pad step 7b, commit B; rulings
// 2026-11-12 09:56). `w` is in PC canvas px for a PC canvas `cw` px wide: the phone draws at w × padWidth / cw, so the
// replay on the PC comes back at w. The phone reads the fragment STRICTLY, like `lang`: a bad field falls back to its
// own default, never to a guess.
import { describe, it, expect } from 'vitest';
import { clampLineWidth, padInkFragment, padInkFromHash, parseLineWidth, PAD_INK_DEFAULT } from '../../src/utils/signatureInk';

describe('clampLineWidth / parseLineWidth — the PC width box, 1–10 whole', () => {
  it('rounds and clamps', () => {
    expect([0.25, 1, 3.4, 3.7, 10, 40, -3].map(clampLineWidth)).toEqual([1, 1, 3, 4, 10, 10, 1]);
  });
  it('parses a box value; not a number → null (the caller keeps what it had)', () => {
    expect(parseLineWidth('')).toBeNull();
    expect(parseLineWidth('abc')).toBeNull();
    expect(parseLineWidth('0')).toBe(1);
    expect(parseLineWidth('50')).toBe(10);
    expect(parseLineWidth('3.7')).toBe(4);
    expect(parseLineWidth('6')).toBe(6);
  });
});

describe('padInkFragment — what the PC writes', () => {
  it('colour without #, lowercase; w whole 1–10; cw whole 200–4000', () => {
    expect(padInkFragment({ color: '#1D4ED8', width: 2, cw: 500 })).toBe('c=1d4ed8&w=2&cw=500');
    expect(padInkFragment({ color: '#ff0000', width: 40, cw: 150 })).toBe('c=ff0000&w=10&cw=200');
    expect(padInkFragment({ color: '#ff0000', width: 0, cw: 9000.6 })).toBe('c=ff0000&w=1&cw=4000');
    expect(padInkFragment({ color: '#ff0000', width: 3, cw: 640.4 })).toBe('c=ff0000&w=3&cw=640');
  });
  it('a colour that is not #rrggbb is sent as black', () => {
    expect(padInkFragment({ color: 'red', width: 2, cw: 500 })).toBe('c=000000&w=2&cw=500');
  });
});

describe('padInkFromHash — what the phone reads', () => {
  it('reads the three fields', () => {
    expect(padInkFromHash('#lang=fr&c=1d4ed8&w=4&cw=640')).toEqual({ color: '#1d4ed8', width: 4, cw: 640 });
    expect(padInkFromHash('#c=ABCDEF&w=10&cw=4000&lang=en')).toEqual({ color: '#abcdef', width: 10, cw: 4000 });
    expect(padInkFromHash('#c=00cc00&w=1&cw=200')).toEqual({ color: '#00cc00', width: 1, cw: 200 });
  });
  it('the defaults: black, 2, 500 — an old link (lang only), an empty hash, a bare #', () => {
    expect(PAD_INK_DEFAULT).toEqual({ color: '#000000', width: 2, cw: 500 });
    for (const h of ['#lang=en', '', '#']) expect(padInkFromHash(h)).toEqual(PAD_INK_DEFAULT);
  });
  it('each invalid field falls back ALONE to its own default', () => {
    const ok = { c: '1d4ed8', w: '4', cw: '640' };
    const read = (over: Partial<typeof ok>) => padInkFromHash(`#${new URLSearchParams({ ...ok, ...over }).toString()}`);
    for (const c of ['red', '%231d4ed8', '#1d4ed8', '1d4ed', '1d4ed88', 'gggggg', '']) expect(read({ c })).toEqual({ color: '#000000', width: 4, cw: 640 });
    for (const w of ['0', '11', '3.5', '-2', 'x', '', '04x']) expect(read({ w })).toEqual({ color: '#1d4ed8', width: 2, cw: 640 });
    for (const cw of ['199', '4001', '640.5', 'x', '']) expect(read({ cw })).toEqual({ color: '#1d4ed8', width: 4, cw: 500 });
  });
  it('a %23-encoded colour is not a colour (the fragment carries 6 hex digits, no #)', () => {
    expect(padInkFromHash('#c=%23ff0000&w=4&cw=640').color).toBe('#000000');
  });
  it('white is never offered as ink, whatever its case: it falls back to black', () => {
    expect(padInkFromHash('#c=ffffff&w=4&cw=640').color).toBe('#000000');
    expect(padInkFromHash('#c=FFFFFF&w=4&cw=640').color).toBe('#000000');
  });
});
