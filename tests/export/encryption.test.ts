/**
 * First automated tests for the "Lock PDF" encryption module (G6).
 *
 * Two surfaces:
 *  - the pure password-strength gate (`validateUserPassword` + `MIN_PASSWORD_LENGTH`)
 *    that rejects empty / too-short open passwords before encryption is attempted;
 *  - `randomOwnerPassword` (distinct strong owner secret) and `encryptPdf` itself.
 *
 * Encryption is proven against what @cantoo/pdf-lib actually emits (verified live):
 *  1. the saved bytes carry an `/Encrypt` trailer entry AND the `AESV3` filter
 *     (AES-256 — the 1.7ext3 lever, NOT the AES-128 default);
 *  2. `PDFDocument.load(encryptedBytes)` THROWS (EncryptedPDFError) while the SAME
 *     doc saved WITHOUT encryptPdf loads fine — a behavioral control proving the
 *     output is genuinely locked, not merely tagged;
 *  3. the in-memory header became `%PDF-1.7ext3` (`context.header.toString()`) — the
 *     AES-256 selector. NB: the serialized first bytes are `%PDF-1.7` (the library
 *     drops the `ext3` suffix from the written header line), so the header lever is
 *     asserted in memory, not via the saved-byte prefix.
 *
 * Pure pdf-lib + crypto.getRandomValues (jsdom provides WebCrypto) — no browser.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import {
  MIN_PASSWORD_LENGTH,
  validateUserPassword,
  randomOwnerPassword,
  encryptPdf,
} from '../../src/export/encryption';

/** A minimal one-page pdf-lib document. */
async function minimalDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc;
}

describe('validateUserPassword (password-strength gate)', () => {
  it('floor is the NIST SP 800-63B minimum of 8', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it('empty password → toast.passwordRequired', () => {
    expect(validateUserPassword('')).toBe('toast.passwordRequired');
  });

  it('a 3-char password → toast.passwordTooWeak', () => {
    expect(validateUserPassword('abc')).toBe('toast.passwordTooWeak');
  });

  it('a 7-char password (one below the floor) → toast.passwordTooWeak', () => {
    expect(validateUserPassword('1234567')).toBe('toast.passwordTooWeak');
  });

  it('an 8-char password (exactly the floor) → null (accepted)', () => {
    expect(validateUserPassword('12345678')).toBeNull();
  });
});

describe('randomOwnerPassword', () => {
  it('returns a 48-char hex string (24 bytes)', () => {
    const pw = randomOwnerPassword();
    expect(pw).toHaveLength(48);
    expect(pw).toMatch(/^[0-9a-f]{48}$/);
  });

  it('two calls differ (random)', () => {
    expect(randomOwnerPassword()).not.toBe(randomOwnerPassword());
  });
});

describe('encryptPdf', () => {
  it('produces an /Encrypt trailer entry and the AESV3 (AES-256) filter', async () => {
    const doc = await minimalDoc();
    await encryptPdf(doc, { userPassword: 'password1', ownerPassword: randomOwnerPassword() });
    const bytes = await doc.save();
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('/Encrypt');
    expect(text).toContain('AESV3');
  });

  it('bumps the in-memory header to 1.7ext3 (the AES-256 lever)', async () => {
    const doc = await minimalDoc();
    await encryptPdf(doc, { userPassword: 'password1', ownerPassword: randomOwnerPassword() });
    expect(doc.context.header.toString()).toContain('1.7ext3');
  });

  it('the encrypted output cannot be re-opened with a plain load, but the un-encrypted control can', async () => {
    // Encrypted: PDFDocument.load throws EncryptedPDFError (no ignoreEncryption).
    const encDoc = await minimalDoc();
    await encryptPdf(encDoc, { userPassword: 'password1', ownerPassword: randomOwnerPassword() });
    const encBytes = await encDoc.save();
    await expect(PDFDocument.load(encBytes)).rejects.toThrow(/encrypted/i);

    // Control: the SAME minimal doc saved WITHOUT encryptPdf loads fine.
    const plainBytes = await (await minimalDoc()).save();
    await expect(PDFDocument.load(plainBytes)).resolves.toBeInstanceOf(PDFDocument);
  });
});
