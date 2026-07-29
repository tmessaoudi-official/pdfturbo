/**
 * E-signing blockers — confirming tests. See ./README.md for the convention.
 * Source research: research-2026-06-15-blockers/raw/ocr-signing.md (removed from the repo — see ./README.md)
 *
 * Uses a runtime self-signed P12 (no fixtures, no secrets) — same approach as
 * tests/signing/pdfSigner.integration.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { PdfSigner } from '../../src/signing/pdfSigner';

async function makePdf(): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([420, 595]);
  return doc.save({ useObjectStreams: false });
}

async function makeP12(passphrase: string): Promise<Uint8Array> {
  const forge = (await import('node-forge')).default;
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 3.15e10);
  const attrs = [
    { name: 'commonName', value: 'Blocker Test Signer' },
    { name: 'countryName', value: 'FR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' });
  const der = forge.asn1.toDer(asn1).getBytes();
  const out = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i) & 0xff;
  return out;
}

const ascii = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};

const RECT = { x: 72, y: 72, width: 240, height: 70 };

describe('Signing blocker S6 — uses legacy PKCS#7, not PAdES (ETSI.CAdES)', () => {
  // CEILING (re-scoped 2026-06-15 after investigation). A compliant PAdES-BES needs
  // the ESS signing-certificate-v2 SIGNED attribute, but node-forge's pkcs7
  // `_attributeToAsn1` only encodes contentType/messageDigest/signingTime — for any
  // other OID the value is left undefined (a broken attribute). So the ESS attr
  // CANNOT be added via the forge API; emitting only the ETSI.CAdES.detached
  // SubFilter without it would be MALFORMED PAdES — strictly worse than the valid
  // ISO 32000-1 adbe.pkcs7.detached we emit today. A real fix means hand-rolling the
  // CAdES SignedData ASN.1 (or a different crypto lib): deferred, NOT test-gamed.
  it.fails('emits a PAdES ETSI.CAdES.detached SubFilter (ceiling: forge cannot add the ESS attr)', async () => {
    const s = ascii(await (await new PdfSigner().sign(await makePdf(), {
      p12: await makeP12('pw'), passphrase: 'pw', page: 0, rect: RECT,
    })).bytes);
    expect(s).toContain('/SubFilter /ETSI.CAdES.detached');
  });
});

describe('Signing blocker S2 — no LTV / DSS validation material', () => {
  // CEILING for full LTV (needs online OCSP/CRL), but the absence is provable:
  // there is no /DSS catalog entry, so signatures are not long-term-validatable.
  it.fails('embeds a /DSS dictionary for long-term validation', async () => {
    const s = ascii(await (await new PdfSigner().sign(await makePdf(), {
      p12: await makeP12('pw'), passphrase: 'pw', page: 0, rect: RECT,
    })).bytes);
    // DESIRED: a /DSS entry. TODAY: absent (no LTV).
    expect(s).toContain('/DSS');
  });
});

describe('Signing blocker S3 — re-signing refuses cleanly (FIXED)', () => {
  // FIXED: pdf-lib does a FULL re-save (not an incremental update), so re-signing
  // an already-signed PDF used to throw an OPAQUE ByteRange error. The signer now
  // detects an existing signature up front and refuses with a typed ALREADY_SIGNED.
  it('rejects re-signing with a clear ALREADY_SIGNED SignError, not an opaque crash', async () => {
    const signer = new PdfSigner();
    const p12 = await makeP12('pw');
    const first = await signer.sign(await makePdf(), { p12, passphrase: 'pw', page: 0, rect: RECT });
    // DESIRED: a typed, user-meaningful refusal. TODAY: an untyped ByteRange crash.
    await expect(
      signer.sign(first.bytes, { p12, passphrase: 'pw', page: 0, rect: RECT }),
    ).rejects.toMatchObject({ code: 'ALREADY_SIGNED' });
  });
});
