/**
 * Two-mode multi-signature orchestration (spike-grade).
 *
 * ⚠️ EXPERIMENTAL / NOT WIRED INTO THE APP — companion to {@link addIncrementalSignature}
 * and {@link verifyAllSignatures}. Kept out of the `index.ts` barrel so it never enters
 * the shipped surface. Wiring ANY of this into the UI is gated on real Adobe/DSS
 * acceptance of a multi-signed output (no Acrobat in-repo) — see the spike verdict.
 *
 * Drives the proven engine — a {@link PdfSigner} visible baseline for signature 1, then
 * {@link addIncrementalSignature} append-only updates for signatures 2..N — in two
 * HONEST modes:
 *
 *   • 'separate' — N independent certificates. Each signature validates against its OWN
 *     embedded signer cert. This is true multi-party signing with per-signer
 *     non-repudiation.
 *   • 'shared'   — ONE credential, applied N times. This is a SINGLE identity signing
 *     repeatedly (an organization/role seal, page initials, or revision locks) — NOT N
 *     people cryptographically bound under one key (the file cannot prove that, and we
 *     do not pretend it can). The distinction between placements lives only in each
 *     signature's `/Name` + `/Reason` and the visible appearance.
 *
 * The request type encodes that honesty STRUCTURALLY: shared mode carries one
 * `credential` + N `placements`; separate mode carries N full `signers`.
 */

import { PdfSigner } from './pdfSigner';
import { addIncrementalSignature } from './incrementalSigner';
import { verifyAllSignatures, type SignatureCheck } from './cmsVerify';
import { loadP12, scrubP12Material } from './p12';
import { SignError, type SignatureRect } from './types';

/** Where a signature is drawn + the metadata it carries (no credential). */
export interface SignerPlacement {
  /** Zero-based page index. */
  page: number;
  /** Appearance rectangle (points, bottom-left origin). */
  rect: SignatureRect;
  /** Signer name written into the signature dictionary / appearance. */
  name?: string;
  /** Optional reason string. */
  reason?: string;
}

/** A placement plus its OWN credential (separate mode). */
export interface SeparateSigner extends SignerPlacement {
  /** Raw PKCS#12 (.p12) container bytes for THIS signer. */
  p12: Uint8Array;
  /** Passphrase for this signer's container. */
  passphrase: string;
}

/** A single credential reused for every placement (shared mode). */
export interface SharedCredential {
  p12: Uint8Array;
  passphrase: string;
}

/** Discriminated request: the shape itself tells the truth about identity count. */
export type MultiSignRequest =
  | { mode: 'separate'; signers: SeparateSigner[] }
  | { mode: 'shared'; credential: SharedCredential; placements: SignerPlacement[] };

export interface MultiSignResult {
  /** The N-times-signed PDF bytes (append-only; every earlier revision is a verbatim prefix). */
  bytes: Uint8Array;
  /** Per-signature re-verification (H1) — digest + cryptographic signature for each. */
  checks: SignatureCheck[];
}

/** Normalise either request shape into (placements, credentialForIndex). */
function planOf(req: MultiSignRequest): {
  placements: SignerPlacement[];
  credFor: (i: number) => SharedCredential;
} {
  if (req.mode === 'separate') {
    return {
      placements: req.signers,
      credFor: (i) => ({ p12: req.signers[i].p12, passphrase: req.signers[i].passphrase }),
    };
  }
  return { placements: req.placements, credFor: () => req.credential };
}

/**
 * Sign a PDF with N signatures in the requested mode.
 *
 * @throws {SignError} `SIGN_FAILED` if no signers are supplied; otherwise propagates the
 *         typed errors of the underlying engine (INVALID_PAGE / INVALID_RECT /
 *         UNSUPPORTED_XREF / WRONG_PASSPHRASE / …).
 */
export async function signMultiple(pdfBytes: Uint8Array, req: MultiSignRequest): Promise<MultiSignResult> {
  const { placements, credFor } = planOf(req);
  if (placements.length === 0) {
    throw new SignError('SIGN_FAILED', 'At least one signer is required for multi-signing.');
  }

  // Signature 1 — visible baseline via the shipped signer (full save; sets up AcroForm).
  const first = placements[0];
  const cred0 = credFor(0);
  let { bytes } = await new PdfSigner().sign(pdfBytes, {
    p12: cred0.p12,
    passphrase: cred0.passphrase,
    page: first.page,
    rect: first.rect,
    name: first.name,
    reason: first.reason,
  });

  // Signatures 2..N — append-only incremental updates (each freezes a revision).
  for (let i = 1; i < placements.length; i++) {
    const p = placements[i];
    const cred = credFor(i);
    const material = await loadP12(cred.p12, cred.passphrase);
    try {
      const r = await addIncrementalSignature(
        bytes,
        { page: p.page, rect: p.rect, name: p.name, reason: p.reason },
        material,
      );
      bytes = r.bytes;
    } finally {
      // Clear the signing key the moment this round finishes (mirrors PdfSigner).
      scrubP12Material(material);
    }
  }

  const checks = await verifyAllSignatures(bytes);
  return { bytes, checks };
}
