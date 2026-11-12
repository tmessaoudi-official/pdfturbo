import { drawQr } from '../utils/qrCanvas';
import { loadSignatureImage, SignatureImageError } from '../utils/signatureImage';
import { t as i18nT } from '../utils/i18n';
import { createPtsigCollector } from '../utils/ptsigCollector';
import type { DecodedSignature } from '../utils/signatureStrokes';
import { padInkFragment, type PadInk } from '../utils/signatureInk';
import type { InkSource } from './signatureInkBoxes';
import { startScan, type ScanDeps, type ScanEnd, type ScanHandle } from './qrScanner';

/**
 * The ✍ modal's other signature sources (phone-signature-pad plan step 5; rulings 2026-11-10 23:46): two buttons.
 *  - **Sign on phone** opens one panel: a QR of the phone pad's URL (the PC's language in its fragment), the URL as
 *    text, and the "accept Update" note for a phone still on an older version. **Start camera** (step 5b) reads the
 *    phone's signature QR codes (`qrScanner` → `ptsigCollector`) and replays the signature on the pad; it never saves.
 *    While the camera runs its preview takes the QR's box (ruling 2026-11-11). Every way out stops the camera: Stop,
 *    a modal close (Cancel, Escape, Save), the panel collapsed, an import starting, a scan accepted.
 *  - **Import image** loads an image (`loadSignatureImage`: caps, paper removed — or its own alpha kept when it is mostly transparent — trimmed) onto the pad.
 * The link carries the PC's ink (7b commit B): the ✍ modal's colour and width boxes, injected as `ink`, read at each QR
 * draw and re-drawn on a box change; after a scan the boxes take the scanned ink (the pad keeps the exact width).
 * Whatever arrives lands on `signatureCanvas`, and the existing Save takes it. Bound to the static `#sigSources` markup
 * of index.html; `phonePadGate.ts` removes that markup when the `phonePad` flag is off. A refused image or a camera failure is
 * SHOWN in the modal and never logged (the QA sweep fails on a console error); a loader bug is not a refusal and is
 * not caught here. Scan progress goes to a polite status line, failures to the alert.
 */

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface SignatureSourcesDeps {
  /** The `#sigSources` element. */
  root: HTMLElement;
  /** The ✍ modal pad. A replay sets its ink to the scanned one, read back here for the boxes. */
  pad: { drawImage(img: HTMLCanvasElement): void; replay(sig: DecodedSignature): void; readonly color: string; readonly lineWidth: number };
  /** Register `fn` to run on every close of the ✍ modal (cancelled or saved). */
  onModalClosed(fn: () => void): void;
  /** Register `fn` to run when the modal's Clear button empties the pad (a scan's status must not outlive the pad). */
  onPadCleared?(fn: () => void): void;
  /** The phone pad's URL with `ink` in its fragment, read at each draw (the language or the ink may have changed). */
  padUrl(ink?: PadInk): string;
  /** The ✍ modal's ink boxes (`inkBoxes`). Absent: the link carries no ink, and the pad opens black. */
  ink?: InkSource;
  loadImage?(file: File): Promise<HTMLCanvasElement>;
  scan?(deps: ScanDeps): ScanHandle;
  t?: Translate;
  dpr?: () => number;
}

export interface SignatureSourcesHandle {
  /** The import in progress, or a resolved promise. It rejects with a loader BUG (never with a refused image). */
  whenIdle(): Promise<void>;
}

const PAD_QR_CSS_PX = 180;

/**
 * The pad URL under the app's base path; the language — and since 7b the ink — go in the FRAGMENT, so a cached
 * `pad.html` still matches.
 */
export function padUrlFor(origin: string, base: string, lang: string, ink?: PadInk): string {
  const url = `${new URL('pad.html', new URL(base, origin)).href}#lang=${encodeURIComponent(lang)}`;
  return ink ? `${url}&${padInkFragment(ink)}` : url;
}

export function mountSignatureSources(deps: SignatureSourcesDeps): SignatureSourcesHandle {
  const t = deps.t ?? i18nT;
  const dpr = deps.dpr ?? (() => window.devicePixelRatio);
  const load = deps.loadImage ?? ((f: File) => loadSignatureImage(f));
  const $ = <E extends HTMLElement>(id: string): E => {
    const e = deps.root.querySelector<E>(`#${id}`);
    if (!e) throw new Error(`#sigSources has no #${id}`);
    return e;
  };
  const phoneBtn = $<HTMLButtonElement>('sigPhoneBtn');
  const panel = $('sigPhonePanel');
  const qr = $<HTMLCanvasElement>('sigPadQr');
  const urlText = $('sigPadUrl');
  const importBtn = $<HTMLButtonElement>('sigImportBtn');
  const input = $<HTMLInputElement>('sigImageInput');
  const msg = $('sigSourceMsg');
  const camBtn = $<HTMLButtonElement>('sigCamBtn');
  const camLabel = $('sigCamLabel');
  const video = $<HTMLVideoElement>('sigCamVideo');
  const status = $('sigScanStatus');
  const scan = deps.scan ?? startScan;

  const showMessage = (key: string | null) => {
    msg.hidden = key === null;
    msg.textContent = key === null ? '' : t(key);
  };
  // Written only when the text changes: the camera reads one code many times, and a live region re-announces a rewrite.
  const setStatus = (key: string | null, params?: Record<string, string | number>) => {
    const text = key === null ? '' : t(key, params);
    if (status.textContent !== text) status.textContent = text;
  };
  const setCamLabel = (key: string) => {
    camLabel.dataset.i18n = key; // a language switch re-translates the CURRENT label
    camLabel.textContent = t(key);
  };

  // A close, a scan accepted or a new import advances the epoch: an import still loading is then dropped, not drawn
  // over the pad's new content.
  let epoch = 0;
  let camera: ScanHandle | null = null;
  const collector = createPtsigCollector();

  const showCamera = (on: boolean) => {
    video.hidden = !on;
    qr.hidden = on;
    setCamLabel(on ? 'modal.signature.stopCamera' : 'modal.signature.startCamera');
  };
  const stopCamera = () => {
    camera?.stop(); // its onEnd resets the UI
  };
  const onScanEnd = (end: ScanEnd) => {
    camera = null;
    showCamera(false);
    if (end.reason === 'error') {
      setStatus(null);
      showMessage(`modal.signature.scanError.${end.error}`);
    } else if (end.reason === 'stopped') {
      setStatus(null);
    }
  };
  const onText = (text: string): boolean => {
    const ev = collector.feed(text);
    switch (ev.kind) {
      case 'done':
        epoch++;
        deps.pad.replay(ev.sig);
        if (deps.ink) {
          // The boxes follow the scan (ruling 2026-11-12 09:56). A programmatic .value fires no event: re-draw here.
          deps.ink.set({ color: deps.pad.color, width: deps.pad.lineWidth });
          drawPadQr();
        }
        setStatus('modal.signature.scanDone');
        return true;
      case 'progress':
        setStatus(ev.total > 1 ? 'modal.signature.scanPart' : 'modal.signature.scanLooking', { have: ev.have, total: ev.total });
        return false;
      case 'refresh':
        setStatus('modal.signature.scanRefresh');
        return false;
      case 'foreign':
        setStatus('modal.signature.scanForeign');
        return false;
      case 'dropped':
        setStatus('modal.signature.scanLooking');
        return false;
    }
  };
  const startCamera = () => {
    collector.reset();
    showMessage(null);
    setStatus('modal.signature.scanLooking');
    showCamera(true);
    // The scan may end INSIDE scan() (no camera API at all: an http page): onEnd has then already run, and the handle
    // it returns is dead — storing it would turn every later click into a stop() that does nothing.
    let ended = false;
    const handle = scan({ video, onText, onEnd: (end) => { ended = true; onScanEnd(end); } });
    if (!ended) camera = handle;
  };
  camBtn.addEventListener('click', () => (camera ? stopCamera() : startCamera()));

  function drawPadQr(): void {
    const url = deps.padUrl(deps.ink?.get());
    drawQr(qr, url, PAD_QR_CSS_PX, dpr(), 'Byte');
    urlText.textContent = url;
  }
  const setPanel = (open: boolean) => {
    if (!open) stopCamera();
    if (open) drawPadQr();
    panel.hidden = !open;
    phoneBtn.setAttribute('aria-expanded', String(open));
  };
  deps.ink?.onChange(() => {
    if (!panel.hidden) drawPadQr();
  });

  phoneBtn.addEventListener('click', () => setPanel(panel.hidden !== false)); // hidden is boolean | 'until-found'
  importBtn.addEventListener('click', () => input.click());

  let pending: Promise<void> = Promise.resolve();
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = ''; // the same file can be picked again after a refusal
    if (!file) return;
    stopCamera();
    setStatus(null); // a finished scan's "Signature scanned" described the pad this import replaces (step-7 W13)
    const mine = ++epoch;
    importBtn.disabled = true;
    pending = (async () => {
      try {
        const img = await load(file);
        if (mine !== epoch) return;
        deps.pad.drawImage(img);
        showMessage(null);
      } catch (e) {
        if (!(e instanceof SignatureImageError)) throw e;
        if (mine === epoch) showMessage(`modal.signature.importError.${e.code}`);
      } finally {
        importBtn.disabled = false;
      }
    })();
  });

  // Clear empties the pad: a finished scan's status goes with it; a scan still running keeps its progress line.
  deps.onPadCleared?.(() => {
    if (!camera) setStatus(null);
  });

  deps.onModalClosed(() => {
    epoch++;
    setPanel(false);
    showMessage(null);
    setStatus(null);
  });

  return { whenIdle: () => pending };
}
