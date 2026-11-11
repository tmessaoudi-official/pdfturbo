import { drawQr } from '../utils/qrCanvas';
import { loadSignatureImage, SignatureImageError } from '../utils/signatureImage';
import { t as i18nT } from '../utils/i18n';

/**
 * The ✍ modal's other signature sources (phone-signature-pad plan step 5; rulings 2026-11-10 23:46): two buttons.
 *  - **Sign on phone** opens one panel: a QR of the phone pad's URL (the PC's language in its fragment), the URL as
 *    text, and the "accept Update" note for a phone still on an older version. Step 5b adds the camera to this panel.
 *  - **Import image** loads an image (`loadSignatureImage`: caps, paper removed, trimmed) onto the pad.
 * Whatever arrives lands on `signatureCanvas`, and the existing Save takes it. Bound to the static `#sigSources` markup
 * of index.html; main.ts removes that markup when the `phonePad` flag is off. A refused image is SHOWN in the modal and
 * never logged (the QA sweep fails on a console error); a loader bug is not a refusal and is not caught here.
 */

export type Translate = (key: string) => string;

export interface SignatureSourcesDeps {
  /** The `#sigSources` element. */
  root: HTMLElement;
  pad: { drawImage(img: HTMLCanvasElement): void };
  /** Register `fn` to run on every close of the ✍ modal (cancelled or saved). */
  onModalClosed(fn: () => void): void;
  /** The phone pad's URL, read at each open (the language may have changed). */
  padUrl(): string;
  loadImage?(file: File): Promise<HTMLCanvasElement>;
  t?: Translate;
  dpr?: () => number;
}

export interface SignatureSourcesHandle {
  /** The import in progress, or a resolved promise. It rejects with a loader BUG (never with a refused image). */
  whenIdle(): Promise<void>;
}

const PAD_QR_CSS_PX = 180;

/** The pad URL under the app's base path; the language goes in the FRAGMENT, so a cached `pad.html` still matches. */
export function padUrlFor(origin: string, base: string, lang: string): string {
  return `${new URL('pad.html', new URL(base, origin)).href}#lang=${encodeURIComponent(lang)}`;
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

  const showMessage = (key: string | null) => {
    msg.hidden = key === null;
    msg.textContent = key === null ? '' : t(key);
  };
  const setPanel = (open: boolean) => {
    if (open) {
      const url = deps.padUrl();
      drawQr(qr, url, PAD_QR_CSS_PX, dpr(), 'Byte');
      urlText.textContent = url;
    }
    panel.hidden = !open;
    phoneBtn.setAttribute('aria-expanded', String(open));
  };

  phoneBtn.addEventListener('click', () => setPanel(panel.hidden !== false)); // hidden is boolean | 'until-found'
  importBtn.addEventListener('click', () => input.click());

  // A close advances the epoch: an import still loading when the modal closes is dropped, not drawn on a closed pad.
  let epoch = 0;
  let pending: Promise<void> = Promise.resolve();
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = ''; // the same file can be picked again after a refusal
    if (!file) return;
    const mine = epoch;
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

  deps.onModalClosed(() => {
    epoch++;
    setPanel(false);
    showMessage(null);
  });

  return { whenIdle: () => pending };
}
