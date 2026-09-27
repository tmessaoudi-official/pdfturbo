/**
 * Detached PKCS#7 / CMS signature production via node-forge (DYNAMICALLY IMPORTED).
 *
 * Produces a DER-encoded, detached SignedData over an arbitrary byte span — the
 * "ByteRange digest" of a PDF. Two profiles:
 *
 * - `'pkcs7'` (the default, `adbe.pkcs7.detached`): node-forge builds it, with the
 *   contentType, messageDigest and signingTime authenticated attributes.
 * - `'pades'` (`ETSI.CAdES.detached`, PAdES-B-B — limits row 24, D15): built by hand from
 *   forge's ASN.1 primitives, because forge's `_attributeToAsn1` encodes only those three
 *   attribute types and PAdES needs a fourth. Signed attributes are contentType,
 *   messageDigest and ESS signing-certificate-v2 (RFC 5035), and NOT signingTime, which
 *   ETSI EN 319 142-1 forbids — the claimed time is the signature dictionary's /M.
 */

import { SignError } from './types';
import type { P12Material } from './p12';

interface ForgeCmsLike {
  util: {
    createBuffer(input?: string, encoding?: string): ForgeBuffer;
  };
  asn1: ForgeAsn1Api;
  pkcs7: {
    createSignedData(): ForgeSignedData;
  };
  pki: { oids: Record<string, string>; certificateToAsn1(cert: unknown): ForgeAsn1 };
  md: { sha256: { create(): ForgeMd } };
}

interface ForgeAsn1 {
  tagClass: number;
  type: number;
  constructed: boolean;
  value: ForgeAsn1[] | string;
}

interface ForgeAsn1Api {
  Class: { UNIVERSAL: number; CONTEXT_SPECIFIC: number };
  Type: { INTEGER: number; OCTETSTRING: number; NULL: number; OID: number; SEQUENCE: number; SET: number };
  create(tagClass: number, type: number, constructed: boolean, value: ForgeAsn1[] | string): ForgeAsn1;
  toDer(obj: unknown): ForgeBuffer;
  oidToDer(oid: string): ForgeBuffer;
  integerToDer(n: number): ForgeBuffer;
}

interface ForgeMd {
  update(bytes: string, encoding?: string): void;
  digest(): { getBytes(): string };
}

/** Which CMS profile to produce — and so which /SubFilter the signature dictionary must name. */
export type CmsProfile = 'pkcs7' | 'pades';

/** RFC 5035 id-aa-signingCertificateV2. */
export const OID_SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47';

interface ForgeBuffer {
  getBytes(): string;
  putBytes(bytes: string): void;
  length(): number;
}

interface ForgeSignedData {
  content: unknown;
  addCertificate(cert: unknown): void;
  addSigner(opts: {
    key: unknown;
    certificate: unknown;
    digestAlgorithm: string;
    authenticatedAttributes: Array<{ type: string; value?: string }>;
  }): void;
  sign(opts?: { detached?: boolean }): void;
  toAsn1(): unknown;
}

/** Convert raw bytes to node-forge's binary string form. */
function bytesToBinaryString(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  return out;
}

/** Convert a node-forge binary string back to bytes. */
function binaryStringToBytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Produce a detached PKCS#7 (CMS) DER signature over {@link signedBytes}.
 *
 * @param signedBytes the exact bytes covered by the PDF ByteRange
 * @param material    the key + cert chain from {@link loadP12}
 * @returns DER bytes of the detached SignedData structure
 * @throws {SignError} SIGN_FAILED on any forge error
 */
export async function buildDetachedCms(
  signedBytes: Uint8Array,
  material: P12Material,
  profile: CmsProfile = 'pkcs7',
): Promise<Uint8Array> {
  const forge = (await import('node-forge')) as unknown as ForgeCmsLike & { default?: ForgeCmsLike };
  const f: ForgeCmsLike = forge.default ?? forge;

  if (profile === 'pades') {
    try {
      return binaryStringToBytes(buildPadesDer(f, bytesToBinaryString(signedBytes), material));
    } catch (cause) {
      throw new SignError('SIGN_FAILED', 'Failed to produce the PAdES (CAdES) signature.', { cause });
    }
  }

  try {
    const p7 = f.pkcs7.createSignedData();

    const content = f.util.createBuffer();
    content.putBytes(bytesToBinaryString(signedBytes));
    p7.content = content;

    // Embed the leaf + the rest of the chain so validators can build the path.
    for (const cert of material.chain) p7.addCertificate(cert);

    p7.addSigner({
      key: material.privateKey,
      certificate: material.certificate,
      digestAlgorithm: f.pki.oids.sha256,
      authenticatedAttributes: [
        { type: f.pki.oids.contentType, value: f.pki.oids.data },
        // messageDigest + signingTime values are computed by forge when omitted.
        { type: f.pki.oids.messageDigest },
        { type: f.pki.oids.signingTime },
      ],
    });

    // detached: true → the content is NOT included in the output (it lives in the PDF).
    p7.sign({ detached: true });

    const der = f.asn1.toDer(p7.toAsn1());
    return binaryStringToBytes(der.getBytes());
  } catch (cause) {
    throw new SignError('SIGN_FAILED', 'Failed to produce the PKCS#7/CMS signature.', { cause });
  }
}

/** DER-sort a SET OF by each element's full encoding, bytewise (X.690 §11.6). */
function derSortedSet(f: ForgeCmsLike, items: ForgeAsn1[]): ForgeAsn1[] {
  const keyed = items.map(it => ({ it, der: f.asn1.toDer(it).getBytes() }));
  keyed.sort((a, b) => {
    const n = Math.min(a.der.length, b.der.length);
    for (let i = 0; i < n; i++) {
      const d = a.der.charCodeAt(i) - b.der.charCodeAt(i);
      if (d) return d;
    }
    return a.der.length - b.der.length;
  });
  return keyed.map(k => k.it);
}

/**
 * The PAdES-B-B SignedData, as a DER binary string. Every structure is RFC 5652 / RFC 5035, spelled out because forge
 * cannot express the ESS attribute:
 *
 *   SignerInfo.signedAttrs = SET { contentType(data), messageDigest(SHA-256 of the span), signingCertificateV2 }
 *   SigningCertificateV2   = SEQUENCE { SEQUENCE { ESSCertIDv2 } }
 *   ESSCertIDv2            = SEQUENCE { certHash OCTET STRING, issuerSerial IssuerSerial }  — hashAlgorithm is
 *                            OMITTED: it is DEFAULT sha256, and DER forbids encoding a default
 *   IssuerSerial           = SEQUENCE { GeneralNames { [4] EXPLICIT Name }, serialNumber }
 *
 * The issuer Name and serial are taken from the certificate's own ASN.1, never rebuilt, so they are exactly the bytes
 * the embedded certificate carries.
 */
function buildPadesDer(f: ForgeCmsLike, span: string, material: P12Material): string {
  const { asn1 } = f;
  const U = asn1.Class.UNIVERSAL, CTX = asn1.Class.CONTEXT_SPECIFIC, T = asn1.Type;
  const oid = (o: string) => asn1.create(U, T.OID, false, asn1.oidToDer(o).getBytes());
  const seq = (v: ForgeAsn1[]) => asn1.create(U, T.SEQUENCE, true, v);
  const set = (v: ForgeAsn1[]) => asn1.create(U, T.SET, true, derSortedSet(f, v));
  const octet = (b: string) => asn1.create(U, T.OCTETSTRING, false, b);
  const sha256 = (b: string) => { const md = f.md.sha256.create(); md.update(b); return md.digest().getBytes(); };
  const algSha256 = () => seq([oid(f.pki.oids.sha256), asn1.create(U, T.NULL, false, '')]);
  const attribute = (type: string, value: ForgeAsn1) => seq([oid(type), set([value])]);

  const certAsn1 = f.pki.certificateToAsn1(material.certificate);
  const certDer = asn1.toDer(certAsn1).getBytes();
  const tbs = (certAsn1.value as ForgeAsn1[])[0].value as ForgeAsn1[];
  // tbsCertificate: [0] version (optional), serialNumber, signature, issuer, …
  const base = tbs[0].tagClass === CTX ? 1 : 0;
  const serial = tbs[base], issuer = tbs[base + 2];

  const essCertIdV2 = seq([
    octet(sha256(certDer)),
    seq([seq([asn1.create(CTX, 4, true, [issuer])]), serial]),
  ]);
  const attrs = derSortedSet(f, [
    attribute(f.pki.oids.contentType, oid(f.pki.oids.data)),
    attribute(f.pki.oids.messageDigest, octet(sha256(span))),
    attribute(OID_SIGNING_CERTIFICATE_V2, seq([seq([essCertIdV2])])),
  ]);

  // The signature covers the attributes encoded as a SET (tag 0x31), not the [0] IMPLICIT they carry below.
  const md = f.md.sha256.create();
  md.update(asn1.toDer(asn1.create(U, T.SET, true, attrs)).getBytes());
  const signature = (material.privateKey as { sign(md: ForgeMd): string }).sign(md);

  const signerInfo = seq([
    asn1.create(U, T.INTEGER, false, asn1.integerToDer(1).getBytes()),
    seq([issuer, serial]),
    algSha256(),
    asn1.create(CTX, 0, true, attrs),
    seq([oid(f.pki.oids.rsaEncryption), asn1.create(U, T.NULL, false, '')]),
    octet(signature),
  ]);
  const signedData = seq([
    asn1.create(U, T.INTEGER, false, asn1.integerToDer(1).getBytes()),
    set([algSha256()]),
    seq([oid(f.pki.oids.data)]), // detached: no eContent
    // The chain as given, leaf first — a validator finds the signer by issuer and serial, not by position.
    asn1.create(CTX, 0, true, material.chain.map(c => f.pki.certificateToAsn1(c))),
    set([signerInfo]),
  ]);
  return asn1.toDer(seq([oid(f.pki.oids.signedData), asn1.create(CTX, 0, true, [signedData])])).getBytes();
}
