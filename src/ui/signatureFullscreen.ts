import { browserFullscreen, createFullscreenSession, type FullscreenApi } from '../utils/fullscreenSession';

/** The ✍ pad's shape (height ÷ width), as `openModal` sizes it. */
const PAD_SHAPE = 0.4;

export interface SignatureFullscreenDeps {
  /** `#signatureModal`: gets `sig-full` while full. */
  modal: HTMLElement;
  /** `#sigCanvasBox`: the room the pad may fill, measured while full (the canvas is out of its flow there). */
  box: HTMLElement;
  canvas: HTMLCanvasElement;
  pad: { lineWidth: number; setLineWidth(w: number): void; setSize(w: number, h: number, dpr?: number): void; resetSize(): void };
  enterBtn: HTMLButtonElement;
  exitBtn: HTMLButtonElement;
  /** What full mode hides, made `inert` (the focus trap and assistive tech skip it); read at each entry. */
  hideOnFull: () => HTMLElement[];
  /** Close the phone panel (and its camera): no scan may land mid-stay. A no-op when the panel is shut or absent. */
  closePhonePanel: () => void;
  fullscreen?: FullscreenApi;
}

export interface SignatureFullscreen {
  isFull(): boolean;
  /** Back to the normal dialog; a no-op when not full (Save and every close call it). */
  leave(): void;
  /** How many times its normal width the pad is now: the factor every width handed to the pad takes (1 when not full). */
  widthScale(): number;
}

/**
 * The ✍ dialog's full screen (phone-signature-pad row 11, PC half; rulings 2026-11-12 19:09 and 2026-11-16 11:08).
 * ⛶ turns the dialog into a big pad with only Clear, Exit full screen and Save; the browser's element fullscreen and a
 * landscape lock are asked for where they exist (`fullscreenSession.ts`, shared with the phone pad), the CSS fill is the
 * base. The pad is re-sized with `setSize(w, 0.4w, 1)`: dpr 1 as `openModal` does, because the phone link's `cw` and
 * Save's natural size read `canvas.width`. While full, the pad draws `k` times the box's width (k = full ÷ normal
 * width, re-derived on every re-fit), so the signature looks the same back at the normal size; leaving restores the
 * normal size captured at entry and hands sizing back to the buffer (`resetSize`). Save leaves first (ruling 11:08).
 */
export function bindSignatureFullscreen(d: SignatureFullscreenDeps): SignatureFullscreen {
  const fs = d.fullscreen ?? browserFullscreen;
  let full = false;
  let k = 1;
  let normal = { w: 0, h: 0 };
  let hidden: HTMLElement[] = [];
  const session = createFullscreenSession(fs, () => full);

  const fit = () => {
    if (!full) return;
    const border = d.canvas.offsetWidth - d.canvas.clientWidth; // the canvas's own border, both sides (0 in jsdom)
    const w = Math.floor(Math.min(d.box.clientWidth - border, (d.box.clientHeight - border) / PAD_SHAPE));
    if (w < 1) return; // not laid out yet: keep the current size (setSize refuses it too)
    const next = w / normal.w;
    d.pad.setLineWidth(d.pad.lineWidth * (next / k)); // the ratio to the current k: a scan's exact width is kept
    k = next;
    d.pad.setSize(w, Math.round(w * PAD_SHAPE), 1);
  };

  const enter = () => {
    if (full) return;
    normal = { w: d.canvas.width, h: d.canvas.height };
    full = true;
    d.closePhonePanel();
    d.modal.classList.add('sig-full');
    hidden = d.hideOnFull();
    for (const el of hidden) el.setAttribute('inert', ''); // the attribute: jsdom has no `inert` property, and focusTrap reads [inert]
    d.enterBtn.hidden = true;
    d.exitBtn.hidden = false;
    d.exitBtn.focus();
    fit();
    window.addEventListener('resize', fit);
    session.begin();
  };

  const leave = () => {
    if (!full) return;
    full = false;
    window.removeEventListener('resize', fit);
    const hadFocus = document.activeElement === d.exitBtn;
    d.modal.classList.remove('sig-full');
    for (const el of hidden) el.removeAttribute('inert');
    hidden = [];
    d.exitBtn.hidden = true;
    d.enterBtn.hidden = false;
    d.pad.setLineWidth(d.pad.lineWidth / k);
    k = 1;
    d.pad.setSize(normal.w, normal.h, 1);
    d.pad.resetSize();
    if (hadFocus) d.enterBtn.focus();
    session.end(); // after the page is back to normal, whatever the browser does
  };

  d.enterBtn.addEventListener('click', enter);
  d.exitBtn.addEventListener('click', leave);
  document.addEventListener('fullscreenchange', () => { if (!fs.active()) leave(); });

  return { isFull: () => full, leave, widthScale: () => k };
}
