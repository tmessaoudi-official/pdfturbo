/**
 * F-C C1 — embed the drawn signature image into the digital-signature appearance.
 * Covers the pure plumbing (dataUrlToBytes, buildSignOptions passthrough) and a
 * full sign-with-image integration (generated cert → signed PDF carries an image
 * XObject; text-only signing does not).
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { buildSignOptions, dataUrlToBytes } from '../../src/handlers/signingHandler';
import { signPdf } from '../../src/signing';
import { generateSelfSignedP12 } from '../../src/signing/certGen';

// 1×1 red PNG.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function bytesToLatin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)) as number[]);
  }
  return s;
}

describe('dataUrlToBytes (F-C C1)', () => {
  it('decodes a PNG data URL to bytes with the PNG signature', () => {
    const bytes = dataUrlToBytes(PNG_DATA_URL);
    expect(bytes).toBeInstanceOf(Uint8Array);
    // PNG magic: 89 50 4E 47
    expect(Array.from((bytes ?? new Uint8Array()).subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('returns undefined for null / non-data-url / non-png', () => {
    expect(dataUrlToBytes(null)).toBeUndefined();
    expect(dataUrlToBytes('not a data url')).toBeUndefined();
    expect(dataUrlToBytes('data:image/jpeg;base64,/9j/')).toBeUndefined();
  });
});

describe('buildSignOptions — appearanceImage passthrough (F-C C1)', () => {
  it('threads appearanceImage into SignOptions', () => {
    const img = new Uint8Array([1, 2, 3]);
    const opts = buildSignOptions({
      p12: new Uint8Array(), passphrase: '', page: 1,
      x: 0, y: 0, width: 10, height: 10, appearanceImage: img,
    });
    expect(opts.appearanceImage).toBe(img);
  });

  it('leaves appearanceImage undefined when none supplied', () => {
    const opts = buildSignOptions({
      p12: new Uint8Array(), passphrase: '', page: 1, x: 0, y: 0, width: 10, height: 10,
    });
    expect(opts.appearanceImage).toBeUndefined();
  });
});

describe('signPdf — image appearance is embedded (F-C C1)', () => {
  it('a signed PDF with appearanceImage carries an image XObject; text-only does not', async () => {
    const src = await PDFDocument.create();
    src.addPage([300, 200]);
    const pdfBytes = await src.save();

    const { p12 } = await generateSelfSignedP12({ commonName: 'Test Signer' }, 'pw');
    const rect = { x: 20, y: 20, width: 160, height: 60 };

    const withImg = await signPdf(pdfBytes, {
      p12: p12.slice(0), passphrase: 'pw', page: 0, rect, appearanceImage: dataUrlToBytes(PNG_DATA_URL),
    });
    const textOnly = await signPdf(pdfBytes, {
      p12: p12.slice(0), passphrase: 'pw', page: 0, rect,
    });

    expect(bytesToLatin1(withImg.bytes)).toContain('/Subtype /Image');
    expect(bytesToLatin1(textOnly.bytes)).not.toContain('/Subtype /Image');
  });
});
