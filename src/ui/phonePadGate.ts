// The phonePad flag gate for the ✍ modal's "Sign on phone / Import image" block (phone-signature-pad step 5).
// Flag OFF: #sigSources is removed, so the default app keeps the old modal. Flag ON: it is mounted on the app's
// signature pad, with the modal's close forwarded — that forward is what stops the camera when the modal closes.
// main.ts reads the flag and passes the VALUE (milestone panel round 1, 2026-11-11: this used to be inline in
// main.ts, which no test imports).
import { mountSignatureSources, type SignatureSourcesDeps } from './signatureSources';
import { inkBoxes } from './signatureInkBoxes';

export interface PhonePadGateDeps {
  enabled: boolean;
  doc: Document;
  app: {
    signaturePad: SignatureSourcesDeps['pad'];
    onSignatureModalClosed(fn: () => void): void;
  };
  padUrl: SignatureSourcesDeps['padUrl'];
  mount?: (deps: SignatureSourcesDeps) => unknown;
}

export function applyPhonePadFlag(deps: PhonePadGateDeps): void {
  const root = deps.doc.getElementById('sigSources');
  if (!root) return;
  if (!deps.enabled) {
    root.remove();
    return;
  }
  // The ✍ modal's ink boxes and pad canvas: the phone link carries their ink, and a scan writes them back (7b).
  const width = deps.doc.getElementById('sigLineWidth');
  const color = deps.doc.getElementById('sigColor');
  const canvas = deps.doc.getElementById('signatureCanvas');
  const ink = width instanceof HTMLInputElement && color instanceof HTMLInputElement && canvas instanceof HTMLCanvasElement
    ? inkBoxes(width, color, canvas)
    : undefined;
  (deps.mount ?? mountSignatureSources)({
    root,
    pad: deps.app.signaturePad,
    onModalClosed: (fn) => deps.app.onSignatureModalClosed(fn),
    // The modal's Clear button (bound to the pad by modalBinder) also clears a finished scan's status (step-7 W13).
    onPadCleared: (fn) => deps.doc.getElementById('clearSignature')?.addEventListener('click', fn),
    padUrl: deps.padUrl,
    ink,
  });
}
