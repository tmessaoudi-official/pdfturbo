import { CW_MAX, CW_MIN, PAD_INK_DEFAULT, clampLineWidth, parseLineWidth, type PadInk } from '../utils/signatureInk';

/**
 * The ✍ modal's two ink boxes — `#sigLineWidth` (a number, 1–10) and `#sigColor` — and the pad (phone-signature-pad
 * 7b commit B, rulings 2026-11-12 09:56 / 10:15).
 *  - `bindSignatureInkBoxes` (modalBinder, every user, the phonePad flag off too): the boxes drive the pad LIVE on
 *    `input` with a clamped value, and the width box is written back clamped only on `change` — writing back on
 *    `input` fights the typing. When the pad stops following a scan, its ink is reset from the boxes.
 *  - `inkBoxes` (phonePadGate → signatureSources): the boxes as the ONE source of the ink the phone link carries, and
 *    where a scan writes the scanned ink back.
 */

export interface InkPad {
  color: string;
  lineWidth: number;
  setColor(c: string): void;
  setLineWidth(w: number): void;
  onFollowEnd: (() => void) | null;
}

/** The ink the boxes show; the width box clamped and written back, so the link and the box never disagree. */
function readWidth(widthBox: HTMLInputElement): number {
  const w = parseLineWidth(widthBox.value) ?? PAD_INK_DEFAULT.width;
  widthBox.value = String(w);
  return w;
}

export function bindSignatureInkBoxes(pad: InkPad, widthBox: HTMLInputElement, colorBox: HTMLInputElement): void {
  widthBox.addEventListener('input', () => {
    const w = parseLineWidth(widthBox.value);
    if (w !== null) pad.setLineWidth(w);
  });
  widthBox.addEventListener('change', () => {
    // An emptied box takes back the width the pad draws with (rounded: after a scan it may be a fraction).
    const w = parseLineWidth(widthBox.value) ?? clampLineWidth(pad.lineWidth);
    widthBox.value = String(w);
    pad.setLineWidth(w);
  });
  const onColor = () => pad.setColor(colorBox.value);
  colorBox.addEventListener('input', onColor);
  colorBox.addEventListener('change', onColor);
  pad.onFollowEnd = () => {
    pad.setColor(colorBox.value);
    pad.setLineWidth(readWidth(widthBox));
  };
}

export interface InkSource {
  /** The boxes' ink, plus `cw` = the pad canvas width clamped 200–4000. */
  get(): PadInk;
  /** Write a scanned ink into the boxes (the width rounded and clamped). Fires no event. */
  set(ink: { color: string; width: number }): void;
  /** Run `fn` on a `change` of either box. */
  onChange(fn: () => void): void;
}

export function inkBoxes(widthBox: HTMLInputElement, colorBox: HTMLInputElement, canvas: HTMLCanvasElement): InkSource {
  return {
    get: () => ({
      color: colorBox.value.toLowerCase(),
      width: readWidth(widthBox),
      cw: Math.min(CW_MAX, Math.max(CW_MIN, Math.round(canvas.width))),
    }),
    set: (ink) => {
      colorBox.value = ink.color;
      widthBox.value = String(clampLineWidth(ink.width));
    },
    onChange: (fn) => {
      widthBox.addEventListener('change', fn);
      colorBox.addEventListener('change', fn);
    },
  };
}
