/**
 * H1 — CMS re-verification of embedded PDF signatures (node-forge rawCapture).
 *
 * Proves `verifyAllSignatures` cryptographically re-checks each embedded CMS:
 *   • the messageDigest authenticated attribute equals SHA-256 of the ByteRange span, AND
 *   • the authenticated attributes' signature verifies against the CMS-embedded cert.
 * A tamper test (flip a covered byte) MUST flip `digestMatches` to false — that is the
 * proof the verifier actually checks rather than rubber-stamping.
 *
 * Runs in jsdom (pdf-lib + node-forge are pure-JS). ONE 2048-bit keygen in beforeAll.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PdfSigner } from '../../src/signing/pdfSigner';
import { generateSelfSignedP12 } from '../../src/signing/certGen';
import { type P12Material, loadP12 } from '../../src/signing/p12';
import { addIncrementalSignature } from '../../src/signing/incrementalSigner';
import { verifyAllSignatures } from '../../src/signing/cmsVerify';

async function makePdf(w = 400, h = 400): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([w, h]);
  p.drawText('Hello', { x: 20, y: h - 40, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

describe('cmsVerify — verifyAllSignatures', () => {
  let p12: Uint8Array;
  let material: P12Material;
  const rect1 = { x: 20, y: 20, width: 160, height: 50 };
  const rect2 = { x: 220, y: 20, width: 160, height: 50 };

  beforeAll(async () => {
    const gen = await generateSelfSignedP12({ commonName: 'Verify Signer', organization: 'PDFturbo' }, 'pw');
    p12 = gen.p12;
    material = await loadP12(p12, 'pw');
  }, 60_000);

  async function signOnce(): Promise<Uint8Array> {
    const pdf = await makePdf();
    const { bytes } = await new PdfSigner().sign(pdf, {
      p12,
      passphrase: 'pw',
      page: 0,
      rect: rect1,
      name: 'Signer One',
    });
    return bytes;
  }

  it('verifies a single embedded signature (digest + cryptographic signature both valid)', async () => {
    const once = await signOnce();
    const checks = await verifyAllSignatures(once);
    expect(checks).toHaveLength(1);
    expect(checks[0].digestMatches).toBe(true);
    expect(checks[0].signatureValid).toBe(true);
    expect(checks[0].signerCommonName).toBe('Verify Signer');
  });

  it('verifies BOTH signatures of an incrementally double-signed PDF', async () => {
    const once = await signOnce();
    const { bytes: twice } = await addIncrementalSignature(
      once,
      { page: 0, rect: rect2, name: 'Signer Two' },
      material,
    );
    const checks = await verifyAllSignatures(twice);
    expect(checks).toHaveLength(2);
    for (const c of checks) {
      expect(c.digestMatches).toBe(true);
      expect(c.signatureValid).toBe(true);
    }
  });

  it('rejects a tampered signature: flipping a covered byte breaks digestMatches', async () => {
    const once = await signOnce();
    // Flip a byte well inside the first covered span (byte 200 is in revision-1 content).
    const tampered = new Uint8Array(once);
    tampered[200] ^= 0xff;
    const checks = await verifyAllSignatures(tampered);
    expect(checks).toHaveLength(1);
    expect(checks[0].digestMatches).toBe(false);
  });
});
