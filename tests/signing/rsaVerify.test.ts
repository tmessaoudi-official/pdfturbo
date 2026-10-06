/**
 * The RSA signature check behind `verifyAllSignatures` (node-forge advisory GHSA-86w9-cpqp-85rv, 2026-10-02).
 * node-forge <= 1.4.0 accepts a PKCS#1 v1.5 signature whose DigestInfo carries EXTRA elements inside the DigestAlgorithm
 * sequence (it never checks the element count), which lets an attacker forge a signature for a low-exponent key. WebCrypto's
 * RSASSA-PKCS1-v1_5 re-encodes the expected block and compares it whole, so it rejects any such structure. These cases build the
 * malformed signature with a REAL private key, so the padding and the RSA operation are valid and only the structure is wrong.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
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

// The guard behind the audit exemption (scripts/audit-gate-allowlist.json, GHSA-86w9-cpqp-85rv): no `.verify(` call may ship
// except WebCrypto's. It scans what ships, not one directory: every code file under src/ (any depth), plus the HTML pages with
// inline scripts (index.html, public/*.html). It was scoped to src/signing, flat, until the 2026-10-06 audit: a forge
// `cert.publicKey.verify(...)` in src/handlers/ or in src/signing/<sub>/ passed it while the exemption kept the audit green.
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const strip = (src: string) =>
  src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function shippedSources(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (CODE.test(e.name)) out.push(p);
    }
  };
  walk(join(root, 'src'));
  if (existsSync(join(root, 'index.html'))) out.push(join(root, 'index.html'));
  if (existsSync(join(root, 'public'))) {
    for (const page of readdirSync(join(root, 'public'))) if (page.endsWith('.html')) out.push(join(root, 'public', page));
  }
  return out;
}
/** Files under `root` that call `.verify(` other than WebCrypto's `crypto.subtle.verify(`, relative to `root`. */
function forgeVerifyOffenders(root: string): { scanned: string[]; webCrypto: string[]; offenders: string[] } {
  const files = shippedSources(root).map((abs) => ({ f: relative(root, abs), code: strip(readFileSync(abs, 'utf8')) }));
  return {
    scanned: files.map((x) => x.f),
    webCrypto: files.filter((x) => x.code.includes("crypto.subtle.verify('RSASSA-PKCS1-v1_5'")).map((x) => x.f),
    offenders: files.filter((x) => /\.verify\s*\(/.test(x.code.split('crypto.subtle.verify(').join(''))).map((x) => x.f),
  };
}

describe('no forge RSA verification anywhere that ships (GHSA-86w9-cpqp-85rv)', () => {
  // The behavioural cases above pin the helper; this pins that nothing calls forge's own `publicKey.verify` / `cert.verify` instead.
  // Comments are stripped first (this very advisory is named in several), and the guard is anchored on the WebCrypto call so an
  // empty scan cannot pass.
  const repo = resolve(__dirname, '../..');

  it('scans every shipped source and finds the ONE WebCrypto verify it relies on (non-vacuity)', () => {
    const r = forgeVerifyOffenders(repo);
    expect(r.scanned.length).toBeGreaterThanOrEqual(150);
    expect(r.scanned).toContain(join('src', 'signing', 'cmsVerify.ts'));
    expect(r.scanned).toContain('index.html');
    expect(r.webCrypto).toEqual([join('src', 'signing', 'cmsVerify.ts')]);
  });

  it('no `.verify(` call at all except WebCrypto\'s (a forge key, a certificate, a cast, an alias)', () => {
    expect(forgeVerifyOffenders(repo).offenders).toEqual([]);
  });

  it('control: a forge `.verify(` planted OUTSIDE src/signing, in a nested signing dir or in a page script is caught', () => {
    const root = mkdtempSync(join(tmpdir(), 'pdfturbo-verify-guard-'));
    try {
      const put = (file: string, body: string) => {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), body);
      };
      put('src/signing/cmsVerify.ts', "await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);\n");
      put('src/handlers/signaturePanel.ts', 'export const ok = cert.publicKey.verify(md.digest().bytes(), sig);\n');
      put('src/signing/sub/chain.ts', 'export const ok = caStore.verify (cert);\n');
      put('src/ui/clean.ts', '// cert.verify(x) in a comment is not a call\nexport const n = 1;\n');
      put('public/page.html', '<script>forge.pki.verifyCertificateChain; key.verify(a, b)</script>\n');
      expect(forgeVerifyOffenders(root).offenders.sort()).toEqual(
        [join('public', 'page.html'), join('src', 'handlers', 'signaturePanel.ts'), join('src', 'signing', 'sub', 'chain.ts')].sort(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
