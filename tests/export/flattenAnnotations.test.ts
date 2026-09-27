/**
 * Limits row 23 (D12) — which source annotations `flattenPageAnnotations` draws, keeps or counts, and the §12.5.5
 * transform it draws them with. The pixels are pinned in tests/browser/flatten-annotations.browser.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { appearanceTransform, flattenPageAnnotations, flattenDocumentAnnotations } from '../../src/export/flattenAnnotations';

describe('appearanceTransform — pdf.js getTransformMatrix', () => {
  it('maps a BBox onto the rect, scaling each axis', () => {
    expect(appearanceTransform([10, 20, 110, 70], [0, 0, 50, 25], [1, 0, 0, 1, 0, 0])).toEqual([2, 0, 0, 2, 10, 20]);
  });
  it('an offset BBox is translated out', () => {
    expect(appearanceTransform([0, 0, 10, 10], [5, 5, 15, 15], [1, 0, 0, 1, 0, 0])).toEqual([1, 0, 0, 1, -5, -5]);
  });
  it('the BBox is taken under the /Matrix — a 90° turn swaps its extents', () => {
    // BBox 40×20 turned: x ∈ [-20, 0], y ∈ [0, 40]; onto a 40×80 rect → ×2 both ways.
    expect(appearanceTransform([150, 100, 190, 180], [0, 0, 40, 20], [0, 1, -1, 0, 0, 0])).toEqual([2, 0, 0, 2, 190, 100]);
  });
  it('a degenerate BBox only translates to the rect corner', () => {
    expect(appearanceTransform([7, 9, 50, 50], [0, 0, 0, 10], [1, 0, 0, 1, 0, 0])).toEqual([1, 0, 0, 1, 7, 9]);
  });
});

async function page(annots: (ctx: PDFDocument['context']) => unknown[]) {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([300, 300]);
  const list = annots(doc.context);
  pg.node.set(PDFName.of('Annots'), doc.context.obj(list as never));
  return { doc, pg };
}
const form = (ctx: PDFDocument['context'], extra: Record<string, unknown> = { Subtype: 'Form', BBox: [0, 0, 10, 10] }) =>
  ctx.register(ctx.stream('0 g 0 0 10 10 re f', extra as never));
const annot = (ctx: PDFDocument['context'], subtype: string, extra: Record<string, unknown> = {}) =>
  ctx.register(ctx.obj({ Type: 'Annot', Subtype: subtype, Rect: [10, 10, 30, 30], ...extra } as never));
const subtypes = (pg: Awaited<ReturnType<typeof page>>['pg']) => {
  const a = pg.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!a) return [];
  return a.asArray().map((_, i) => (a.lookup(i, PDFDict).lookup(PDFName.of('Subtype')) as PDFName).decodeText());
};
/** The page's content streams, inflated and joined (pdf-lib compresses what it appends). */
const content = async (doc: PDFDocument) => {
  const reloaded = await PDFDocument.load(await doc.save());
  const c = reloaded.getPage(0).node.Contents();
  const streams = c instanceof PDFArray ? c.asArray().map(r => reloaded.context.lookup(r)) : [c];
  return streams.map(st => new TextDecoder('latin1').decode(decodePDFRawStream(st as PDFRawStream).decode())).join('\n');
};

describe('flattenPageAnnotations — what is drawn, kept and counted', () => {
  it('keeps links, pending redactions, widgets and payload-bearing types without counting them', async () => {
    const { doc, pg } = await page(ctx => ['Link', 'Redact', 'Widget', 'FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D']
      .map(s => annot(ctx, s, { AP: { N: form(ctx) } })));
    expect(await flattenPageAnnotations(doc, pg)).toEqual({ flattened: 0, skipped: 0 });
    expect(subtypes(pg)).toEqual(['Link', 'Redact', 'Widget', 'FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D']);
  });

  it('keeps annotations pdf.js does not show — Invisible, Hidden, NoView — without counting them', async () => {
    const { doc, pg } = await page(ctx => [1, 2, 0x20].map(F => annot(ctx, 'Square', { F, AP: { N: form(ctx) } })));
    expect(await flattenPageAnnotations(doc, pg)).toEqual({ flattened: 0, skipped: 0 });
    expect(subtypes(pg)).toHaveLength(3);
  });

  it('counts and keeps one with no appearance, and one whose /AS names no state', async () => {
    const { doc, pg } = await page(ctx => [
      annot(ctx, 'Square'),
      annot(ctx, 'Stamp', { AP: { N: { On: form(ctx) } }, AS: 'Off' }),
      annot(ctx, 'Stamp', { AP: { N: { On: form(ctx) } } }),
    ]);
    expect(await flattenPageAnnotations(doc, pg)).toEqual({ flattened: 0, skipped: 3 });
    expect(subtypes(pg)).toEqual(['Square', 'Stamp', 'Stamp']);
  });

  it('draws the /AS state, removes the annotation and drops /Annots once empty', async () => {
    let onRef: unknown;
    const { doc, pg } = await page(ctx => {
      onRef = form(ctx);
      return [annot(ctx, 'Stamp', { AP: { N: { Off: form(ctx), On: onRef } }, AS: 'On' })];
    });
    expect(await flattenPageAnnotations(doc, pg)).toEqual({ flattened: 1, skipped: 0 });
    expect(pg.node.has(PDFName.of('Annots'))).toBe(false);
    const xobjs = pg.node.normalizedEntries().Resources.lookup(PDFName.of('XObject'), PDFDict);
    expect(xobjs.values()).toContain(onRef);
  });

  it("removes a flattened note's popup and keeps a popup whose parent stays", async () => {
    const { doc, pg } = await page(ctx => {
      const note = annot(ctx, 'Text', { AP: { N: form(ctx) } });
      const kept = annot(ctx, 'Text', { Contents: PDFString.of('no appearance') });
      return [note, annot(ctx, 'Popup', { Parent: note }), kept, annot(ctx, 'Popup', { Parent: kept })];
    });
    expect(await flattenPageAnnotations(doc, pg)).toEqual({ flattened: 1, skipped: 1 });
    expect(subtypes(pg)).toEqual(['Text', 'Popup']);
  });

  it('removes a popup listed on ANOTHER page than its flattened parent', async () => {
    const doc = await PDFDocument.create();
    const [p1, p2] = [doc.addPage([300, 300]), doc.addPage([300, 300])];
    const ctx = doc.context;
    const note = annot(ctx, 'Text', { AP: { N: form(ctx) } });
    p1.node.set(PDFName.of('Annots'), ctx.obj([note] as never));
    p2.node.set(PDFName.of('Annots'), ctx.obj([annot(ctx, 'Popup', { Parent: note }), annot(ctx, 'Link')] as never));
    expect(await flattenDocumentAnnotations(doc)).toEqual({ flattened: 1, skipped: 0 });
    expect(subtypes(p1)).toEqual([]);
    expect(subtypes(p2)).toEqual(['Link']);
  });

  it('normalises a reversed /Rect, and completes a stream with no /Subtype or /BBox', async () => {
    let n: unknown;
    const { doc, pg } = await page(ctx => {
      n = form(ctx, {});
      return [ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [30, 30, 10, 10], AP: { N: n } } as never))];
    });
    expect(await flattenPageAnnotations(doc, pg)).toEqual({ flattened: 1, skipped: 0 });
    const sd = (doc.context.lookup(n as never) as PDFRawStream).dict;
    expect((sd.lookup(PDFName.of('Subtype')) as PDFName).decodeText()).toBe('Form');
    expect(sd.lookup(PDFName.of('BBox'), PDFArray).asArray().map(String)).toEqual(['0', '0', '20', '20']);
    // Clipped to the NORMALISED rect, then mapped onto it.
    expect(await content(doc)).toMatch(/q\s+10 10 20 20 re\s+W\s+n\s+1 0 0 1 10 10 cm\s+\/PdfturboAnnot-?\d+ Do\s+Q/);
  });

  it('a malformed key never fails the export — each shape read the way pdf.js reads it', async () => {
    // Each of these THREW before (pdf-lib `lookupMaybe` on a type mismatch), failing the whole Flatten.
    const run = async (extra: Record<string, unknown>, annotsAsDict = false) => {
      const doc = await PDFDocument.create();
      const pg = doc.addPage([300, 300]);
      const ctx = doc.context;
      const a = annot(ctx, 'Square', { AP: { N: form(ctx) }, ...extra });
      pg.node.set(PDFName.of('Annots'), annotsAsDict ? ctx.obj({ A: a } as never) : ctx.obj([a] as never));
      return flattenPageAnnotations(doc, pg);
    };
    expect(await run({ F: PDFString.of('2') })).toEqual({ flattened: 1, skipped: 0 });      // not an integer → 0 → viewed
    expect(await run({ F: 2.5 })).toEqual({ flattened: 1, skipped: 0 });
    expect(await run({ AP: [] })).toEqual({ flattened: 0, skipped: 1 });                    // no appearance
    expect(await run({ Subtype: PDFString.of('Square') })).toEqual({ flattened: 1, skipped: 0 }); // a generic annotation
    expect(await run({ AP: { N: { On: 1 } }, AS: PDFString.of('On') })).toEqual({ flattened: 0, skipped: 1 });
    expect(await run({}, true)).toEqual({ flattened: 0, skipped: 0 });                      // /Annots not an array
  });

  it('an invalid /BBox or /Matrix falls back to pdf.js\'s default, and a non-Form /Subtype is drawn as a form', async () => {
    let n: unknown;
    const { doc, pg } = await page(ctx => {
      n = ctx.register(ctx.stream('0 g 0 0 5 5 re f', { Subtype: 'Image', BBox: { a: 1 }, Matrix: [1, 0] } as never));
      return [annot(ctx, 'Square', { AP: { N: n } })];
    });
    expect(await flattenPageAnnotations(doc, pg)).toEqual({ flattened: 1, skipped: 0 });
    const sd = (doc.context.lookup(n as never) as PDFRawStream).dict;
    expect((sd.lookup(PDFName.of('Subtype')) as PDFName).decodeText()).toBe('Form');
    expect(sd.lookup(PDFName.of('BBox'), PDFArray).asArray().map(String)).toEqual(['0', '0', '20', '20']);
    expect(sd.has(PDFName.of('Matrix'))).toBe(false);
  });

  it('counts a zero-size rect instead of drawing it', async () => {
    const { doc, pg } = await page(ctx => [
      ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 10, 30], AP: { N: form(ctx) } } as never)),
    ]);
    expect(await flattenPageAnnotations(doc, pg)).toEqual({ flattened: 0, skipped: 1 });
  });

  it('wraps an /OC annotation in its layer through the page /Properties', async () => {
    let ocg: unknown;
    const { doc, pg } = await page(ctx => {
      ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('L') } as never));
      return [annot(ctx, 'Square', { AP: { N: form(ctx) }, OC: ocg })];
    });
    await flattenPageAnnotations(doc, pg);
    const props = pg.node.normalizedEntries().Resources.lookup(PDFName.of('Properties'), PDFDict);
    expect(props.get(PDFName.of('PdfturboOC1'))).toBe(ocg);
    expect(await content(doc)).toMatch(/\/OC \/PdfturboOC1 BDC\s+q[\s\S]*?Do\s+Q\s+EMC/);
  });
});
