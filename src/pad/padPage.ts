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
 * Full screen (plan row 11, phone half; rulings 2026-11-12 19:09 / 23:09 / 23:15): ⛶ hides the title, hint and ink
 * controls and sizes the pad to a MEASURED drawing box (no 600 px cap), keeping PAD_ASPECT. The CSS fill is the base —
 * iPhone Safari has no element fullscreen; where the Fullscreen API exists the page also asks for it, then a landscape
 * lock. Exit, Done and the browser leaving fullscreen (Android back, Esc) all return to the normal page; Done leaves
 * FIRST, so the QR and a too-large error show on the normal page.
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
  /** The Fullscreen API and the orientation lock (default the browser's: `browserFullscreen`). */
  fullscreen?: FullscreenApi;
  /** The viewport size, for the rotate hint (default `innerWidth` × `innerHeight`). */
  viewport?: () => { width: number; height: number };
}

export interface FullscreenApi {
  /** The page may ask for element fullscreen (false on iPhone Safari: the CSS fill alone). */
  enabled(): boolean;
  request(): Promise<unknown>;
  exit(): Promise<unknown>;
  /** An element is fullscreen now. */
  active(): boolean;
  lockLandscape(): Promise<unknown>;
  unlock(): void;
}

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

/** The browser's Fullscreen API on the whole page, and the screen orientation lock where the browser has one. */
export const browserFullscreen: FullscreenApi = {
  enabled: () => document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function',
  request: () => document.documentElement.requestFullscreen({ navigationUI: 'hide' }),
  exit: () => document.exitFullscreen(),
  // `fullscreenElement` does not exist where the API does not (iPhone Safari): undefined is not fullscreen either.
  active: () => Boolean(document.fullscreenElement),
  lockLandscape: () => (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape') ?? Promise.resolve(),
  unlock: () => (screen.orientation as LockableOrientation | undefined)?.unlock?.(),
};

export interface PadPageHandle {
  pad: SignaturePad;
  /** Stop the QR cycle and remove the page's window/document listeners. */
  destroy(): void;
}

const MAX_PAD_PX = 600;
const PAD_ASPECT = 0.4; // the ✍ modal's canvas shape, so a replay on the PC fills it
const MAX_QR_PX = 480;
const QR_BOTTOM_PX = 12; // kept free below the QR when the screen's height is what limits it
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
  const fs = opts.fullscreen ?? browserFullscreen;
  const viewport = opts.viewport ?? (() => ({ width: window.innerWidth, height: window.innerHeight }));
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
  // Two buttons, each with its own key, so a language change while full re-translates both correctly.
  const enterFs = el('button', { type: 'button', 'data-pad': 'fullscreen' }, 'pad.fullscreen');
  const exitFs = el('button', { type: 'button', 'data-pad': 'exitFullscreen' }, 'pad.exitFullscreen');
  exitFs.hidden = true;
  const rotateHint = el('p', { 'data-pad': 'rotateHint', class: 'pad-rotate' }, 'pad.rotateHint');
  rotateHint.hidden = true;
  // The drawing box: in full mode it takes the room left by the rest and is MEASURED; the canvas inside cannot feed
  // that measurement (pad.css positions it absolutely there).
  const box = el('div', { 'data-pad': 'box', class: 'pad-box' });
  const drawView = el('section', { 'data-pad-view': 'draw' });
  const drawActions = el('div', { class: 'pad-actions' });
  drawActions.append(clear, enterFs, exitFs, done);

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

  box.append(canvas);
  drawView.append(el('p', { class: 'pad-hint' }, 'pad.hint'), controls, rotateHint, box, error, drawActions); // the hint says "tap Done": draw view only

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
  // Normal mode lays out on a WIDTH change only: a height-only resize is the on-screen keyboard or the URL bar
  // collapsing. Full mode shows no text input, so there the box's height counts too.
  let laidOutWidth = -1;
  let full = false;
  // The link's width is in PC px for a PC canvas `cw` wide; this pad is `laidOutWidth` wide.
  const padLineWidth = () => (ink.width * laidOutWidth) / ink.cw;
  const padWidth = () => {
    if (!full) return Math.min(contentWidth(), MAX_PAD_PX);
    const vp = viewport();
    rotateHint.hidden = !(vp.height > vp.width); // BEFORE the box is measured: the hint takes room from it
    return Math.max(1, Math.floor(Math.min(box.clientWidth, box.clientHeight / PAD_ASPECT)));
  };
  const layout = () => {
    const w = padWidth();
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

  // Whether THIS stay in full mode asked the browser for fullscreen: only then is there anything to undo on leaving
  // (the CSS-only path — iPhone Safari — never calls unlock or exit).
  let requested = false;
  // Whether a landscape lock RESOLVED during this stay: unlock() follows only that, never a refused lock (a desktop, a
  // Safari) — Done calls leaveFull before the QR shows, and unlock() was never measured on an engine that refuses lock().
  let locked = false;
  const enterFull = () => {
    if (full) return;
    full = true;
    root.classList.add('pad-full');
    enterFs.hidden = true;
    exitFs.hidden = false;
    exitFs.focus();
    window.scrollTo(0, 0); // the normal page is taller than a landscape phone: start at the top
    layout();
    if (!fs.enabled()) return; // iPhone Safari: the CSS fill alone
    requested = true;
    fs.request()
      .then(() => {
        // Read the state AT the grant: left meanwhile → give the fullscreen back; in full mode (still, or entered
        // again before this grant) → lock. Never lock under the normal page.
        if (!full) return fs.exit();
        return fs.lockLandscape().then(() => {
          if (full) locked = true;
          else fs.unlock(); // left while the lock was pending: release it now
        });
      })
      // Refused or unsupported (measured in Chrome: requestFullscreen without a user gesture rejects, and lock() on a
      // desktop rejects NotSupportedError — pad-fullscreen.browser.test.ts): the CSS fill stays, which is the base.
      .catch(() => {});
  };
  const leaveFull = () => {
    if (!full) return;
    full = false;
    const hadFocus = document.activeElement === exitFs;
    root.classList.remove('pad-full');
    exitFs.hidden = true;
    enterFs.hidden = false;
    rotateHint.hidden = true;
    if (hadFocus) enterFs.focus();
    layout(); // before the platform calls: the page is back to normal whatever they do
    if (!requested) return;
    requested = false;
    if (locked) fs.unlock();
    locked = false;
    if (fs.active()) void fs.exit(); // the check and the call share one task: the browser cannot leave in between
  };
  enterFs.addEventListener('click', enterFull);
  exitFs.addEventListener('click', leaveFull);
  const onFullscreenChange = () => { if (!fs.active()) leaveFull(); };
  document.addEventListener('fullscreenchange', onFullscreenChange);

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
  // The QR fits the width AND the room below its top: on a landscape phone (the usual state after a full-screen Done) a
  // 480 px QR runs off a 360 px screen, and a QR cut off cannot be scanned (plan row 11, ruling 2026-11-12 23:15).
  const qrSide = () => {
    const top = qr.getBoundingClientRect().top + window.scrollY;
    return Math.max(1, Math.min(contentWidth(), MAX_QR_PX, viewport().height - top - QR_BOTTOM_PX));
  };
  let shownSide = -1;
  const show = (i: number) => {
    shown = i;
    shownSide = qrSide();
    drawQr(qr, frames[i], shownSide, dpr());
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
  // A height-only change can shrink the QR's room while the pad's width stays (the browser bars returning after a
  // full-screen Done): re-fit the QR whenever its side changed, apart from the pad's width-keyed layout.
  const onResize = () => {
    layout();
    if (!qrView.hidden && qrSide() !== shownSide) show(shown);
  };
  window.addEventListener('resize', onResize);

  done.addEventListener('click', () => {
    leaveFull(); // FIRST: the QR, or the too-large error, shows on the normal page (ruling 23:15)
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
    if (window.scrollY > 0) window.scrollTo(0, 0); // the QR's room is measured from the page top
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
      window.removeEventListener('resize', onResize);
      window.removeEventListener('hashchange', onHashChange);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    },
  };
}
