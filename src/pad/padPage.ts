import { SignaturePad } from '../utils/signaturePad';
import { encodeSignatureFrames, PtsigError } from '../utils/signatureStrokes';
import { drawQr } from '../utils/qrCanvas';
import { strokesToCanvas } from '../utils/signaturePng';
import { t as i18nT } from '../utils/i18n';

/**
 * The phone signature pad page (pad.html, phone-signature-pad plan step 4). The signer draws with a finger, taps Done,
 * and the page shows the signature as PTSIG QR code(s) for the PC's webcam — 2–4 codes cycle every second — or saves it
 * as a transparent PNG (the no-webcam route). The page sends nothing: what the screen shows, or the PNG the user saves and moves, is the only output.
 * Rulings 2026-11-10 22:41: ink locked to black 2.5 CSS px; Download = the signature PNG; a 1 s cycle.
 */

export type Translate = (key: string, opts?: Record<string, string | number>) => string;

export interface PadPageOptions {
  /** The device pixel ratio, read at each layout (default `window.devicePixelRatio`). */
  dpr?: () => number;
  /** The translator (default the app's i18next `t`). */
  t?: Translate;
}

export interface PadPageHandle {
  pad: SignaturePad;
  /** Stop the QR cycle and remove the page's window/document listeners. */
  destroy(): void;
}

const INK = '#000000';
const LINE_WIDTH = 2.5;
const MAX_PAD_PX = 600;
const PAD_ASPECT = 0.4; // the ✍ modal's canvas shape, so a replay on the PC fills it
const MAX_QR_PX = 480;
const CYCLE_MS = 1000;

/** The language the PC handed over in the pad URL's fragment (`#lang=fr`, step 5a): one of the app's three, else null. */
export function padLanguageFromHash(hash: string): 'en' | 'fr' | 'ar' | null {
  const lang = new URLSearchParams(hash.replace(/^#/, '')).get('lang');
  return lang === 'en' || lang === 'fr' || lang === 'ar' ? lang : null;
}

export function mountPadPage(root: HTMLElement, opts: PadPageOptions = {}): PadPageHandle {
  const dpr = opts.dpr ?? (() => window.devicePixelRatio);
  const t = opts.t ?? i18nT;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, i18n?: string): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (i18n) {
      e.dataset.i18n = i18n;
      e.textContent = t(i18n);
    }
    return e;
  };
  const labelled = <E extends HTMLElement>(e: E, key: string): E => {
    e.dataset.i18nAria = key;
    e.setAttribute('aria-label', t(key));
    return e;
  };

  const canvas = labelled(el('canvas', { 'data-pad': 'canvas', class: 'pad-canvas', role: 'img' }), 'pad.canvasLabel');
  const error = el('p', { 'data-pad': 'error', class: 'pad-error', role: 'alert' }, 'pad.tooComplex');
  error.hidden = true;
  const clear = el('button', { type: 'button', 'data-pad': 'clear' }, 'pad.clear');
  const done = el('button', { type: 'button', 'data-pad': 'done', class: 'pad-primary' }, 'pad.done');
  done.disabled = true;
  const drawView = el('section', { 'data-pad-view': 'draw' });
  const drawActions = el('div', { class: 'pad-actions' });
  drawActions.append(clear, done);
  drawView.append(el('p', { class: 'pad-hint' }, 'pad.hint'), canvas, error, drawActions); // the hint says "tap Done": draw view only

  const qr = labelled(el('canvas', { 'data-pad': 'qr', class: 'pad-qr', role: 'img' }), 'pad.qrLabel');
  const count = el('p', { 'data-pad': 'count', class: 'pad-count', 'aria-live': 'polite' });
  count.hidden = true;
  const edit = el('button', { type: 'button', 'data-pad': 'edit' }, 'pad.edit');
  const download = el('button', { type: 'button', 'data-pad': 'download', class: 'pad-primary' }, 'pad.download');
  const qrView = el('section', { 'data-pad-view': 'qr' });
  const qrActions = el('div', { class: 'pad-actions' });
  qrActions.append(edit, download);
  qrView.append(qr, count, el('p', { class: 'pad-hint' }, 'pad.scanHint'), qrActions);
  qrView.hidden = true;

  root.classList.add('pad-page');
  root.append(el('h1', {}, 'pad.title'), drawView, qrView);

  const pad = new SignaturePad(canvas, { color: INK, lineWidth: LINE_WIDTH, dotOnTap: true });

  // The drawing room is the root's CONTENT box: clientWidth includes its padding (measured: a 412 px phone overflowed).
  const contentWidth = () => {
    const cs = getComputedStyle(root);
    return root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  // Lay out on a WIDTH change only: a height-only resize is the on-screen keyboard or the URL bar collapsing.
  let laidOutWidth = -1;
  const layout = () => {
    const w = Math.min(contentWidth(), MAX_PAD_PX);
    if (w === laidOutWidth) return;
    laidOutWidth = w;
    pad.setSize(w, Math.round(w * PAD_ASPECT), dpr());
    if (!qrView.hidden) show(shown); // a rotation while the QR shows: redraw it for the new width
  };

  const refreshDone = () => { done.disabled = pad.getStrokes().length === 0; };
  canvas.addEventListener('pointerdown', refreshDone); // after the pad's own listener: the stroke already exists
  clear.addEventListener('click', () => {
    pad.clear();
    error.hidden = true;
    refreshDone();
  });

  let frames: string[] = [];
  let shown = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const show = (i: number) => {
    shown = i;
    drawQr(qr, frames[i], Math.min(contentWidth(), MAX_QR_PX), dpr());
    count.hidden = frames.length < 2;
    if (!count.hidden) count.textContent = t('pad.qrCount', { index: i + 1, total: frames.length });
  };
  const stopCycle = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const startCycle = () => {
    stopCycle();
    if (frames.length > 1 && !qrView.hidden && document.visibilityState !== 'hidden')
      timer = setInterval(() => show((shown + 1) % frames.length), CYCLE_MS);
  };

  layout();
  window.addEventListener('resize', layout);

  done.addEventListener('click', () => {
    try {
      frames = encodeSignatureFrames(pad.toSignatureInput()).frames;
    } catch (e) {
      if (e instanceof PtsigError && e.code === 'too-large') {
        error.hidden = false;
        return;
      }
      throw e;
    }
    error.hidden = true;
    drawView.hidden = true;
    qrView.hidden = false;
    show(0);
    startCycle();
  });
  edit.addEventListener('click', () => {
    stopCycle();
    qrView.hidden = true;
    drawView.hidden = false;
  });
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') stopCycle();
    else startCycle();
  };
  document.addEventListener('visibilitychange', onVisibility);

  download.addEventListener('click', () => {
    const png = strokesToCanvas(pad.getStrokes(), { color: pad.color, lineWidth: pad.lineWidth, scale: dpr() });
    if (!png) return; // unreachable: Download is only shown after Done, which needs a stroke
    const a = document.createElement('a');
    a.href = png.toDataURL('image/png');
    a.download = 'signature.png';
    a.click();
  });

  return {
    pad,
    destroy: () => {
      stopCycle();
      window.removeEventListener('resize', layout);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
