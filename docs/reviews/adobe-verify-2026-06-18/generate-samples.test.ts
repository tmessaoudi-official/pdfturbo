/**
 * Adobe/DSS verification-kit GENERATOR (spike artifact, NOT part of the CI suite).
 *
 * The jsdom config globs only `tests/**`, so this file never runs under
 * `npm test`. Run it on demand to (re)produce the manual-verification samples:
 *
 *   ./node_modules/.bin/vitest run \
 *     --config docs/reviews/adobe-verify-2026-06-18/vitest.gen.config.ts
 *
 * It drives the UNWIRED two-mode orchestrator `signMultiple` (the very code whose
 * Adobe/DSS acceptance is the gate before any UI wiring) and writes, beside this
 * file:
 *   • sample-separate.pdf   — 2 signatures, 2 DISTINCT self-signed certs
 *   • sample-shared.pdf     — 3 signatures, ONE self-signed cert (one identity ×3)
 *   • cert-alpha.pem / cert-beta.pem  — the public certs (import to flip
 *                                       "validity unknown" → "valid" in Acrobat)
 *   • cert-alpha.p12 / cert-beta.p12  — the PKCS#12 containers (passphrase below)
 *   • verify-separate.json / verify-shared.json — the in-repo H1 `verifyAllSignatures`
 *                             result per sample (the cryptographic ground truth Acrobat must echo)
 *
 * Self-signed ⇒ readers show "validity unknown" until the cert is trusted — that
 * is expected and is NOT a signature failure. See CHECKLIST.md.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { signMultiple } from '../../../src/signing/multiSign';
import { countSignatures } from '../../../src/signing/incrementalSigner';
import { generateSelfSignedP12 } from '../../../src/signing/certGen';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const out = (name: string) => join(OUT_DIR, name);

// A fixed passphrase — these are throwaway self-signed TEST certs; the password is
// documented in CHECKLIST.md so a verifier can inspect the .p12 if they wish.
const PW = 'pdfturbo-verify';

async function buildPdf(pages = 2): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle('PDFturbo multi-sign verification sample');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]); // A4 points
    page.drawText('PDFturbo — multi-signature verification sample', { x: 50, y: 780, size: 16, font });
    page.drawText(`Page ${i + 1} of ${pages}`, { x: 50, y: 750, size: 12, font });
    page.drawText('Signature boxes are stamped near the bottom of page 1.', { x: 50, y: 720, size: 11, font });
  }
  return doc.save({ useObjectStreams: false });
}

const rectAt = (x: number, y = 60) => ({ x, y, width: 200, height: 60 });

describe('GENERATE Adobe/DSS verification samples', () => {
  let alpha: { p12: Uint8Array; pem: string };
  let beta: { p12: Uint8Array; pem: string };

  beforeAll(async () => {
    const a = await generateSelfSignedP12(
      { commonName: 'Alice Alpha', organization: 'PDFturbo Demo', country: 'FR' },
      PW,
    );
    const b = await generateSelfSignedP12(
      { commonName: 'Bob Beta', organization: 'PDFturbo Demo', country: 'FR' },
      PW,
    );
    alpha = { p12: a.p12, pem: a.pem };
    beta = { p12: b.p12, pem: b.pem };
    writeFileSync(out('cert-alpha.p12'), alpha.p12);
    writeFileSync(out('cert-beta.p12'), beta.p12);
    writeFileSync(out('cert-alpha.pem'), alpha.pem);
    writeFileSync(out('cert-beta.pem'), beta.pem);
  }, 120_000);

  it('writes sample-separate.pdf — 2 distinct certs, both signatures valid', async () => {
    const pdf = await buildPdf(2);
    const { bytes, checks } = await signMultiple(pdf, {
      mode: 'separate',
      signers: [
        { p12: alpha.p12, passphrase: PW, page: 0, rect: rectAt(50), name: 'Alice Alpha', reason: 'Approved (signer 1)' },
        { p12: beta.p12, passphrase: PW, page: 0, rect: rectAt(330), name: 'Bob Beta', reason: 'Counter-signed (signer 2)' },
      ],
    });
    expect(countSignatures(bytes)).toBe(2);
    expect(checks.every((c) => c.digestMatches && c.signatureValid)).toBe(true);
    writeFileSync(out('sample-separate.pdf'), bytes);
    writeFileSync(out('verify-separate.json'), JSON.stringify(checks, null, 2));
  });

  it('writes sample-shared.pdf — one identity, three signatures, all valid', async () => {
    const pdf = await buildPdf(2);
    const { bytes, checks } = await signMultiple(pdf, {
      mode: 'shared',
      credential: { p12: alpha.p12, passphrase: PW },
      placements: [
        { page: 0, rect: rectAt(50), name: 'Reviewer round 1', reason: 'Initial review' },
        { page: 0, rect: rectAt(330), name: 'Reviewer round 2', reason: 'Second review' },
        { page: 1, rect: rectAt(50), name: 'Reviewer round 3', reason: 'Final sign-off' },
      ],
    });
    expect(countSignatures(bytes)).toBe(3);
    expect(checks.every((c) => c.digestMatches && c.signatureValid)).toBe(true);
    // Honest contract: all three carry the SAME embedded identity.
    expect(new Set(checks.map((c) => c.signerCommonName)).size).toBe(1);
    writeFileSync(out('sample-shared.pdf'), bytes);
    writeFileSync(out('verify-shared.json'), JSON.stringify(checks, null, 2));
  });
});
