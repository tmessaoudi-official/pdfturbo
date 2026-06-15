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
import type { PDFTurboApp } from '../core/pdfTurboApp';
import { PdfSigner, type SignOptions } from '../signing';

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
    const t = (s ?? '').trim();
    return t.length ? t : undefined;
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
  constructor(private readonly app: PDFTurboApp) {}

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
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
