/**
 * H1 — re-verification of embedded PDF CMS signatures via node-forge (DYNAMICALLY
 * IMPORTED). Cross-checks that each signature in a (singly- or incrementally
 * multi-) signed PDF is cryptographically sound:
 *
 *   1. the `messageDigest` authenticated attribute equals SHA-256 of the exact
 *      bytes the signature's `/ByteRange` covers, AND
 *   2. the authenticated attributes' RSA signature verifies against the public key
 *      of the certificate EMBEDDED IN THAT CMS (so distinct-cert co-signatures each
 *      validate against their own signer).
 *
 * node-forge's pkcs7 SignedData has no public `verify()`, so we verify manually
 * from `rawCapture` — the robust path for the inputs this app produces.
 *
 * ⚠️ EXPERIMENTAL / NOT WIRED INTO THE APP — companion to {@link addIncrementalSignature}.
 * Kept out of the `index.ts` barrel so it never enters the shipped surface. Used by
 * the incremental-signing test suite to prove BOTH signatures stay valid after an
 * append-only update.
 *
 * NOTE: this proves ByteRange-digest + RSA-signature correctness only. Trust-chain
 * validation (is the cert trusted? not revoked? time-valid?) and third-party reader
 * acceptance (Adobe/DSS) are explicitly OUT OF SCOPE — see the spike verdict.
 */

import { findContentsSlot, collectSignedBytes } from './byteRange';

/** Outcome of re-verifying one embedded signature. */
export interface SignatureCheck {
  /** Zero-based document-order index of the signature. */
  index: number;
  /** The signature's stored `/ByteRange` numbers `[start1, len1, start2, len2]`. */
  byteRange: [number, number, number, number];
  /** messageDigest authenticated attribute === SHA-256 of the covered span. */
  digestMatches: boolean;
  /** The authenticated-attributes signature verifies against the embedded cert. */
  signatureValid: boolean;
  /** Subject CN of the CMS-embedded signer certificate, if present. */
  signerCommonName?: string;
}

/** Minimal structural shape of the node-forge slice we touch (kept local — no static forge import). */
interface ForgeVerifyLike {
  util: { createBuffer(input?: string, encoding?: string): { getBytes(): string } };
  asn1: {
    Class: { UNIVERSAL: number };
    Type: { SET: number };
    fromDer(bytes: unknown, options?: { parseAllBytes?: boolean }): unknown;
    toDer(obj: unknown): { getBytes(): string };
    create(tagClass: number, type: number, constructed: boolean, value: unknown): unknown;
    derToOid(bytes: string): string;
  };
  md: { sha256: { create(): ForgeMd } };
  pki: {
    oids: Record<string, string>;
  };
  pkcs7: { messageFromAsn1(obj: unknown): ForgeP7Message };
}

interface ForgeMd {
  update(bytes: string, encoding?: string): void;
  digest(): { getBytes(): string };
}

interface ForgeAsn1Obj {
  value: ForgeAsn1Obj[] | string;
}

interface ForgeP7Message {
  certificates: Array<{ publicKey: ForgePublicKey; subject?: { getField(sn: string): { value?: string } | null } }>;
  rawCapture: {
    signature: string;
    authenticatedAttributes?: ForgeAsn1Obj[];
  };
}

interface ForgePublicKey {
  verify(digest: string, signature: string): boolean;
}

/** Hex string (any case, may be trailing-zero-padded) → bytes. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** Bytes → node-forge binary string (chunked to avoid stack overflow on large spans). */
function bytesToBinaryString(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  return out;
}

/** Latin-1 decode of a byte array (1:1 byte→charCode). */
function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Parse every stored `/ByteRange [a b c d]` in document order. */
function collectByteRanges(bytes: Uint8Array): Array<[number, number, number, number]> {
  const s = latin1(bytes);
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const out: Array<[number, number, number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push([Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  return out;
}

/**
 * Collect every signature `/Contents <…>` hex payload in document order. Mirrors
 * `countSignatures`' iteration but captures the hex of each slot (the page content
 * stream's `/Contents` is an indirect ref / array, never a hex string → skipped by
 * `findContentsSlot`).
 */
function collectContentsHex(bytes: Uint8Array): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    let slot;
    try {
      slot = findContentsSlot(bytes.subarray(from));
    } catch {
      break;
    }
    const open = from + slot.open;
    const close = from + slot.close;
    out.push(latin1(bytes.subarray(open + 1, close)));
    from = close + 1;
  }
  return out;
}

/** Extract the messageDigest OCTET STRING (as a forge binary string) from authenticatedAttributes. */
function extractMessageDigest(f: ForgeVerifyLike, attrs: ForgeAsn1Obj[]): string | null {
  const wantOid = f.pki.oids.messageDigest;
  for (const attr of attrs) {
    const seq = attr.value;
    if (!Array.isArray(seq) || seq.length < 2) continue;
    const oidNode = seq[0];
    const valuesSet = seq[1];
    if (typeof oidNode.value !== 'string') continue;
    const oid = f.asn1.derToOid(oidNode.value);
    if (oid !== wantOid) continue;
    const set = valuesSet.value;
    if (!Array.isArray(set) || set.length < 1) continue;
    const octet = set[0].value;
    return typeof octet === 'string' ? octet : null;
  }
  return null;
}

/**
 * Re-verify every embedded signature in a (possibly multi-signed) PDF.
 *
 * @returns one {@link SignatureCheck} per embedded signature, in document order.
 *          A signature whose CMS cannot be parsed is reported with both flags false.
 */
export async function verifyAllSignatures(pdfBytes: Uint8Array): Promise<SignatureCheck[]> {
  const forge = (await import('node-forge')) as unknown as ForgeVerifyLike & { default?: ForgeVerifyLike };
  const f: ForgeVerifyLike = forge.default ?? forge;

  const ranges = collectByteRanges(pdfBytes);
  const hexes = collectContentsHex(pdfBytes);
  const n = Math.min(ranges.length, hexes.length);
  const checks: SignatureCheck[] = [];

  for (let i = 0; i < n; i++) {
    const byteRange = ranges[i];
    const span = collectSignedBytes(pdfBytes, byteRange);

    let digestMatches = false;
    let signatureValid = false;
    let signerCommonName: string | undefined;

    try {
      const der = f.util.createBuffer(bytesToBinaryString(hexToBytes(hexes[i])), 'binary');
      const asn1obj = f.asn1.fromDer(der, { parseAllBytes: false });
      const p7 = f.pkcs7.messageFromAsn1(asn1obj);
      const cert = p7.certificates[0];

      const cnField = cert?.subject?.getField('CN');
      if (cnField && typeof cnField.value === 'string') signerCommonName = cnField.value;

      const attrs = p7.rawCapture.authenticatedAttributes ?? [];

      // (1) messageDigest authenticated attr === SHA-256 of the covered span.
      const contentMd = f.md.sha256.create();
      contentMd.update(bytesToBinaryString(span));
      const expectedDigest = contentMd.digest().getBytes();
      const storedDigest = extractMessageDigest(f, attrs);
      digestMatches = storedDigest !== null && storedDigest === expectedDigest;

      // (2) authenticated-attributes signature verifies against the embedded cert.
      // The signed bytes are the DER of the attributes wrapped in a UNIVERSAL SET
      // (0x31) — NOT the [0] IMPLICIT context tag they carry in the SignerInfo.
      if (cert?.publicKey && attrs.length) {
        const set = f.asn1.create(f.asn1.Class.UNIVERSAL, f.asn1.Type.SET, true, attrs);
        const attrDer = f.asn1.toDer(set).getBytes();
        const attrMd = f.md.sha256.create();
        attrMd.update(attrDer);
        signatureValid = cert.publicKey.verify(attrMd.digest().getBytes(), p7.rawCapture.signature);
      }
    } catch {
      // Unparseable CMS → both flags stay false (reported, not thrown).
    }

    checks.push({ index: i, byteRange, digestMatches, signatureValid, signerCommonName });
  }

  return checks;
}
