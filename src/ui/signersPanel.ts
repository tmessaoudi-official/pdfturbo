import type { AppDOMRefs } from './uiController';
import type { IErrorReporter } from '../core/errorReporter';
import type { ToolMode } from '../types/tools';
import type { SignatureCaption } from '../elements/signatureElement';
import { trapFocus } from '../utils/focusTrap';
import { t } from '../utils/i18n';

/**
 * F-D D2 — Guided "Signers" panel. Captures an approval identity (signer name +
 * editable "Lu et approuvé" mention + optional date) BEFORE the signature is
 * drawn, so the placed SignatureElement carries the D1 caption. Repeat per
 * signer — the PAGE itself is the roster (each placed signature is a real,
 * selectable/deletable element). Mirrors BatesPanel: own focus-trap, no preview.
 *
 * Remote round-robin (no backend): each signer draws → exports (D1 bakes the
 * signature into the page content) → passes the file to the next, who opens it
 * and adds theirs. The 🔏 cryptographic seal is applied ONCE, LAST — any
 * re-export after sealing invalidates it. Visible approval signatures are
 * approval-stamp grade, NOT tamper-evident (see the panel hint string).
 */

/** Pad a one-digit month/day to two characters. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local-calendar ISO date `YYYY-MM-DD` — the caption's display date string. */
export function isoDate(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/**
 * Pure: form fields → approval caption, or `null` when nothing identifying was
 * entered (so an empty panel degrades to a plain, caption-free signature).
 * `includeDate` stamps today's date via the injected `now`.
 */
export function buildSignerCaption(
  name: string,
  mention: string,
  includeDate: boolean,
  now: Date,
): SignatureCaption | null {
  const signer = name.trim();
  const m = mention.trim();
  if (!signer && !m) return null;
  const caption: SignatureCaption = {};
  if (signer) caption.signer = signer;
  if (m) caption.mention = m;
  if (includeDate) caption.signedDate = isoDate(now);
  return caption;
}

export interface ISignersContext {
  readonly ui: AppDOMRefs;
  readonly reportError: IErrorReporter;
  setPendingSignatureCaption(c: SignatureCaption | null): void;
  setMode(mode: ToolMode): void;
  /** Injectable clock for deterministic tests; the app returns `new Date()`. */
  now(): Date;
}

export class SignersPanel {
  private _trapCleanup: (() => void) | null = null;

  constructor(private readonly _ctx: ISignersContext) {}

  open(): void {
    const ui = this._ctx.ui;
    ui.signerName.value = '';
    ui.signerMention.value = t('modal.signers.mentionDefault');
    ui.signerDate.checked = true;
    ui.signersModal.classList.add('active');
    this._trapCleanup?.();
    this._trapCleanup = trapFocus(
      ui.signersModal.querySelector('.code-modal-content') as HTMLElement,
      ui.signersBtn,
    );
  }

  close(): void {
    this._ctx.ui.signersModal.classList.remove('active');
    this._trapCleanup?.();
    this._trapCleanup = null;
  }

  /**
   * Capture the caption, close the panel, and arm the existing draw→place flow.
   * `setMode('addSignature')` opens the signature pad (toolModeService side
   * effect); on Save the placed SignatureElement reads this pending caption in
   * PlacementManager. Going through `setMode` directly (not a ✍ button click)
   * means the toolBinder/keyboardBinder caption-clear guard does NOT fire here.
   */
  draw(): void {
    const ui = this._ctx.ui;
    const caption = buildSignerCaption(
      ui.signerName.value,
      ui.signerMention.value,
      ui.signerDate.checked,
      this._ctx.now(),
    );
    this._ctx.setPendingSignatureCaption(caption);
    this.close();
    this._ctx.setMode('addSignature');
  }
}
