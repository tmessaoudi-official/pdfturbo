/**
 * Limits row 24 (D15) — the PAdES-B-B profile (`ETSI.CAdES.detached`) and the ByteRange hole every profile shares.
 *
 * The structure is read back from the signed PDF's own bytes with node-forge's ASN.1 parser, so each case pins what a
 * validator sees, not what the builder meant to write. An independent validator (pyHanko, which checks the ESS
 * attribute and the coverage) runs in tests/tools/padesPyhanko.test.ts, gated because it needs a local venv.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import forge from 'node-forge';
import { PdfSigner, isPdfSigned } from '../../src/signing/pdfSigner';
import { generateSelfSignedP12 } from '../../src/signing/certGen';
import { verifyAllSignatures } from '../../src/signing/cmsVerify';
import { OID_SIGNING_CERTIFICATE_V2 } from '../../src/signing/cms';
import type { SignOptions } from '../../src/signing/types';

type Asn1 = forge.asn1.Asn1;

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected a value');
  return v;
}
const latin1 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return s; };

async function makePdf(): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  return doc.save({ useObjectStreams: false });
}

/** The signed file, its ByteRange, and its CMS parsed as ASN.1 (padding zeros dropped). */
function readSignature(bytes: Uint8Array) {
  const s = latin1(bytes);
  const m = must(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(s));
  const range = m.slice(1).map(Number) as [number, number, number, number];
  const hex = must(/\/Contents\s*<([0-9A-Fa-f]+)>/.exec(s))[1];
  const der = forge.util.hexToBytes(hex);
  // The slot is zero-padded past the DER; forge's typings only know the boolean form of the options argument.
  const fromDer = forge.asn1.fromDer as unknown as (bytes: forge.util.ByteStringBuffer, opts: { parseAllBytes: boolean }) => Asn1;
  const cms = fromDer(forge.util.createBuffer(der), { parseAllBytes: false });
  const subFilter = must(/\/SubFilter\s*\/([\w.]+)/.exec(s))[1];
  return { s, range, cms, subFilter };
}

const kids = (n: Asn1) => n.value as Asn1[];
const oidOf = (n: Asn1) => forge.asn1.derToOid(n.value as string);

/** SignedData → [certificates node, the one SignerInfo]. */
function signedDataParts(cms: Asn1) {
  const sd = kids(kids(kids(cms)[1])[0]);
  const certs = must(sd.find(n => n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && n.type === 0));
  const signerInfo = kids(sd[sd.length - 1])[0];
  return { certs, signerInfo };
}

function signedAttrs(signerInfo: Asn1): Asn1[] {
  return kids(must(kids(signerInfo).find(n => n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && n.type === 0)));
}

describe('PdfSigner — PAdES-B-B profile and the ByteRange hole', () => {
  let base: Omit<SignOptions, 'profile'>;
  let pades: Uint8Array;
  let pkcs7: Uint8Array;

  beforeAll(async () => {
    const g = await generateSelfSignedP12({ commonName: 'PAdES Signer', organization: 'PDFturbo', country: 'FR' }, 'pw');
    base = { p12: g.p12, passphrase: 'pw', page: 0, rect: { x: 20, y: 20, width: 160, height: 50 } };
    const pdf = await makePdf();
    pades = (await new PdfSigner().sign(pdf, { ...base, profile: 'pades' })).bytes;
    pkcs7 = (await new PdfSigner().sign(pdf, base)).bytes;
  }, 60_000);

  it('names ETSI.CAdES.detached for PAdES, and keeps adbe.pkcs7.detached as the default', () => {
    expect(readSignature(pades).subFilter).toBe('ETSI.CAdES.detached');
    expect(readSignature(pkcs7).subFilter).toBe('adbe.pkcs7.detached');
  });

  it('the ByteRange hole is exactly the /Contents string with its < and >, in both profiles', () => {
    for (const bytes of [pades, pkcs7]) {
      const { s, range } = readSignature(bytes);
      expect(range[0]).toBe(0);
      expect(s[range[1]]).toBe('<');
      expect(s[range[2] - 1]).toBe('>');
      expect(/^<[0-9A-Fa-f]*>$/.test(s.slice(range[1], range[2]))).toBe(true);
      expect(range[2] + range[3]).toBe(bytes.length);
    }
  });

  it('signs contentType, messageDigest and signing-certificate-v2 — no signingTime — DER-sorted', () => {
    const attrs = signedAttrs(signedDataParts(readSignature(pades).cms).signerInfo);
    expect(attrs.map(a => oidOf(kids(a)[0]))).toEqual([
      forge.pki.oids.contentType, forge.pki.oids.messageDigest, OID_SIGNING_CERTIFICATE_V2,
    ]);
    const ders = attrs.map(a => forge.asn1.toDer(a).getBytes());
    expect([...ders].sort()).toEqual(ders); // bytewise order == latin1 string order
    // The default profile still carries signingTime (unchanged).
    const legacy = signedAttrs(signedDataParts(readSignature(pkcs7).cms).signerInfo).map(a => oidOf(kids(a)[0]));
    expect(legacy).toContain(forge.pki.oids.signingTime);
  });

  it('ESSCertIDv2 hashes the embedded signer certificate, omits the DEFAULT sha256, and names its issuer and serial', () => {
    const { cms } = readSignature(pades);
    const { certs, signerInfo } = signedDataParts(cms);
    const certAsn1 = kids(certs)[0];
    const certDer = forge.asn1.toDer(certAsn1).getBytes();
    const ess = kids(must(signedAttrs(signerInfo).find(a => oidOf(kids(a)[0]) === OID_SIGNING_CERTIFICATE_V2)))[1];
    const essCertId = kids(kids(kids(ess)[0])[0])[0]; // SET → SigningCertificateV2 → certs → ESSCertIDv2
    const [certHash, issuerSerial] = kids(essCertId);
    expect(kids(essCertId)).toHaveLength(2);
    expect(certHash.type).toBe(forge.asn1.Type.OCTETSTRING); // no hashAlgorithm before it
    const md = forge.md.sha256.create();
    md.update(certDer);
    expect(certHash.value).toBe(md.digest().getBytes());

    const tbs = kids(kids(certAsn1)[0]);
    const off = tbs[0].tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
    const [generalNames, serial] = kids(issuerSerial);
    const directoryName = kids(generalNames)[0];
    expect(directoryName.tagClass).toBe(forge.asn1.Class.CONTEXT_SPECIFIC);
    expect(directoryName.type).toBe(4);
    expect(directoryName.constructed).toBe(true); // [4] EXPLICIT wraps the Name
    expect(forge.asn1.toDer(kids(directoryName)[0]).getBytes()).toBe(forge.asn1.toDer(tbs[off + 2]).getBytes());
    expect(forge.asn1.toDer(serial).getBytes()).toBe(forge.asn1.toDer(tbs[off]).getBytes());
    // The SignerInfo names the same certificate.
    const sid = kids(kids(signerInfo)[1]);
    expect(forge.asn1.toDer(sid[0]).getBytes()).toBe(forge.asn1.toDer(tbs[off + 2]).getBytes());
  });

  it('the digest and the RSA signature verify, and forge still parses the message', async () => {
    const [check] = await verifyAllSignatures(pades);
    expect(check).toMatchObject({ digestMatches: true, signatureValid: true, signerCommonName: 'PAdES Signer' });
  });

  it('a PAdES-signed file is recognised as signed, so re-signing is refused', async () => {
    expect(isPdfSigned(pades)).toBe(true);
    await expect(new PdfSigner().sign(pades, { ...base, profile: 'pades' })).rejects.toMatchObject({ code: 'ALREADY_SIGNED' });
  });
});
