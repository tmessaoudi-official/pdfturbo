/**
 * M1 #15 — signing error-path coverage for loadP12. The PKCS#12 loader maps forge's
 * generic failures to typed SignErrorCodes the UI branches on; those paths had no
 * direct test. We generate a REAL self-signed .p12 (certGen) so the wrong-passphrase
 * path exercises a genuine MAC mismatch, not a mock. Runs in jsdom (node-forge is
 * pure JS). ALREADY_SIGNED / INVALID_PAGE / INVALID_RECT are covered by preflight.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { loadP12 } from '../../src/signing/p12';
import { generateSelfSignedP12, type CertIdentity } from '../../src/signing/certGen';
import { SignError } from '../../src/signing/types';

const IDENTITY: CertIdentity = {
  commonName: 'Test Signer',
  organization: 'PDFturbo',
  email: 'signer@example.test',
  country: 'FR',
  validityYears: 1,
};

describe('loadP12 — error-path contract (M1 #15)', () => {
  it('loads a valid container with the correct passphrase (control)', async () => {
    const { p12 } = await generateSelfSignedP12(IDENTITY, 'correct-pw');
    const material = await loadP12(p12, 'correct-pw');
    expect(material.privateKey).toBeTruthy();
    expect(material.certificate).toBeTruthy();
    expect(material.commonName).toBe('Test Signer');
  });

  it('throws WRONG_PASSPHRASE on a real MAC mismatch', async () => {
    const { p12 } = await generateSelfSignedP12(IDENTITY, 'correct-pw');
    const err = await loadP12(p12, 'wrong-pw').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignError);
    expect((err as SignError).code).toBe('WRONG_PASSPHRASE');
  });

  it('throws INVALID_P12 on malformed (non-DER) bytes', async () => {
    const err = await loadP12(new Uint8Array([1, 2, 3, 4, 5]), '').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignError);
    expect((err as SignError).code).toBe('INVALID_P12');
  });

  it('throws INVALID_P12 on empty bytes', async () => {
    const err = await loadP12(new Uint8Array(0), '').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignError);
    expect((err as SignError).code).toBe('INVALID_P12');
  });
});
