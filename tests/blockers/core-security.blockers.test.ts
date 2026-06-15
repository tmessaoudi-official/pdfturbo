/**
 * Core security blockers — confirming tests. See ./README.md for the convention.
 * Source research: docs/reviews/research-2026-06-15-blockers/raw/core.md
 *
 * Replicates the exact "Lock PDF" call the app makes (exportService._applyExportPassword:
 * `pdfDoc.encrypt({ userPassword, ownerPassword })` with NO algorithm/permissions) and
 * inspects the resulting /Encrypt dict.
 */
import { describe, it, expect } from 'vitest';

type Encryptable = { encrypt(o: { userPassword: string; ownerPassword: string }): void };

async function encryptLikeTheApp(): Promise<string> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  (doc as unknown as Encryptable).encrypt({ userPassword: 'open', ownerPassword: 'owner' });
  const bytes = await doc.save({ useObjectStreams: false });
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

describe('Core blocker CORE-P0-2 — "Lock PDF" is AES-128, not AES-256', () => {
  // REACHABLE. encrypt() is called with no algorithm; @cantoo/pdf-lib derives the
  // revision from the (default 1.7) header → V=4, AESV2 (128-bit). AES-256 (V5/R6)
  // needs the 1.7ext3 header, which the app never sets.
  it.fails('encrypts with AES-256 (V5 / AESV3)', async () => {
    const s = await encryptLikeTheApp();
    // DESIRED: AES-256. TODAY: /CF .. AESV2 and /V 4.
    expect(s).toMatch(/AESV3|\/V 5\b/);
  });

  it('documents the current AES-128 / V4 behavior (pin)', async () => {
    const s = await encryptLikeTheApp();
    expect(s).toContain('/Encrypt');
    expect(s).toMatch(/AESV2|\/V 4\b/);
  });
});
