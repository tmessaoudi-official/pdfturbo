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

/**
 * The boxes drive the pad. `scale` (row 11 PC half) is how many times its normal width the pad is now — the ✍ dialog's
 * full screen — so every width handed to the pad is the box's × scale, and an emptied box takes back the pad's width
 * ÷ scale: the box always shows normal-size px. Default 1.
 */
export function bindSignatureInkBoxes(pad: InkPad, widthBox: HTMLInputElement, colorBox: HTMLInputElement, scale: () => number = () => 1): void {
  widthBox.addEventListener('input', () => {
    const w = parseLineWidth(widthBox.value);
    if (w !== null) pad.setLineWidth(w * scale());
  });
  widthBox.addEventListener('change', () => {
    // An emptied box takes back the width the pad draws with (rounded: after a scan it may be a fraction).
    const w = parseLineWidth(widthBox.value) ?? clampLineWidth(pad.lineWidth / scale());
    widthBox.value = String(w);
    pad.setLineWidth(w * scale());
  });
  const onColor = () => pad.setColor(colorBox.value);
  colorBox.addEventListener('input', onColor);
  colorBox.addEventListener('change', onColor);
  pad.onFollowEnd = () => {
    pad.setColor(colorBox.value);
    pad.setLineWidth(readWidth(widthBox) * scale());
  };
}

/** Fired on the colour box by `inkBoxes().set` (a scan): a programmatic `.value` fires no event, and `input`/`change`
 * would loop back into the pad and the phone link — this one only tells the swatch row to re-render (row 10). */
export const INK_SET_EVENT = 'pdfturbo-ink-set';

export interface InkSource {
  /** The boxes' ink, plus `cw` = the pad canvas width clamped 200–4000. */
  get(): PadInk;
  /** Write a scanned ink into the boxes (the width rounded and clamped). Fires no `input`/`change` — only INK_SET_EVENT. */
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
      colorBox.dispatchEvent(new Event(INK_SET_EVENT));
    },
    onChange: (fn) => {
      widthBox.addEventListener('change', fn);
      colorBox.addEventListener('change', fn);
    },
  };
}
