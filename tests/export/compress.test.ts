/**
 * PDF compress — pure / pdf-lib helpers (#60). The lossless path is jsdom-testable
 * (pure pdf-lib): it re-serializes with object streams and strips /Info + XMP
 * metadata. The lossy per-page raster path is DOM-dependent (canvas) and is
 * covered by the real-Chrome harness (compress.browser.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import {
  dpiToScale,
  clampDpi,
  clampQuality,
  compressLossless,
  COMPRESS_DPI_DEFAULT,
  COMPRESS_DPI_MIN,
  COMPRESS_DPI_MAX,
  COMPRESS_QUALITY_MIN,
  COMPRESS_QUALITY_MAX,
} from '../../src/export/compress';

/** A PDF carrying /Info metadata (Title/Author/Producer) on a few pages. */
async function makeMetadataPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([595, 842]).drawText(`Page ${i + 1} — selectable text`, { x: 40, y: 800, size: 14 });
  doc.setTitle('Confidential');
  doc.setAuthor('Jane Doe');
  doc.setProducer('SomeTool 1.0');
  return doc.save({ useObjectStreams: false });
}

describe('compress — dpi/quality clamps (#60)', () => {
  it('dpiToScale converts DPI to a pdf.js scale (dpi / 72), clamped to range', () => {
    expect(dpiToScale(72)).toBeCloseTo(1, 5);
    expect(dpiToScale(144)).toBeCloseTo(2, 5);
    expect(dpiToScale(COMPRESS_DPI_DEFAULT)).toBeCloseTo(COMPRESS_DPI_DEFAULT / 72, 5);
  });

  it('clampDpi floors/ceils to [MIN, MAX] and survives NaN', () => {
    expect(clampDpi(10)).toBe(COMPRESS_DPI_MIN);
    expect(clampDpi(9999)).toBe(COMPRESS_DPI_MAX);
    expect(clampDpi(NaN)).toBe(COMPRESS_DPI_DEFAULT);
    expect(clampDpi(150)).toBe(150);
  });

  it('clampQuality floors/ceils to [MIN, MAX] and survives NaN', () => {
    expect(clampQuality(0)).toBe(COMPRESS_QUALITY_MIN);
    expect(clampQuality(1)).toBe(COMPRESS_QUALITY_MAX);
    expect(clampQuality(NaN)).toBeCloseTo(0.8, 5);
    expect(clampQuality(0.7)).toBeCloseTo(0.7, 5);
  });
});

describe('compressLossless (#60)', () => {
  it('returns a valid, loadable PDF preserving every page', async () => {
    const src = await makeMetadataPdf();
    const out = await compressLossless(src);
    expect(String.fromCharCode(out[0], out[1], out[2], out[3])).toBe('%PDF');
    const re = await PDFDocument.load(out, { updateMetadata: false });
    expect(re.getPageCount()).toBe(3);
  });

  it('strips /Info metadata (incl. pdf-lib Producer) without re-stamping at load', async () => {
    const src = await makeMetadataPdf();
    const out = await compressLossless(src);
    // updateMetadata:false is essential — load(true) re-injects Producer+ModDate.
    const re = await PDFDocument.load(out, { updateMetadata: false });
    expect(re.getTitle()).toBeUndefined();
    expect(re.getAuthor()).toBeUndefined();
    expect(re.getProducer()).toBeUndefined();
  });

  it('drops the catalog XMP /Metadata stream', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    // Attach a dummy XMP metadata stream on the catalog.
    const xmp = doc.context.flateStream('<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>');
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
    const src = await doc.save({ useObjectStreams: false });

    const out = await compressLossless(src);
    const re = await PDFDocument.load(out, { updateMetadata: false });
    expect(re.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
  });
});
