import { SignaturePad } from '../utils/signaturePad';
import { encodeSignatureFrames, PtsigError } from '../utils/signatureStrokes';
import { drawQr } from '../utils/qrCanvas';
import { strokesToCanvas } from '../utils/signaturePng';
import { t as i18nT, changeLanguage } from '../utils/i18n';
import { isWhite, padInkFromHash, LINE_WIDTH_MAX, LINE_WIDTH_MIN, type PadInk } from '../utils/signatureInk';
import { COLOR_PRESETS, getRecentColors, pushRecentColor } from '../utils/recentColors';

/**
 * The phone signature pad page (pad.html, phone-signature-pad plan step 4). The signer draws with a finger, taps Done,
 * and the page shows the signature as PTSIG QR code(s) for the PC's webcam — 2–4 codes cycle every second — or saves it
 * as a transparent PNG (the no-webcam route). The page sends nothing: what the screen shows, or the PNG the user saves and moves, is the only output.
 * Rulings 2026-11-10 22:41: Download = the signature PNG; a 1 s cycle. The ink (7b, rulings 2026-11-12 09:56 / 10:15)
 * comes from the PC in the fragment (`signatureInk.ts`: colour, a 1–10 width in PC px, the PC canvas width `cw`) and
 * the signer can change it — the shared swatch row without white, a 1–10 stepper; the pad draws at w × padWidth / cw
 * CSS px, and every change repaints every stroke (PTSIG carries one ink). A new link (`hashchange`) re-applies the
 * language and the ink. A link without ink opens black at 2.
 */

export type Translate = (key: string, opts?: Record<string, string | number>) => string;

export interface PadPageOptions {
  /** The device pixel ratio, read at each layout (default `window.devicePixelRatio`). */
  dpr?: () => number;
  /** The translator (default the app's i18next `t`). */
  t?: Translate;
  /** The fragment, read at mount and on every `hashchange` (default `location.hash`). */
  hash?: () => string;
  /** Switch the page language (default the app's `changeLanguage`: re-translates `[data-i18n]`, sets lang/dir). */
  setLanguage?: (lang: string) => unknown;
}

export interface PadPageHandle {
  pad: SignaturePad;
  /** Stop the QR cycle and remove the page's window/document listeners. */
  destroy(): void;
}

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
  const hash = opts.hash ?? (() => location.hash);
  const setLanguage = opts.setLanguage ?? ((lang: string) => changeLanguage(lang));
  let ink: PadInk = padInkFromHash(hash());

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

  // The ink controls. A swatch is named by its hex through `title`, as the editor's toolbar row does (no visible text,
  // so no Label-in-Name risk); the custom swatch and the stepper buttons by translated aria-labels.
  const swatches = labelled(el('div', { 'data-pad': 'swatches', class: 'pad-swatches', role: 'group' }), 'pad.color');
  const picker = el('input', { type: 'color', 'data-pad': 'colorPicker', class: 'pad-picker', tabindex: '-1', 'aria-hidden': 'true' });
  const widthDown = labelled(el('button', { type: 'button', 'data-pad': 'widthDown', class: 'pad-step' }), 'pad.widthDown');
  widthDown.textContent = '−';
  const widthNum = el('span', { 'data-pad': 'width', class: 'pad-width', 'aria-live': 'polite' });
  const widthUp = labelled(el('button', { type: 'button', 'data-pad': 'widthUp', class: 'pad-step' }), 'pad.widthUp');
  widthUp.textContent = '+';
  const stepper = labelled(el('div', { 'data-pad': 'stepper', class: 'pad-stepper', role: 'group' }), 'pad.width');
  stepper.append(widthDown, widthNum, widthUp);
  const controls = el('div', { class: 'pad-ink' });
  controls.append(swatches, stepper, picker);

  drawView.append(el('p', { class: 'pad-hint' }, 'pad.hint'), controls, canvas, error, drawActions); // the hint says "tap Done": draw view only

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

  const pad = new SignaturePad(canvas, { color: ink.color, dotOnTap: true });

  // The drawing room is the root's CONTENT box: clientWidth includes its padding (measured: a 412 px phone overflowed).
  const contentWidth = () => {
    const cs = getComputedStyle(root);
    return root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  // Lay out on a WIDTH change only: a height-only resize is the on-screen keyboard or the URL bar collapsing.
  let laidOutWidth = -1;
  // The link's width is in PC px for a PC canvas `cw` wide; this pad is `laidOutWidth` wide.
  const padLineWidth = () => (ink.width * laidOutWidth) / ink.cw;
  const layout = () => {
    const w = Math.min(contentWidth(), MAX_PAD_PX);
    if (w === laidOutWidth) return;
    laidOutWidth = w;
    pad.setLineWidth(padLineWidth()); // BEFORE setSize, which repaints the strokes in the pad's width
    pad.setSize(w, Math.round(w * PAD_ASPECT), dpr());
    if (!qrView.hidden) show(shown); // a rotation while the QR shows: redraw it for the new width
  };

  /** Every ink change repaints every stroke: what the screen shows is what PTSIG sends (one ink). */
  const applyInk = () => {
    pad.setColor(ink.color);
    pad.setLineWidth(padLineWidth());
    pad.repaint();
    renderSwatches();
    widthNum.textContent = String(ink.width);
    widthDown.disabled = ink.width <= LINE_WIDTH_MIN;
    widthUp.disabled = ink.width >= LINE_WIDTH_MAX;
  };
  function renderSwatches(): void {
    // The shared palette (src/utils/recentColors.ts): the presets, then this phone's recents (the editor writes the same
    // key on this origin), then the link's colour when it is none of them. Never white, whichever way it arrives.
    const seen = new Set<string>();
    const colours: string[] = [];
    for (const hex of [...COLOR_PRESETS, ...getRecentColors(), ink.color]) {
      const norm = hex.toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(norm) || isWhite(norm) || seen.has(norm)) continue;
      seen.add(norm);
      colours.push(norm);
    }
    const buttons = colours.map((hex) => {
      const b = el('button', { type: 'button', class: 'pad-swatch', title: hex, 'aria-pressed': String(hex === ink.color) });
      b.style.background = hex;
      b.addEventListener('click', () => {
        ink = { ...ink, color: hex };
        applyInk();
      });
      return b;
    });
    const custom = labelled(el('button', { type: 'button', 'data-pad': 'customColor', class: 'pad-swatch pad-swatch-custom' }), 'toolbar.customColorTitle');
    custom.addEventListener('click', () => picker.click());
    swatches.replaceChildren(...buttons, custom);
  }
  picker.addEventListener('change', () => {
    const hex = picker.value.toLowerCase();
    if (isWhite(hex)) return; // exact white is never offered (a near-white is: S4, ruling 09:56)
    pushRecentColor(hex);
    ink = { ...ink, color: hex };
    applyInk();
  });
  const step = (d: number) => {
    const w = Math.min(LINE_WIDTH_MAX, Math.max(LINE_WIDTH_MIN, ink.width + d));
    if (w === ink.width) return;
    ink = { ...ink, width: w };
    applyInk();
  };
  widthDown.addEventListener('click', () => step(-1));
  widthUp.addEventListener('click', () => step(1));

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
  applyInk();
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
  const toDrawView = () => {
    stopCycle();
    qrView.hidden = true;
    drawView.hidden = false;
  };
  edit.addEventListener('click', toDrawView);
  // A new link (the PC re-shows its QR after changing language or ink, ruling 2026-11-12 10:15): re-apply both. While
  // the QR shows, back to the draw view — no frame in the old ink stays on screen.
  const onHashChange = () => {
    const h = hash();
    const lang = padLanguageFromHash(h);
    if (lang) void setLanguage(lang);
    ink = padInkFromHash(h);
    if (!qrView.hidden) toDrawView();
    applyInk();
  };
  window.addEventListener('hashchange', onHashChange);
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
      window.removeEventListener('hashchange', onHashChange);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
