/**
 * The RSA signature check behind `verifyAllSignatures` (node-forge advisory GHSA-86w9-cpqp-85rv, 2026-10-02).
 * node-forge <= 1.4.0 accepts a PKCS#1 v1.5 signature whose DigestInfo carries EXTRA elements inside the DigestAlgorithm
 * sequence (it never checks the element count), which lets an attacker forge a signature for a low-exponent key. WebCrypto's
 * RSASSA-PKCS1-v1_5 re-encodes the expected block and compares it whole, so it rejects any such structure. These cases build the
 * malformed signature with a REAL private key, so the padding and the RSA operation are valid and only the structure is wrong.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyRsaSha256 } from '../../src/signing/cmsVerify';

type Forge = typeof import('node-forge');
let forge: Forge;
let keys: ReturnType<Forge['pki']['rsa']['generateKeyPair']>;
// the helper takes a structural slice of forge; @types/node-forge is not that shape
let f: Parameters<typeof verifyRsaSha256>[0];
const DATA = 'the signed attributes, DER';

/** A signature whose DigestInfo is `SEQ{ SEQ{ OID, NULL, <extra> }, OCTET digest }`, padded and RSA-signed correctly. */
function craftedSignature(extra: boolean): string {
  const a = forge.asn1;
  const md = forge.md.sha256.create();
  md.update(DATA);
  const algorithm = [a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(forge.pki.oids.sha256).getBytes()), a.create(a.Class.UNIVERSAL, a.Type.NULL, false, '')];
  if (extra) algorithm.push(a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, 'garbage-element'));
  const info = a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [
    a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, algorithm),
    a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, md.digest().getBytes()),
  ]);
  // type-01 padding and the private-key operation, exactly what `sign` does after it has built its own DigestInfo
  return (forge.pki.rsa as unknown as { encrypt(m: string, key: unknown, bt: number): string }).encrypt(a.toDer(info).getBytes(), keys.privateKey, 0x01);
}

describe('verifyRsaSha256', () => {
  beforeAll(async () => {
    const m = (await import('node-forge')) as unknown as Forge & { default?: Forge };
    forge = m.default ?? m;
    f = forge as unknown as typeof f;
    keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  });

  it('accepts a correct signature', async () => {
    const md = forge.md.sha256.create();
    md.update(DATA);
    expect(await verifyRsaSha256(f, keys.publicKey, DATA, keys.privateKey.sign(md))).toBe(true);
  });

  it('control: the hand-built DigestInfo WITHOUT the extra element verifies too (the builder is sound)', async () => {
    expect(await verifyRsaSha256(f, keys.publicKey, DATA, craftedSignature(false))).toBe(true);
  });

  it('rejects a signature over different data', async () => {
    const md = forge.md.sha256.create();
    md.update(DATA);
    expect(await verifyRsaSha256(f, keys.publicKey, DATA + '!', keys.privateKey.sign(md))).toBe(false);
  });

  it('REJECTS a DigestInfo with an extra element inside the DigestAlgorithm sequence (the advisory)', async () => {
    expect(await verifyRsaSha256(f, keys.publicKey, DATA, craftedSignature(true))).toBe(false);
  });

  it('rejects garbage that is not a signature at all, without throwing', async () => {
    expect(await verifyRsaSha256(f, keys.publicKey, DATA, 'x'.repeat(128))).toBe(false);
  });
});

describe('no forge RSA verification anywhere in src/signing (GHSA-86w9-cpqp-85rv)', () => {
  // The behavioural cases above pin the helper; this pins that nothing calls forge's own `publicKey.verify` / `cert.verify` instead.
  // Comments are stripped first (this very advisory is named in several), and the guard is anchored on the WebCrypto call so an
  // empty scan cannot pass.
  const dir = resolve(__dirname, '../../src/signing');
  const code = (f: string) => readFileSync(resolve(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const files = readdirSync(dir).filter(f => f.endsWith('.ts'));

  it('scans the signing sources and finds the WebCrypto verify it relies on (non-vacuity)', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(code('cmsVerify.ts')).toContain("crypto.subtle.verify('RSASSA-PKCS1-v1_5'");
  });

  it('no `.verify(` call at all except WebCrypto\'s (a forge key, a certificate, a cast, an alias)', () => {
    const offenders = files.filter(f => /\.verify\s*\(/.test(code(f).split('crypto.subtle.verify(').join('')));
    expect(offenders).toEqual([]);
  });
});
