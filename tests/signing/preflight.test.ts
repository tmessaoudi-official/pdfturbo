/**
 * S-FLOW (2026-06-15 QA sweep) — cert-free pre-flight validation.
 *
 * The signing UI generates an RSA cert + downloads the .p12/.pem BEFORE the
 * signer validated placement / already-signed. On a placement failure the user
 * got orphan cert downloads and no signed PDF. The fix is a cert-free
 * `PdfSigner.preflight(bytes, page, rect)` the app can call BEFORE cert
 * generation, plus a module-level `isPdfSigned()` it reuses.
 *
 * These run in jsdom: @cantoo/pdf-lib is pure-JS and `preflight` touches no
 * crypto (no node-forge, no .p12).
 */
import { describe, it, expect } from 'vitest';
import { PdfSigner, isPdfSigned } from '../../src/signing/pdfSigner';
import { SignError } from '../../src/signing/types';

const ascii = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** A minimal real PDF with one small page so off-page rects are easy to build. */
async function makePdf(w = 200, h = 200, pages = 1): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([w, h]);
  return doc.save({ useObjectStreams: false });
}

describe('isPdfSigned', () => {
  it('returns false for a freshly-created unsigned PDF', async () => {
    expect(isPdfSigned(await makePdf())).toBe(false);
  });

  it('returns true when both a /ByteRange and /Type /Sig are present', () => {
    expect(isPdfSigned(ascii('%PDF-1.7\n/ByteRange [0 1 2 3]\n/Type /Sig\n'))).toBe(true);
  });

  it('returns true for a /ByteRange paired with a known signature SubFilter', () => {
    expect(
      isPdfSigned(ascii('%PDF-1.7\n/ByteRange [ 0 100 200 50 ]\n/SubFilter /adbe.pkcs7.detached\n')),
    ).toBe(true);
  });

  it('does NOT false-positive on a /ByteRange alone (no signature marker)', () => {
    expect(isPdfSigned(ascii('%PDF-1.7\n/ByteRange [0 1 2 3]\nno signature here\n'))).toBe(false);
  });

  it('does NOT false-positive on a /Type /Sig alone (no ByteRange)', () => {
    expect(isPdfSigned(ascii('%PDF-1.7\n/Type /Sig\n'))).toBe(false);
  });
});

describe('PdfSigner.preflight (cert-free)', () => {
  const validRect = { x: 10, y: 10, width: 100, height: 40 };

  it('throws ALREADY_SIGNED for already-signed bytes — before any load', async () => {
    const signed = ascii('%PDF-1.7\n/ByteRange [0 1 2 3]\n/Type /Sig\n');
    let err: unknown;
    try {
      await new PdfSigner().preflight(signed, 0, validRect);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SignError);
    expect((err as SignError).code).toBe('ALREADY_SIGNED');
  });

  it('throws INVALID_PAGE for an out-of-range page', async () => {
    const pdf = await makePdf();
    await expect(new PdfSigner().preflight(pdf, 9999, validRect)).rejects.toMatchObject({
      code: 'INVALID_PAGE',
    });
  });

  it('throws INVALID_RECT for a rect that exceeds the page bounds', async () => {
    const pdf = await makePdf(200, 200);
    // Default placement x=360/w=200 is off a 200pt-wide page — the live bug.
    await expect(
      new PdfSigner().preflight(pdf, 0, { x: 360, y: 10, width: 200, height: 40 }),
    ).rejects.toMatchObject({ code: 'INVALID_RECT' });
  });

  it('resolves with NO certificate for a valid page + in-bounds rect', async () => {
    const pdf = await makePdf(500, 500, 2);
    await expect(new PdfSigner().preflight(pdf, 1, validRect)).resolves.toBeUndefined();
  });
});
