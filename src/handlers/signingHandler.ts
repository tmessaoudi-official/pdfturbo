/**
 * Signing handler — wires the e-signing core (src/signing) into the app.
 *
 * Flow (decision 2026-06-15, "sign WITH edits"): assemble the user's EDITED
 * document via app.assemblePdfBytes() (annotations/overlays/redactions/form-fills
 * baked in — NOT the raw source), produce a single visible PKCS#12/CMS signature
 * with PdfSigner, and download `<base>-signed.pdf`. Output is download-only — no
 * auto-resign (rejected as a security/trust anti-pattern: re-editing a signed PDF
 * must visibly invalidate the signature, never silently re-sign behind the user).
 *
 * 100% client-side: the .p12 bytes + passphrase only ever reach forge in memory;
 * nothing is uploaded. The cert bytes are zeroed in a finally block.
 */
import { PdfSigner, SignError, type SignOptions } from '../signing';
import { generateSelfSignedP12 } from '../signing/certGen';
import { t } from '../utils/i18n';
import type { AppDOMRefs } from '../ui/uiController';
import type { IErrorReporter } from '../contracts/errorReporter';

/**
 * Role-interface the signing handler requires from the app (M2 #18/#19). Decouples
 * it from the concrete PDFTurboApp god-class — it owns the whole sign-modal flow
 * and reaches the app only through this seam. Mirrors the per-component context
 * convention (`ISignatureContext`).
 */
export interface ISigningContext {
  /** Current document filename (drives the `<base>-signed.pdf` output name). */
  readonly currentFilename: string | null;
  /** Read-only DOM handles (sign-modal fields live here). */
  readonly ui: AppDOMRefs;
  /** Structured error reporter (toasts). */
  readonly reportError: IErrorReporter;
  /** Assemble the EDITED document (annotations/redactions/form-fills baked in). */
  assemblePdfBytes(): Promise<Uint8Array>;
  /** Close the sign modal + scrub credential fields. */
  closeSignModal(): void;
}

/** Raw values read from the sign modal. `page` is 1-based as shown in the UI. */
export interface SignFormInput {
  /** PKCS#12 (.p12 / .pfx) container bytes. */
  p12: Uint8Array;
  /** Passphrase protecting the container ('' for none). */
  passphrase: string;
  /** 1-based page number on which to draw the signature (UI-facing). */
  page: number;
  /** Appearance rect, PDF points, bottom-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  reason?: string;
  location?: string;
  name?: string;
}

/**
 * Pure mapping: UI form values → signer {@link SignOptions}. Converts the
 * 1-based UI page number to the signer's 0-based index (clamped ≥ 0) and trims
 * optional strings (empty → undefined). No DOM, no crypto — jsdom-unit-testable.
 */
export function buildSignOptions(form: SignFormInput): SignOptions {
  const clean = (s?: string): string | undefined => {
    const trimmed = (s ?? '').trim();
    return trimmed.length ? trimmed : undefined;
  };
  return {
    p12: form.p12,
    passphrase: form.passphrase,
    page: Math.max(0, Math.floor(form.page) - 1),
    rect: { x: form.x, y: form.y, width: form.width, height: form.height },
    reason: clean(form.reason),
    location: clean(form.location),
    name: clean(form.name),
  };
}

export class SigningHandler {
  constructor(private readonly app: ISigningContext) {}

  /**
   * Drive the whole sign-modal flow (moved out of PDFTurboApp.signPdf — M2 #19):
   * read the form, run cheap required-field guards, assemble the edited document
   * ONCE and run the cert-free preflight BEFORE any certificate work (S-FLOW: a
   * placement / already-signed failure must NOT generate a key or download an
   * orphan .p12), resolve the PKCS#12 material from the chosen source (upload or
   * generate-on-the-spot, downloading the generated .p12/.pem), then sign + close.
   */
  async runSignFlow(): Promise<void> {
    const ui = this.app.ui;
    ui.signError.style.display = 'none';
    const generate = ui.signSourceGenerate.checked;

    // Cheap source-specific required-field checks first (no work to undo).
    const cn = ui.signGenCN.value.trim();
    const genPw = ui.signGenPassword.value;
    const certFile = ui.signCertInput.files?.[0] ?? null;
    if (generate) {
      if (!cn) { this._showSignError('sign.error.NO_CERTIFICATE'); return; }
      if (!genPw) { this.app.reportError.warn('toast.passwordRequired'); return; }
    } else if (!certFile) {
      this._showSignError('sign.error.INVALID_P12');
      return;
    }

    // Parse placement ONCE; reused for both the preflight and the signer form.
    const page1 = parseInt(ui.signPage.value, 10) || 1;
    const rect = {
      x: parseFloat(ui.signX.value) || 0,
      y: parseFloat(ui.signY.value) || 0,
      width: parseFloat(ui.signW.value) || 0,
      height: parseFloat(ui.signH.value) || 0,
    };

    // Assemble + cert-free preflight BEFORE any certificate work (S-FLOW). On a
    // placement / already-signed (or assembly) failure: show the error and bail
    // with the typed passwords still intact for an immediate retry.
    let assembled: Uint8Array;
    try {
      assembled = await this.app.assemblePdfBytes();
      await new PdfSigner().preflight(assembled, Math.max(0, page1 - 1), rect);
    } catch (err) {
      this._showSignError(`sign.error.${err instanceof SignError ? err.code : 'SIGN_FAILED'}`);
      return;
    }

    // Placement is valid — now resolve PKCS#12 material from the chosen source.
    let p12: Uint8Array;
    let passphrase: string;
    let genName: string | undefined;
    ui.runSignModal.disabled = true;
    ui.signProgressRow.style.display = '';

    if (generate) {
      try {
        const gen = await generateSelfSignedP12({
          commonName: cn,
          organization: ui.signGenOrg.value,
          email: ui.signGenEmail.value,
          country: ui.signGenCountry.value,
          validityYears: parseInt(ui.signGenValidity.value, 10) || 1,
        }, genPw);
        // Download the .p12 (key + cert) and .pem (public cert) for reuse / sharing.
        const base = cn.replace(/[^\w.-]+/g, '_') || 'certificate';
        this._downloadBytes(gen.p12, `${base}.p12`, 'application/x-pkcs12');
        this._downloadBytes(new TextEncoder().encode(gen.pem), `${base}.pem`, 'application/x-pem-file');
        p12 = gen.p12; passphrase = genPw; genName = cn;
      } catch (err) {
        this._showSignError(`sign.error.${err instanceof SignError ? err.code : 'SIGN_FAILED'}`);
        ui.runSignModal.disabled = false;
        ui.signProgressRow.style.display = 'none';
        return;
      }
    } else if (certFile) {
      p12 = new Uint8Array(await certFile.arrayBuffer());
      passphrase = ui.signPassword.value;
    } else {
      // Unreachable: a missing file already returned in the early guard above.
      ui.runSignModal.disabled = false;
      ui.signProgressRow.style.display = 'none';
      this._showSignError('sign.error.INVALID_P12');
      return;
    }

    try {
      const signedCn = await this.sign({
        p12,
        passphrase,
        page: page1,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        reason: ui.signReason.value,
        location: ui.signLocation.value,
        name: genName ?? ui.signName.value,
      }, assembled);
      this.app.closeSignModal();
      this.app.reportError.info('toast.signed', { name: signedCn ?? '' });
    } catch (err) {
      this._showSignError(`sign.error.${err instanceof SignError ? err.code : 'SIGN_FAILED'}`);
    } finally {
      ui.runSignModal.disabled = false;
      ui.signProgressRow.style.display = 'none';
      // Clear only the uploaded-cert passphrase here. The generate-mode password is
      // NOT wiped on a failed attempt (S-FLOW): wiping it made a naive retry bail at
      // the `if (!genPw)` guard above while the stale error stayed on screen. It is
      // scrubbed in closeSignModal() on success / modal close instead.
      ui.signPassword.value = '';
    }
  }

  private _showSignError(key: string): void {
    this.app.ui.signError.textContent = t(key);
    this.app.ui.signError.style.display = '';
  }

  /** Trigger a browser download of in-memory bytes (used for generated .p12 / .pem). */
  private _downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Assemble the edited document, sign it with the supplied PKCS#12 material,
   * and download `<base>-signed.pdf`. The .p12 bytes are zeroed in a finally
   * block; the passphrase string cannot be scrubbed (JS strings are immutable) —
   * the caller clears the password input field after this resolves.
   *
   * @param preassembled  Already-assembled document bytes — passed by the app so
   *   it can preflight the SAME bytes before cert generation (S-FLOW) without
   *   re-running `assemblePdfBytes()`. Omitted callers assemble here.
   * @returns the signer common name (CN) on success.
   * @throws {import('../signing').SignError} on any validation/crypto failure.
   */
  async sign(form: SignFormInput, preassembled?: Uint8Array): Promise<string | undefined> {
    try {
      const assembled = preassembled ?? (await this.app.assemblePdfBytes());
      const { bytes, signerCommonName } = await new PdfSigner().sign(
        assembled,
        buildSignOptions(form),
      );
      this._download(bytes, this._signedName());
      return signerCommonName;
    } finally {
      form.p12.fill(0); // scrub cert material from memory
    }
  }

  private _signedName(): string {
    const base = (this.app.currentFilename || 'document').replace(/\.pdf$/i, '');
    return `${base}-signed.pdf`;
  }

  private _download(bytes: Uint8Array, filename: string): void {
    this._downloadBytes(bytes, filename, 'application/pdf');
  }
}
