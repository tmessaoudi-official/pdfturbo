/**
 * Core security blockers — confirming tests. See ./README.md for the convention.
 * Source research: research-2026-06-15-blockers/raw/core.md (removed from the repo — see ./README.md)
 *
 * CORE-P0-2 is now FIXED: these exercise the REAL `encryptPdf` helper (the same
 * one exportService._applyExportPassword calls) and assert AES-256 + usable
 * permissions + decryptability — not a replica of the old crippled call.
 */
import { describe, it, expect } from 'vitest';
import { encryptPdf } from '../../src/export/encryption';

async function lock(): Promise<{ s: string; bytes: Uint8Array }> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  await encryptPdf(doc, { userPassword: 'open', ownerPassword: 'owner-distinct' });
  const bytes = await doc.save({ useObjectStreams: false });
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return { s, bytes };
}

/** Pull the /P permission integer out of the serialized Encrypt dict. */
function permissionInt(s: string): number {
  const m = s.match(/\/P\s+(-?\d+)/);
  if (!m) throw new Error('no /P permission flag found');
  return Number(m[1]);
}

describe('Core blocker CORE-P0-2 — "Lock PDF" is AES-256 with usable permissions (FIXED)', () => {
  it('encrypts with AES-256 (V5 / AESV3), not AES-128', async () => {
    const { s } = await lock();
    expect(s).toMatch(/AESV3/);
    expect(s).toMatch(/\/V 5\b/);
    expect(s).not.toMatch(/AESV2/);
  });

  // Ceiling C16 ("pdf-lib hardcodes R:5") closed with the 2026-09-13 upgrade to @cantoo/pdf-lib
  // 2.11.0, which writes /R 6. The ISO 32000-2 hashing behind that /R is proven by the password
  // round-trip in tests/export/exportPasswordSave.test.ts: pdf.js checks an /R 6 password with
  // Algorithm 2.B, so R5-style hashes under an /R 6 label would fail to open there.
  it('writes revision 6 (ceiling C16 closed by the pdf-lib 2.11.0 upgrade)', async () => {
    const { s } = await lock();
    expect(s).toMatch(/\/R 6\b/);
    expect(s).not.toMatch(/\/R 5\b/);
  });

  it('grants usage permissions (printing/copying/accessibility) — not a crippled lock', async () => {
    const p = permissionInt((await lock()).s);
    expect(p & 0b000000000100).not.toBe(0); // printing
    expect(p & 0b000000010000).not.toBe(0); // copying
    expect(p & 0b001000000000).not.toBe(0); // contentAccessibility
  });

  it('is decryptable with the user (open) password and round-trips one page', async () => {
    const { bytes } = await lock();
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const re = await PDFDocument.load(bytes, { password: 'open' });
    expect(re.getPageCount()).toBe(1);
  });
});
