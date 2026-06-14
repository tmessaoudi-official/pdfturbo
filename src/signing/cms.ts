/**
 * Detached PKCS#7 / CMS signature production via node-forge (DYNAMICALLY IMPORTED).
 *
 * Produces a DER-encoded, detached SignedData over an arbitrary byte span — the
 * "ByteRange digest" of a PDF. Includes the signer cert + chain and standard
 * authenticated attributes (contentType, messageDigest, signingTime) so common
 * validators accept the signature.
 */

import { SignError } from './types';
import type { P12Material } from './p12';

interface ForgeCmsLike {
  util: {
    createBuffer(input?: string, encoding?: string): ForgeBuffer;
  };
  asn1: { toDer(obj: unknown): ForgeBuffer };
  pkcs7: {
    createSignedData(): ForgeSignedData;
  };
  pki: { oids: Record<string, string> };
}

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
export async function buildDetachedCms(signedBytes: Uint8Array, material: P12Material): Promise<Uint8Array> {
  const forge = (await import('node-forge')) as unknown as ForgeCmsLike & { default?: ForgeCmsLike };
  const f: ForgeCmsLike = forge.default ?? forge;

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
