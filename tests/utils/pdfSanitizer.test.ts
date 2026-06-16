import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from '@cantoo/pdf-lib';
import { sanitizePdf } from '../../src/utils/pdfSanitizer';

/** Build a PDF carrying every artifact the sanitizer is meant to strip. */
async function makeDirtyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.setTitle('Secret Title');
  doc.setAuthor('Jane Doe');
  doc.setKeywords(['confidential', 'internal']);

  const ctx = doc.context;
  const cat = doc.catalog;

  // XMP /Metadata stream on the catalog
  const xmp = PDFRawStream.of(
    ctx.obj({ Type: 'Metadata', Subtype: 'XML' }),
    new TextEncoder().encode('<x:xmpmeta>secret author block</x:xmpmeta>'),
  );
  cat.set(PDFName.of('Metadata'), ctx.register(xmp));

  // /OpenAction with embedded JavaScript
  cat.set(PDFName.of('OpenAction'), ctx.register(ctx.obj({ S: 'JavaScript', JS: 'app.alert("x")' })));

  // /AA additional actions on the catalog AND a page
  cat.set(PDFName.of('AA'), ctx.register(ctx.obj({ WC: { S: 'JavaScript', JS: 'void 0' } })));
  doc.getPages()[0].node.set(PDFName.of('AA'), ctx.register(ctx.obj({ O: { S: 'JavaScript', JS: 'void 0' } })));

  // /Names -> /JavaScript + /EmbeddedFiles name trees
  cat.set(PDFName.of('Names'), ctx.register(ctx.obj({
    JavaScript: { Names: [] },
    EmbeddedFiles: { Names: [] },
    Dests: { Names: [] }, // legitimate — must survive
  })));

  return doc.save({ useObjectStreams: false });
}

describe('sanitizePdf', () => {
  it('reports every artifact it removed', async () => {
    const { report } = await sanitizePdf(await makeDirtyPdf());
    expect(report).toEqual({
      info: true,
      metadata: true,
      openAction: true,
      additionalActions: true,
      javascript: true,
      embeddedFiles: true,
    });
  });

  it('produces a PDF with the artifacts actually gone', async () => {
    const { bytes } = await sanitizePdf(await makeDirtyPdf());
    // updateMetadata:false so we observe the saved bytes, not a fresh load stamp.
    const re = await PDFDocument.load(bytes, { updateMetadata: false });

    expect(re.getTitle()).toBeUndefined();
    expect(re.getAuthor()).toBeUndefined();
    expect(re.getKeywords()).toBeUndefined();
    expect(re.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(re.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
    expect(re.catalog.get(PDFName.of('AA'))).toBeUndefined();
    expect(re.getPages()[0].node.get(PDFName.of('AA'))).toBeUndefined();

    const names = re.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    expect(names?.get(PDFName.of('JavaScript'))).toBeUndefined();
    expect(names?.get(PDFName.of('EmbeddedFiles'))).toBeUndefined();
    // legitimate sub-tree preserved
    expect(names?.get(PDFName.of('Dests'))).toBeDefined();
  });

  it('leaves a clean PDF loadable and reports no JS/embedded artifacts', async () => {
    const d = await PDFDocument.create();
    d.addPage([100, 100]);
    const clean = await d.save({ useObjectStreams: false });

    const { bytes, report } = await sanitizePdf(clean);
    expect(report.metadata).toBe(false);
    expect(report.openAction).toBe(false);
    expect(report.additionalActions).toBe(false);
    expect(report.javascript).toBe(false);
    expect(report.embeddedFiles).toBe(false);
    // pdf-lib stamps its own /Info Producer at create() — sanitize strips it.
    expect(report.info).toBe(true);

    const re = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(re.getPageCount()).toBe(1);
    expect(re.getProducer()).toBeUndefined();
  });
});
