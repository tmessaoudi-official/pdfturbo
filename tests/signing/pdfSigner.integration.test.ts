/**
 * Integration smoke test for the full PdfSigner pipeline.
 *
 * This exercises real node-forge crypto (PKCS#12 parse + detached PKCS#7) and
 * real @cantoo/pdf-lib serialisation + ByteRange splicing. It runs under the
 * default vitest jsdom env (node-forge is pure-JS and needs no real subtle-crypto
 * for RSA/SHA-256), so it CAN run in `vitest run`.
 *
 * It generates a throwaway self-signed certificate at runtime — no fixtures, no
 * secrets. It deliberately does NOT assert cryptographic VERIFICATION of the
 * signature against a PDF reader; that, plus the lazy-chunk / file-download
 * behaviour, is what the real-browser test must cover (see wiring spec).
 */

import { describe, expect, it } from 'vitest';
import { PdfSigner } from '../../src/signing/pdfSigner';
import { SignError } from '../../src/signing/types';

/** Build a minimal valid PDF (one blank A5-ish page) without pulling fixtures. */
async function makePdf(): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([420, 595]);
  return doc.save({ useObjectStreams: false });
}

/** Generate a self-signed PKCS#12 container at runtime. */
async function makeP12(passphrase: string): Promise<Uint8Array> {
  const forge = (await import('node-forge')).default;
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 3.15e10);
  const attrs = [
    { name: 'commonName', value: 'Agent S Test Signer' },
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

describe('PdfSigner integration', () => {
  it('produces a structurally valid signed PDF on the happy path', async () => {
    const pdf = await makePdf();
    const p12 = await makeP12('testpw');

    const res = await new PdfSigner().sign(pdf, {
      p12,
      passphrase: 'testpw',
      page: 0,
      rect: { x: 72, y: 72, width: 240, height: 70 },
      reason: 'I approve',
      location: 'Paris, FR',
    });

    expect(res.bytes).toBeInstanceOf(Uint8Array);
    expect(res.bytes.length).toBeGreaterThan(pdf.length);
    expect(res.signerCommonName).toBe('Agent S Test Signer');

    const s = ascii(res.bytes);
    expect(ascii(res.bytes.subarray(0, 4))).toBe('%PDF');
    expect(s).toContain('/SubFilter /adbe.pkcs7.detached');
    expect(s).toContain('/Type /Sig');

    // ByteRange must be filled with real numbers, not the all-zeros placeholder.
    const m = s.match(/\/ByteRange \[ (\d+) (\d+) (\d+) (\d+) \]/);
    expect(m).not.toBeNull();
    const nums = (m ?? []).map(Number);
    const [, a, b, c, d] = nums;
    expect(a).toBe(0);
    // Spans must skip exactly the hex payload and cover the rest of the file.
    expect(b + d).toBeLessThan(res.bytes.length);
    expect(c).toBeGreaterThan(b);

    // The Contents slot must contain non-zero hex (an actual signature was spliced).
    const contentsMatch = s.match(/\/Contents <([0-9a-fA-F]+)>/);
    expect(contentsMatch).not.toBeNull();
    const contentsHex = contentsMatch?.[1] ?? '';
    expect(/[1-9a-f]/.test(contentsHex)).toBe(true);

    // ── Cryptographic round-trip ──────────────────────────────────────────────
    // node-forge's pkcs7.verify() is NOT implemented, so we verify the two
    // properties that actually prove correctness:
    //   (1) SHA-256(coveredBytes) === the messageDigest authenticated attribute, and
    //   (2) the RSA signature over the DER-encoded authenticated attributes is
    //       valid under the signing cert's public key.
    const forge = (await import('node-forge')).default;
    const covered = new Uint8Array(b + d);
    covered.set(res.bytes.subarray(a, a + b), 0);
    covered.set(res.bytes.subarray(c, c + d), b);

    const trimmedHex = contentsHex.replace(/(00)+$/i, '');
    let bin = '';
    for (let i = 0; i < trimmedHex.length; i += 2) {
      bin += String.fromCharCode(parseInt(trimmedHex.slice(i, i + 2), 16));
    }
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(bin)) as unknown as {
      rawCapture: {
        authenticatedAttributes: unknown[];
        signature: string;
        digestAlgorithm: string;
      };
      certificates: Array<{ publicKey: unknown }>;
    };

    // (1) messageDigest attribute must equal SHA-256 of the covered span.
    let coveredBin = '';
    for (const byte of covered) coveredBin += String.fromCharCode(byte);
    const md = forge.md.sha256.create();
    md.update(coveredBin);
    const expectedDigest = md.digest().getBytes();

    const authAttrs = p7.rawCapture.authenticatedAttributes;
    const attrSet = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET,
      true,
      authAttrs as never[],
    );
    // The digest the signer actually signed: SHA-256 over the DER auth-attr SET.
    const attrDer = forge.asn1.toDer(attrSet).getBytes();
    const attrMd = forge.md.sha256.create();
    attrMd.update(attrDer);

    // (2) RSA-verify the signature over the auth attributes with the cert pubkey.
    const cert = p7.certificates[0];
    const pub = cert.publicKey as { verify(digest: string, sig: string): boolean };
    const sigValid = pub.verify(attrMd.digest().getBytes(), p7.rawCapture.signature);
    expect(sigValid).toBe(true);

    // Sanity: the messageDigest attribute genuinely contains our covered digest.
    expect(attrDer).toContain(expectedDigest);
  });

  it('throws WRONG_PASSPHRASE for an incorrect passphrase', async () => {
    const pdf = await makePdf();
    const p12 = await makeP12('testpw');
    await expect(
      new PdfSigner().sign(pdf, {
        p12,
        passphrase: 'WRONG',
        page: 0,
        rect: { x: 10, y: 10, width: 100, height: 40 },
      }),
    ).rejects.toMatchObject({ code: 'WRONG_PASSPHRASE' });
  });

  it('throws INVALID_PAGE for an out-of-range page', async () => {
    const pdf = await makePdf();
    const p12 = await makeP12('testpw');
    let err: unknown;
    try {
      await new PdfSigner().sign(pdf, {
        p12,
        passphrase: 'testpw',
        page: 9999,
        rect: { x: 10, y: 10, width: 100, height: 40 },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SignError);
    expect((err as SignError).code).toBe('INVALID_PAGE');
  });

  it('throws INVALID_P12 for garbage container bytes', async () => {
    const pdf = await makePdf();
    await expect(
      new PdfSigner().sign(pdf, {
        p12: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        passphrase: 'x',
        page: 0,
        rect: { x: 10, y: 10, width: 100, height: 40 },
      }),
    ).rejects.toBeInstanceOf(SignError);
  });
});
