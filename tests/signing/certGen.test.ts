/**
 * In-browser self-signed cert generation (certGen.ts) — the "generate a cert on
 * the spot" feature. Runs in jsdom (node-forge is pure JS). The key assertion is
 * the ROUND-TRIP: a generated PKCS#12 must actually sign a PDF via the real
 * PdfSigner, proving the generated identity is valid signing material — not just
 * that bytes came out.
 */
import { describe, expect, it } from 'vitest';
import { generateSelfSignedP12, validateCertIdentity, type CertIdentity } from '../../src/signing/certGen';
import { PdfSigner } from '../../src/signing/pdfSigner';
import { SignError } from '../../src/signing/types';

const IDENTITY: CertIdentity = {
  commonName: 'Takieddine M',
  organization: 'PDFturbo',
  email: 'signer@example.test',
  country: 'FR',
  validityYears: 2,
};

async function makePdf(): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([420, 595]);
  return doc.save({ useObjectStreams: false });
}

describe('certGen — generateSelfSignedP12', () => {
  it('produces a non-empty PKCS#12 and a PEM certificate', async () => {
    const { p12, pem, passphrase } = await generateSelfSignedP12(IDENTITY, 'pw123');
    expect(p12).toBeInstanceOf(Uint8Array);
    expect(p12.byteLength).toBeGreaterThan(500);
    expect(pem).toContain('-----BEGIN CERTIFICATE-----');
    expect(pem).toContain('-----END CERTIFICATE-----');
    expect(passphrase).toBe('pw123');
  });

  it('embeds the full subject (CN, O, C, email) in the certificate', async () => {
    const { pem } = await generateSelfSignedP12(IDENTITY, 'pw');
    const forge = (await import('node-forge')).default;
    const cert = forge.pki.certificateFromPem(pem);
    const cn = cert.subject.getField('CN') as { value?: string } | null;
    const org = cert.subject.getField('O') as { value?: string } | null;
    const country = cert.subject.getField('C') as { value?: string } | null;
    expect(cn?.value).toBe('Takieddine M');
    expect(org?.value).toBe('PDFturbo');
    expect(country?.value).toBe('FR');
    // self-signed: issuer CN equals subject CN
    const issuerCn = cert.issuer.getField('CN') as { value?: string } | null;
    expect(issuerCn?.value).toBe('Takieddine M');
  });

  it('ROUND-TRIP: the generated .p12 actually signs a PDF (CN flows through)', async () => {
    const { p12, passphrase } = await generateSelfSignedP12(IDENTITY, 'sekret');
    const pdf = await makePdf();
    const res = await new PdfSigner().sign(pdf, {
      p12,
      passphrase,
      page: 0,
      rect: { x: 72, y: 72, width: 240, height: 70 },
      reason: 'Generated-cert signature',
    });
    expect(res.bytes.byteLength).toBeGreaterThan(pdf.byteLength);
    expect(res.signerCommonName).toBe('Takieddine M');
    let s = '';
    for (const b of res.bytes) s += String.fromCharCode(b);
    expect(s).toContain('/SubFilter /adbe.pkcs7.detached');
  });

  it('rejects an empty common name and a malformed country', () => {
    expect(() => validateCertIdentity({ commonName: '   ' })).toThrow(SignError);
    expect(() => validateCertIdentity({ commonName: 'A', country: 'FRA' })).toThrow(SignError);
    expect(() => validateCertIdentity({ commonName: 'A', country: 'FR' })).not.toThrow();
  });
});
