/**
 * Signing handler — pure form→SignOptions mapping.
 *
 * The full sign() path (assemble bytes → PKCS#12 CMS → download) needs a real
 * browser (forge WASM-free but pdf-lib assembly + Blob/anchor download) and a
 * generated .p12; it is covered by the browser harness. Here we unit-test the
 * deterministic UI-form → signer-options mapping in jsdom.
 */
import { describe, it, expect } from 'vitest';
import { buildSignOptions, type SignFormInput } from '../../src/handlers/signingHandler';

const base: SignFormInput = {
  p12: new Uint8Array([1, 2, 3]),
  passphrase: 'secret',
  page: 1,
  x: 40,
  y: 50,
  width: 220,
  height: 64,
};

describe('buildSignOptions', () => {
  it('converts the 1-based UI page to a 0-based signer index', () => {
    expect(buildSignOptions({ ...base, page: 1 }).page).toBe(0);
    expect(buildSignOptions({ ...base, page: 3 }).page).toBe(2);
  });

  it('never produces a negative page index', () => {
    expect(buildSignOptions({ ...base, page: 0 }).page).toBe(0);
    expect(buildSignOptions({ ...base, page: -5 }).page).toBe(0);
  });

  it('maps x/y/width/height into the appearance rect', () => {
    const opts = buildSignOptions(base);
    expect(opts.rect).toEqual({ x: 40, y: 50, width: 220, height: 64 });
  });

  it('passes through p12 bytes and passphrase verbatim', () => {
    const opts = buildSignOptions(base);
    expect(opts.p12).toBe(base.p12);
    expect(opts.passphrase).toBe('secret');
  });

  it('trims optional strings and drops empty ones to undefined', () => {
    const opts = buildSignOptions({
      ...base,
      reason: '  I approve  ',
      location: '',
      name: '   ',
    });
    expect(opts.reason).toBe('I approve');
    expect(opts.location).toBeUndefined();
    expect(opts.name).toBeUndefined();
  });

  it('floors a fractional page number before converting', () => {
    expect(buildSignOptions({ ...base, page: 2.9 }).page).toBe(1);
  });
});
