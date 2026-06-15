/**
 * In-browser self-signed certificate generation for e-signing — "generate a
 * cert on the spot" (no .p12 upload needed). node-forge is DYNAMICALLY IMPORTED
 * so the crypto lib stays a lazy chunk.
 *
 * Produces an RSA-2048 key + self-signed X.509 certificate packaged as a
 * PKCS#12 container whose bytes feed the existing PdfSigner unchanged (it only
 * wants `{ p12, passphrase }`). Also emits the PEM public certificate so the
 * signer can share it for trust.
 *
 * TRUST CAVEAT (surfaced in the UI): a self-signed cert is cryptographically
 * valid but NOT chained to a CA — validators (Adobe, etc.) show "validity
 * unknown / not trusted" until the recipient explicitly trusts this certificate.
 * Everything stays in the browser; nothing is uploaded.
 */

import { SignError } from './types';

/** X.509 subject fields collected from the UI. Only commonName is required. */
export interface CertIdentity {
  /** Common Name (CN) — the signer's name; required. */
  commonName: string;
  /** Organization (O) — optional. */
  organization?: string;
  /** Email address (emailAddress attr + rfc822 subjectAltName) — optional. */
  email?: string;
  /** Two-letter ISO country code (C) — optional. */
  country?: string;
  /** Validity in years from now; defaults to 1, clamped to [1, 30]. */
  validityYears?: number;
}

/** A freshly generated signing identity. */
export interface GeneratedCert {
  /** PKCS#12 (.p12) container bytes (key + self-signed cert), protected by `passphrase`. */
  p12: Uint8Array;
  /** PEM-encoded public certificate (shareable for trust). */
  pem: string;
  /** The passphrase protecting the PKCS#12 (echoed back for download/import). */
  passphrase: string;
}

// Minimal structural slice of node-forge we touch — kept local so forge's types
// never load statically (which would defeat the lazy chunk), mirroring p12.ts/cms.ts.
interface ForgeCertGenLike {
  pki: {
    rsa: {
      generateKeyPair(
        opts: { bits: number; e?: number },
        cb: (err: Error | null, keypair: ForgeKeyPair) => void,
      ): void;
    };
    createCertificate(): ForgeCertificate;
    certificateToPem(cert: ForgeCertificate): string;
    oids: Record<string, string>;
  };
  md: { sha256: { create(): unknown } };
  pkcs12: {
    toPkcs12Asn1(
      key: unknown,
      cert: unknown,
      password: string,
      opts?: { algorithm?: string; generateLocalKeyId?: boolean; friendlyName?: string },
    ): unknown;
  };
  asn1: { toDer(obj: unknown): { getBytes(): string } };
}

interface ForgeKeyPair {
  privateKey: unknown;
  publicKey: unknown;
}

interface ForgeAttr {
  name?: string;
  shortName?: string;
  value: string;
}

interface ForgeCertificate {
  publicKey: unknown;
  serialNumber: string;
  validity: { notBefore: Date; notAfter: Date };
  setSubject(attrs: ForgeAttr[]): void;
  setIssuer(attrs: ForgeAttr[]): void;
  setExtensions(exts: Array<Record<string, unknown>>): void;
  sign(key: unknown, md?: unknown): void;
}

/** Convert a node-forge binary string to bytes (chunked — avoids stack overflow). */
function binaryStringToBytes(bin: string): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/** A positive, even-length hex serial with a leading 00 so the high bit never marks it negative. */
function randomSerialHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = '00';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Validate the identity before any expensive keygen. */
export function validateCertIdentity(identity: CertIdentity): void {
  if (!identity.commonName || !identity.commonName.trim()) {
    throw new SignError('NO_CERTIFICATE', 'A name (Common Name) is required to generate a certificate.');
  }
  if (identity.country && identity.country.trim().length !== 2) {
    throw new SignError('NO_CERTIFICATE', 'Country must be a 2-letter ISO code (e.g. FR).');
  }
}

/**
 * Generate an RSA-2048 key + self-signed X.509 cert and package it as PKCS#12.
 * @throws {SignError} NO_CERTIFICATE on invalid identity, SIGN_FAILED on crypto error.
 */
export async function generateSelfSignedP12(identity: CertIdentity, passphrase: string): Promise<GeneratedCert> {
  validateCertIdentity(identity);
  const forge = (await import('node-forge')) as unknown as ForgeCertGenLike & { default?: ForgeCertGenLike };
  const f: ForgeCertGenLike = forge.default ?? forge;

  try {
    const keys = await new Promise<ForgeKeyPair>((resolve, reject) => {
      f.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 }, (err, kp) => (err ? reject(err) : resolve(kp)));
    });

    const cert = f.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = randomSerialHex();
    const now = new Date();
    const years = Math.min(30, Math.max(1, Math.floor(identity.validityYears ?? 1)));
    cert.validity.notBefore = now;
    cert.validity.notAfter = new Date(now.getFullYear() + years, now.getMonth(), now.getDate());

    const attrs: ForgeAttr[] = [{ name: 'commonName', value: identity.commonName.trim() }];
    if (identity.organization?.trim()) attrs.push({ name: 'organizationName', value: identity.organization.trim() });
    if (identity.country?.trim()) attrs.push({ shortName: 'C', value: identity.country.trim().toUpperCase() });
    if (identity.email?.trim()) attrs.push({ name: 'emailAddress', value: identity.email.trim() });
    cert.setSubject(attrs);
    cert.setIssuer(attrs); // self-signed: issuer === subject

    const exts: Array<Record<string, unknown>> = [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
      { name: 'extKeyUsage', emailProtection: true, clientAuth: true },
    ];
    if (identity.email?.trim()) {
      exts.push({ name: 'subjectAltName', altNames: [{ type: 1, value: identity.email.trim() }] });
    }
    cert.setExtensions(exts);
    cert.sign(keys.privateKey, f.md.sha256.create());

    const p12Asn1 = f.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
      algorithm: '3des',
      generateLocalKeyId: true,
      friendlyName: identity.commonName.trim(),
    });
    const p12 = binaryStringToBytes(f.asn1.toDer(p12Asn1).getBytes());
    const pem = f.pki.certificateToPem(cert);
    return { p12, pem, passphrase };
  } catch (err) {
    if (err instanceof SignError) throw err;
    throw new SignError('SIGN_FAILED', 'Certificate generation failed.', { cause: err });
  }
}
