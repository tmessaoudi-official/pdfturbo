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
