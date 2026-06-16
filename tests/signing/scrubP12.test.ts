/**
 * M3 #33 — scrub the forge private-key material, not just the .p12 container
 * bytes. node-forge keeps RSA components as jsbn BigIntegers whose secret digits
 * live in a `.data` number[]; we overwrite those digits in place (genuinely
 * clearing the secret from memory) and drop the references. The container bytes
 * are already zeroed by the handler on every path; the passphrase is an
 * immutable JS string and cannot be scrubbed — a language limit, not an oversight.
 */
import { describe, it, expect } from 'vitest';
import { scrubForgeKey, scrubP12Material, type P12Material } from '../../src/signing/p12';

/** A forge-like RSA private key: each component is a jsbn BigInteger ({ data: digits }). */
function fakeForgeKey() {
  return {
    n: { data: [9, 9, 9] }, e: { data: [1] },
    d: { data: [5, 5, 5, 5] }, p: { data: [3, 3] }, q: { data: [7, 7] },
    dP: { data: [2, 2] }, dQ: { data: [4, 4] }, qInv: { data: [6, 6] },
  };
}

describe('M3 #33 — scrubForgeKey', () => {
  it('zeroes every BigInteger digit array in place and nulls the fields', () => {
    const key = fakeForgeKey();
    const secretDigits = key.d.data; // capture the live array before refs are dropped
    scrubForgeKey(key);
    expect(secretDigits.every((d) => d === 0)).toBe(true);
    for (const f of ['n', 'e', 'd', 'p', 'q', 'dP', 'dQ', 'qInv'] as const) {
      expect((key as Record<string, unknown>)[f]).toBeNull();
    }
  });

  it('is a safe no-op on null / non-object input', () => {
    expect(() => scrubForgeKey(null)).not.toThrow();
    expect(() => scrubForgeKey(undefined)).not.toThrow();
    expect(() => scrubForgeKey(42)).not.toThrow();
  });

  it('tolerates a key missing some components', () => {
    const partial = { d: { data: [1, 2] } } as unknown;
    expect(() => scrubForgeKey(partial)).not.toThrow();
    expect((partial as { d: unknown }).d).toBeNull();
  });
});

describe('M3 #33 — scrubP12Material', () => {
  it('scrubs the private key and nulls the reference', () => {
    const key = fakeForgeKey();
    const dDigits = key.d.data;
    const material: P12Material = {
      privateKey: key,
      certificate: {},
      chain: [{}],
      commonName: 'Test',
    };
    scrubP12Material(material);
    expect(dDigits.every((d) => d === 0)).toBe(true);
    expect(material.privateKey).toBeNull();
  });

  it('is a safe no-op when the key was already cleared', () => {
    const material: P12Material = { privateKey: null, certificate: {}, chain: [] };
    expect(() => scrubP12Material(material)).not.toThrow();
    expect(material.privateKey).toBeNull();
  });
});
