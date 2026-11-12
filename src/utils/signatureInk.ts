/**
 * The phone pad's ink, handed over by the PC in the pad URL's FRAGMENT (phone-signature-pad step 7b, rulings 2026-11-12
 * 09:56): `#lang=en&c=1d4ed8&w=2&cw=500`. `c` is 6 hex digits without `#`; `w` is the PC's width box, a whole 1–10, in
 * PC canvas px; `cw` is the PC canvas width, a whole 200–4000. The phone draws at `w × padWidth / cw` CSS px, so the
 * PC's replay (which fits the phone's grid to `cw`) comes back at `w`.
 *
 * Why `cw` has a floor of 200: PTSIG carries the width in quarter grid units capped at 255 (`signatureStrokes.ts`
 * `lineQuarters`), and at w = 10 a `cw` under 162 passes that cap (measured: cw 150 → 273).
 *
 * The phone reads the fragment STRICTLY, like `lang`: a bad field falls back to its own default (black, 2, 500), never
 * to a guess. White falls back to black: invisible ink is never offered, whichever way it arrives.
 */

export interface PadInk {
  /** `#rrggbb`, lowercase. */
  color: string;
  /** The PC's line width box: a whole 1–10, in PC canvas px. */
  width: number;
  /** The PC canvas width the width is measured against: a whole 200–4000. */
  cw: number;
}

export const PAD_INK_DEFAULT: Readonly<PadInk> = Object.freeze({ color: '#000000', width: 2, cw: 500 });

export const LINE_WIDTH_MIN = 1;
export const LINE_WIDTH_MAX = 10;
export const CW_MIN = 200;
export const CW_MAX = 4000;

const HEX6 = /^[0-9a-f]{6}$/i;
const WHITE = 'ffffff';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The width box's rule: a whole number 1–10. */
export function clampLineWidth(n: number): number {
  return clamp(Math.round(n), LINE_WIDTH_MIN, LINE_WIDTH_MAX);
}

/** A width box value, clamped; null when it is not a number (an emptied box: the caller keeps what it had). */
export function parseLineWidth(value: string): number | null {
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : clampLineWidth(n);
}

/** `c=…&w=…&cw=…` — the ink part of the pad URL's fragment. A colour that is not `#rrggbb` is sent as black. */
export function padInkFragment(ink: PadInk): string {
  const hex = ink.color.replace(/^#/, '');
  const c = HEX6.test(hex) ? hex.toLowerCase() : PAD_INK_DEFAULT.color.slice(1);
  const cw = clamp(Math.round(ink.cw), CW_MIN, CW_MAX);
  return `c=${c}&w=${clampLineWidth(ink.width)}&cw=${cw}`;
}

/** A whole number written as plain digits, within [lo, hi]; else null. */
function strictInt(v: string | null, lo: number, hi: number): number | null {
  if (v === null || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
}

/** The ink the PC handed over in the fragment; each invalid or missing field falls back alone to its default. */
export function padInkFromHash(hash: string): PadInk {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const c = p.get('c');
  const color = c !== null && HEX6.test(c) && c.toLowerCase() !== WHITE ? `#${c.toLowerCase()}` : PAD_INK_DEFAULT.color;
  return {
    color,
    width: strictInt(p.get('w'), LINE_WIDTH_MIN, LINE_WIDTH_MAX) ?? PAD_INK_DEFAULT.width,
    cw: strictInt(p.get('cw'), CW_MIN, CW_MAX) ?? PAD_INK_DEFAULT.cw,
  };
}

/** True for `#ffffff` in any case: never offered as ink on the phone. */
export function isWhite(hex: string): boolean {
  return hex.replace(/^#/, '').toLowerCase() === WHITE;
}
