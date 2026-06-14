/**
 * PKCS#12 (.p12 / .pfx) loading via node-forge — DYNAMICALLY IMPORTED so the
 * ~85 KB forge crypto lib becomes a lazy chunk and never bloats the main bundle.
 *
 * Everything stays in the browser: the container bytes and passphrase are passed
 * straight into forge in-memory and never serialised out.
 */

import { SignError } from './types';

/** Material extracted from a PKCS#12 container, ready to feed a CMS signer. */
export interface P12Material {
  /** The signer's private key (node-forge `pki.PrivateKey`). */
  privateKey: unknown;
  /** The signer's leaf certificate (node-forge `pki.Certificate`). */
  certificate: unknown;
  /** The full certificate chain (leaf first), for embedding in the CMS. */
  chain: unknown[];
  /** The common name (CN) of the leaf certificate subject, if present. */
  commonName?: string;
}

// Minimal structural shape of the slice of node-forge we touch. Kept local so we
// never import forge's types statically (which would defeat the lazy chunk).
interface ForgeLike {
  util: {
    createBuffer(input: string, encoding?: string): { getBytes(): string };
  };
  asn1: { fromDer(bytes: unknown): unknown };
  pkcs12: {
    pkcs12FromAsn1(asn1: unknown, password?: string): ForgeP12;
    pkcs12FromAsn1(asn1: unknown, strict: boolean, password?: string): ForgeP12;
  };
  pki: {
    oids: Record<string, string>;
  };
}

interface ForgeP12 {
  getBags(filter: { bagType?: string; localKeyId?: unknown }): Record<string, ForgeBag[] | undefined>;
}

interface ForgeBag {
  key?: unknown;
  cert?: { subject?: { getField(sn: string): { value?: string } | null } } | unknown;
}

/** Convert raw bytes to the binary "string" node-forge expects for DER input. */
function bytesToBinaryString(bytes: Uint8Array): string {
  // Avoid String.fromCharCode(...spread) on large arrays (stack overflow); chunk it.
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  return out;
}

/**
 * Parse and unlock a PKCS#12 container, returning the signing key + cert chain.
 *
 * @param p12 raw container bytes (never leaves the browser)
 * @param passphrase container passphrase ('' if unprotected)
 * @throws {SignError} INVALID_P12 | WRONG_PASSPHRASE | NO_PRIVATE_KEY | NO_CERTIFICATE
 */
export async function loadP12(p12: Uint8Array, passphrase: string): Promise<P12Material> {
  // DYNAMIC IMPORT — lazy crypto chunk. Do NOT hoist to a top-level static import.
  const forge = (await import('node-forge')) as unknown as ForgeLike & { default?: ForgeLike };
  const f: ForgeLike = forge.default ?? forge;

  let p12Obj: ForgeP12;
  try {
    const der = f.util.createBuffer(bytesToBinaryString(p12), 'binary');
    const asn1 = f.asn1.fromDer(der);
    // forge accepts (asn1, password) or (asn1, strict, password); use the strict form.
    p12Obj = f.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
  } catch (cause) {
    // forge throws a generic Error on both malformed DER and MAC mismatch. We map
    // the common "Invalid password" / MAC message to WRONG_PASSPHRASE, else INVALID_P12.
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (/mac|password|invalid pkcs#12/i.test(msg)) {
      throw new SignError('WRONG_PASSPHRASE', 'Incorrect passphrase or corrupted PKCS#12 file.', {
        cause,
      });
    }
    throw new SignError('INVALID_P12', 'Could not parse the PKCS#12 (.p12) file.', { cause });
  }

  const oids = f.pki.oids;
  const keyBags = p12Obj.getBags({ bagType: oids.pkcs8ShroudedKeyBag });
  const plainKeyBags = p12Obj.getBags({ bagType: oids.keyBag });
  const keyBag =
    firstBagWith(keyBags[oids.pkcs8ShroudedKeyBag], (b) => b.key !== undefined && b.key !== null) ??
    firstBagWith(plainKeyBags[oids.keyBag], (b) => b.key !== undefined && b.key !== null);

  if (!keyBag?.key) {
    throw new SignError('NO_PRIVATE_KEY', 'No private key found in the PKCS#12 container.');
  }

  const certBags = p12Obj.getBags({ bagType: oids.certBag });
  const certs = (certBags[oids.certBag] ?? []).filter(
    (b): b is ForgeBag & { cert: unknown } => b.cert !== undefined && b.cert !== null,
  );
  if (certs.length === 0) {
    throw new SignError('NO_CERTIFICATE', 'No certificate found in the PKCS#12 container.');
  }

  const chain = certs.map((b) => b.cert);
  const leaf = chain[0];

  return {
    privateKey: keyBag.key,
    certificate: leaf,
    chain,
    commonName: extractCommonName(leaf),
  };
}

function firstBagWith(bags: ForgeBag[] | undefined, pred: (b: ForgeBag) => boolean): ForgeBag | undefined {
  if (!bags) return undefined;
  for (const b of bags) {
    if (pred(b)) return b;
  }
  return undefined;
}

/** Best-effort extraction of the subject CN from a forge certificate. */
function extractCommonName(cert: unknown): string | undefined {
  const c = cert as { subject?: { getField(sn: string): { value?: string } | null } };
  try {
    const field = c.subject?.getField('CN');
    const value = field?.value;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
