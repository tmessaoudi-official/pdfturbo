/**
 * Two-mode multi-signature orchestration (spike-grade, UNWIRED).
 *
 * `signMultiple` drives the proven engine (PdfSigner baseline + addIncrementalSignature
 * append-only) in two honest modes:
 *   • 'separate' — N independent certs, each signature validates against its OWN cert.
 *   • 'shared'   — ONE credential, N signatures: a single identity signing N times
 *                  (org seal / revision locks). The type structurally carries one
 *                  credential + N placements so the API itself can't pretend N people
 *                  are cryptographically bound under one key.
 *
 * jsdom: pdf-lib + node-forge are pure-JS. Two 2048-bit keygens in beforeAll (60s).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { signMultiple } from '../../src/signing/multiSign';
import { generateSelfSignedP12 } from '../../src/signing/certGen';
import { countSignatures } from '../../src/signing/incrementalSigner';

async function makePdf(pages = 1): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    doc.addPage([400, 400]).drawText(`Page ${i + 1}`, { x: 20, y: 360, size: 14, font });
  }
  return doc.save({ useObjectStreams: false });
}

const rectAt = (x: number) => ({ x, y: 20, width: 120, height: 40 });

describe('signMultiple — two-mode orchestration', () => {
  let p12A: Uint8Array;
  let p12B: Uint8Array;

  beforeAll(async () => {
    const a = await generateSelfSignedP12({ commonName: 'Alpha', organization: 'PDFturbo' }, 'pw');
    const b = await generateSelfSignedP12({ commonName: 'Beta', organization: 'PDFturbo' }, 'pw');
    p12A = a.p12;
    p12B = b.p12;
  }, 60_000);

  it('separate mode — two distinct certs, both signatures valid under their OWN cert', async () => {
    const pdf = await makePdf(1);
    const { bytes, checks } = await signMultiple(pdf, {
      mode: 'separate',
      signers: [
        { p12: p12A, passphrase: 'pw', page: 0, rect: rectAt(20), name: 'Alpha' },
        { p12: p12B, passphrase: 'pw', page: 0, rect: rectAt(160), name: 'Beta' },
      ],
    });
    expect(countSignatures(bytes)).toBe(2);
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.digestMatches && c.signatureValid)).toBe(true);
    expect(checks.map((c) => c.signerCommonName).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('shared mode — one credential, three signatures, all valid under the SAME identity', async () => {
    const pdf = await makePdf(1);
    const { bytes, checks } = await signMultiple(pdf, {
      mode: 'shared',
      credential: { p12: p12A, passphrase: 'pw' },
      placements: [
        { page: 0, rect: rectAt(20), name: 'Reviewer 1' },
        { page: 0, rect: rectAt(150), name: 'Reviewer 2' },
        { page: 0, rect: rectAt(280), name: 'Reviewer 3' },
      ],
    });
    expect(countSignatures(bytes)).toBe(3);
    expect(checks).toHaveLength(3);
    expect(checks.every((c) => c.digestMatches && c.signatureValid)).toBe(true);
    // Honest contract: every signature carries the SAME embedded identity.
    const cns = new Set(checks.map((c) => c.signerCommonName));
    expect(cns.size).toBe(1);
    expect(cns.has('Alpha')).toBe(true);
  });

  it('multi-page separate mode — signatures on different pages both verify', async () => {
    const pdf = await makePdf(2);
    const { bytes, checks } = await signMultiple(pdf, {
      mode: 'separate',
      signers: [
        { p12: p12A, passphrase: 'pw', page: 0, rect: rectAt(20), name: 'Alpha' },
        { p12: p12B, passphrase: 'pw', page: 1, rect: rectAt(20), name: 'Beta' },
      ],
    });
    expect(countSignatures(bytes)).toBe(2);
    expect(checks.every((c) => c.digestMatches && c.signatureValid)).toBe(true);
  });

  it('refuses an empty signer set', async () => {
    const pdf = await makePdf(1);
    await expect(signMultiple(pdf, { mode: 'shared', credential: { p12: p12A, passphrase: 'pw' }, placements: [] }))
      .rejects.toMatchObject({ code: 'SIGN_FAILED' });
  });

  it('a single signer still produces one valid signature (degenerate N=1)', async () => {
    const pdf = await makePdf(1);
    const { bytes, checks } = await signMultiple(pdf, {
      mode: 'separate',
      signers: [{ p12: p12A, passphrase: 'pw', page: 0, rect: rectAt(20), name: 'Alpha' }],
    });
    expect(countSignatures(bytes)).toBe(1);
    expect(checks).toHaveLength(1);
    expect(checks[0].digestMatches && checks[0].signatureValid).toBe(true);
  });
});
