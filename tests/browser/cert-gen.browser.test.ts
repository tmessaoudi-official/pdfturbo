/**
 * Generate-a-cert-on-the-spot, in REAL Chrome (not jsdom). Proves the lazy
 * node-forge import + RSA-2048 keygen + PKCS#12 packaging actually run in the
 * deployed browser environment, and that the generated identity signs a PDF
 * end-to-end via the real PdfSigner. jsdom covers the logic; this covers "does
 * it work where it ships."
 */
import { describe, it, expect } from 'vitest';
import { generateSelfSignedP12 } from '../../src/signing/certGen';
import { PdfSigner } from '../../src/signing/pdfSigner';

describe('certGen (real Chrome)', () => {
  it('generates a self-signed .p12 in-browser and signs a PDF with it', async () => {
    const { p12, pem } = await generateSelfSignedP12(
      { commonName: 'Browser Signer', organization: 'PDFturbo', email: 'b@x.test', country: 'FR', validityYears: 1 },
      'browser-pw',
    );
    expect(p12).toBeInstanceOf(Uint8Array);
    expect(p12.byteLength).toBeGreaterThan(500);
    expect(pem).toContain('BEGIN CERTIFICATE');

    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage([420, 595]);
    const pdf = await doc.save({ useObjectStreams: false });

    const res = await new PdfSigner().sign(pdf, {
      p12: p12.slice(), // sign() zeroes its copy; keep the assertion's bytes intact
      passphrase: 'browser-pw',
      page: 0,
      rect: { x: 72, y: 72, width: 240, height: 70 },
    });
    expect(res.signerCommonName).toBe('Browser Signer');
    expect(res.bytes.byteLength).toBeGreaterThan(pdf.byteLength);
    // 60s: in-browser RSA-2048 keygen + sign is CPU-bound; the default 30s flakes under
    // full-suite contention (passes in isolation). Mirrors the jsdom node-forge bump.
  }, 60_000);
});
