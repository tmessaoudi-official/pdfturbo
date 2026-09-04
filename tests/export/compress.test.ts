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
  stripDocMetadata,
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

/**
 * WS7 round 2 — `compressLossless` kept the defect the sanitizer had just fixed.
 *
 * It deletes the catalog `/Metadata` REFERENCE, and pdf-lib performs no reachability collection, so
 * the detached XMP packet was re-serialised. Its own docstring says it "mirrors the metadata subset
 * of the sanitizer" — which is precisely why a sibling that shares a promise but not the filter is
 * this repo's most-repeated defect. Both paths now call one shared sweep.
 */
describe('compressLossless — the stripped metadata must leave the FILE (WS7)', () => {
  const MARKER = 'COMPRESS-XMP-PAYLOAD-MUST-NOT-SURVIVE-4417';

  async function pdfWithCatalogXmp(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    // UNCOMPRESSED, so a raw byte scan can see it — a flate stream would hide the marker and the
    // assertion would pass whether the payload survived or not.
    const xmp = doc.context.stream(`<?xpacket?><x:xmpmeta>${MARKER}</x:xmpmeta>`, {
      Type: PDFName.of('Metadata'), Subtype: PDFName.of('XML'),
    });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
    return doc.save({ useObjectStreams: false });
  }

  const asText = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

  it('the fixture really carries the payload — the negative control', async () => {
    expect(asText(await pdfWithCatalogXmp())).toContain(MARKER);
  });

  it('does not re-serialise the detached XMP packet', async () => {
    expect(asText(await compressLossless(await pdfWithCatalogXmp()))).not.toContain(MARKER);
  });

  it('strips through stripDocMetadata itself, which is what the PRODUCTION path calls', async () => {
    // The panel found the previous guard exercised `compressLossless`, which `git grep` shows has
    // only TEST callers: the Compress button routes to a private `_compressLossless` in
    // exportService that never called the sweep. Driving `stripDocMetadata` directly is what pins
    // BOTH paths, because both call it — the placement is the fix.
    const doc = await PDFDocument.load(await pdfWithCatalogXmp(), { updateMetadata: false });
    await stripDocMetadata(doc);
    expect(asText(await doc.save({ useObjectStreams: false }))).not.toContain(MARKER);
  });

  it('still produces a loadable one-page document — the over-reach control', async () => {
    const out = await compressLossless(await pdfWithCatalogXmp());
    const reloaded = await PDFDocument.load(out, { updateMetadata: false });
    expect(reloaded.getPageCount()).toBe(1);
  });
});
