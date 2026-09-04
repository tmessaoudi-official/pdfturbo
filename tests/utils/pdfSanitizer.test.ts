import { describe, it, expect } from 'vitest';
import {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFString, PDFHexString,
} from '@cantoo/pdf-lib';
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
  const page = doc.getPages()[0];

  // XMP /Metadata stream on the catalog
  const xmp = PDFRawStream.of(
    ctx.obj({ Type: 'Metadata', Subtype: 'XML' }),
    new TextEncoder().encode('<x:xmpmeta>secret author block</x:xmpmeta>'),
  );
  cat.set(PDFName.of('Metadata'), ctx.register(xmp));

  // Page-level XMP /Metadata (per-page, not just catalog)
  const pageXmp = PDFRawStream.of(
    ctx.obj({ Type: 'Metadata', Subtype: 'XML' }),
    new TextEncoder().encode('<x:xmpmeta>per-page secret</x:xmpmeta>'),
  );
  page.node.set(PDFName.of('Metadata'), ctx.register(pageXmp));

  // /OpenAction with embedded JavaScript
  cat.set(PDFName.of('OpenAction'), ctx.register(ctx.obj({ S: 'JavaScript', JS: 'app.alert("x")' })));

  // /AA additional actions on the catalog AND a page
  cat.set(PDFName.of('AA'), ctx.register(ctx.obj({ WC: { S: 'JavaScript', JS: 'void 0' } })));
  page.node.set(PDFName.of('AA'), ctx.register(ctx.obj({ O: { S: 'JavaScript', JS: 'void 0' } })));

  // Page /Annots: three annotations exercise the action rules.
  //  [0] /AA additional-actions on the annotation               -> must be stripped
  //  [1] /A action with /S /JavaScript                          -> must be stripped
  //  [2] /A action with /S /URI (a real hyperlink) — the CONTROL -> must SURVIVE
  const annotAA = ctx.obj({
    Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 10, 10],
    AA: { Fo: { S: 'JavaScript', JS: 'void 0' } },
  });
  const annotJsA = ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [10, 0, 20, 10],
    A: { S: 'JavaScript', JS: 'app.alert("annot")' },
  });
  const annotUriA = ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [20, 0, 30, 10],
    A: { S: 'URI', URI: PDFString.of('https://example.com') },
  });
  page.node.set(
    PDFName.of('Annots'),
    ctx.obj([ctx.register(annotAA), ctx.register(annotJsA), ctx.register(annotUriA)]),
  );

  // /AcroForm with /XFA and a field carrying /AA (+ /Kids recursion).
  const childField = ctx.obj({
    T: PDFString.of('child'),
    AA: { K: { S: 'JavaScript', JS: 'void 0' } },
  });
  const parentField = ctx.obj({
    T: PDFString.of('parent'),
    A: { S: 'JavaScript', JS: 'void 0' }, // JS field action on a non-terminal node
    Kids: [ctx.register(childField)],
  });
  const acroForm = ctx.obj({
    Fields: [ctx.register(parentField)],
    XFA: PDFRawStream.of(ctx.obj({}), new TextEncoder().encode('<xfa:datasets/>')),
  });
  cat.set(PDFName.of('AcroForm'), ctx.register(acroForm));

  // /AF associated files on the catalog AND the page (PDF 2.0 embedding vector)
  cat.set(PDFName.of('AF'), ctx.obj([ctx.register(ctx.obj({ Type: 'Filespec', F: PDFString.of('cat.bin') }))]));
  page.node.set(PDFName.of('AF'), ctx.obj([ctx.register(ctx.obj({ Type: 'Filespec', F: PDFString.of('page.bin') }))]));

  // /Names -> /JavaScript + /EmbeddedFiles name trees
  cat.set(PDFName.of('Names'), ctx.register(ctx.obj({
    JavaScript: { Names: [] },
    EmbeddedFiles: { Names: [] },
    Dests: { Names: [] }, // legitimate — must survive
  })));

  // Trailer /ID — a privacy/tracking identifier.
  ctx.trailerInfo.ID = ctx.obj([
    PDFHexString.of('00112233445566778899aabbccddeeff'),
    PDFHexString.of('ffeeddccbbaa99887766554433221100'),
  ]);

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
      annotActions: true,
      xfa: true,
      pageMetadata: true,
      associatedFiles: true,
      documentId: true,
    });
  });

  it('produces a PDF with the artifacts actually gone', async () => {
    const { bytes } = await sanitizePdf(await makeDirtyPdf());
    // updateMetadata:false so we observe the saved bytes, not a fresh load stamp.
    const re = await PDFDocument.load(bytes, { updateMetadata: false });
    const ctx = re.context;

    expect(re.getTitle()).toBeUndefined();
    expect(re.getAuthor()).toBeUndefined();
    expect(re.getKeywords()).toBeUndefined();
    expect(re.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(re.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
    expect(re.catalog.get(PDFName.of('AA'))).toBeUndefined();

    const pageNode = re.getPages()[0].node;
    expect(pageNode.get(PDFName.of('AA'))).toBeUndefined();
    // Page-level XMP and associated files gone.
    expect(pageNode.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(pageNode.get(PDFName.of('AF'))).toBeUndefined();
    // Catalog associated files gone.
    expect(re.catalog.get(PDFName.of('AF'))).toBeUndefined();

    // Annotation actions: /AA gone, JS /A gone, URI /A SURVIVES (the control).
    expect(pageNode.lookupMaybe(PDFName.of('Annots'), PDFArray)).toBeDefined();
    const annots = pageNode.lookup(PDFName.of('Annots'), PDFArray);
    const annotDicts = annots.asArray().map((r) => ctx.lookup(r, PDFDict));
    const annotAA = annotDicts.find((d) => d.get(PDFName.of('Subtype'))?.toString() === '/Widget');
    expect(annotAA?.get(PDFName.of('AA'))).toBeUndefined();
    // The JS-action Link lost its /A; the URI-action Link kept it.
    const links = annotDicts.filter((d) => d.get(PDFName.of('Subtype'))?.toString() === '/Link');
    const aValues = links.map((d) => {
      const a = d.get(PDFName.of('A'));
      return a ? ctx.lookup(a, PDFDict).get(PDFName.of('S'))?.toString() : undefined;
    });
    expect(aValues).toContain('/URI'); // URI hyperlink survived
    expect(aValues).not.toContain('/JavaScript'); // JS action stripped

    // AcroForm: /XFA gone, field /AA + JS /A stripped recursively (parent + kid).
    const acroForm = re.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    expect(acroForm.get(PDFName.of('XFA'))).toBeUndefined();
    const fields = acroForm.lookup(PDFName.of('Fields'), PDFArray);
    const parent = ctx.lookup(fields.get(0), PDFDict);
    expect(parent.get(PDFName.of('A'))).toBeUndefined(); // JS field action gone
    const kids = parent.lookup(PDFName.of('Kids'), PDFArray);
    const child = ctx.lookup(kids.get(0), PDFDict);
    expect(child.get(PDFName.of('AA'))).toBeUndefined(); // recursive field /AA gone

    // Trailer /ID cleared.
    expect(ctx.trailerInfo.ID).toBeUndefined();

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

/**
 * WS5 P1 — the stripped payloads were still IN the file.
 *
 * `sanitizePdf` deletes REFERENCES (`cat.delete('/Metadata')`, `node.delete('/A')`), but pdf-lib
 * serialises every indirect object it holds and has no reachability GC — so the detached XMP stream
 * and JavaScript action were written back out, in plaintext because the save is
 * `useObjectStreams: false`. README, SECURITY.md and FEATURES.md all say those are "stripped".
 *
 * These scan the RAW BYTES on purpose: `getTextContent`/`catalog.lookup` cannot see an orphan, which
 * is exactly why the defect survived the existing tests. The markers are long and distinctive so a
 * coincidental match is not a plausible mechanism (CLAUDE.md § "A flaky gate").
 */
describe('sanitizePdf — detached payloads must not survive in the bytes (WS5 P1)', () => {
  const XMP_MARKER = 'SANITIZER-XMP-PAYLOAD-MUST-NOT-SURVIVE-4417';
  const JS_MARKER = 'SANITIZER_JS_PAYLOAD_MUST_NOT_SURVIVE_4417()';

  async function pdfWithOrphanablePayloads(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;

    // Per-page XMP, as an indirect stream — the shape a real authoring tool writes.
    // UNCOMPRESSED (`ctx.stream`, not `ctx.flateStream`) so a raw byte scan can actually see it —
    // and real XMP is written uncompressed precisely so other tools can find it. With a flate
    // stream the marker is unreadable in the bytes and the assertion below passes whether the
    // payload survives or not: a scan that cannot fail, which is how this defect stayed hidden.
    const xmp = ctx.stream(`<?xpacket?><x:xmpmeta>${XMP_MARKER}</x:xmpmeta>`, {
      Type: PDFName.of('Metadata'), Subtype: PDFName.of('XML'),
    });
    page.node.set(PDFName.of('Metadata'), ctx.register(xmp));

    // An annotation carrying a JavaScript action.
    const action = ctx.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of(JS_MARKER) });
    const annot = ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'),
      Rect: ctx.obj([0, 0, 10, 10]), A: ctx.register(action),
    });
    page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
    return doc.save({ useObjectStreams: false });
  }

  const asText = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

  it('the fixture really carries both payloads — the negative control', async () => {
    // Without this the assertions below would pass on a document that never had them.
    const raw = asText(await pdfWithOrphanablePayloads());
    expect(raw).toContain(JS_MARKER);
    expect(raw).toContain(XMP_MARKER);
  });

  it('removes the detached XMP stream from the bytes, not just from the catalog', async () => {
    const out = await sanitizePdf(await pdfWithOrphanablePayloads());
    expect(asText(out.bytes)).not.toContain(XMP_MARKER);
  });

  it('removes the detached JavaScript action from the bytes', async () => {
    const out = await sanitizePdf(await pdfWithOrphanablePayloads());
    expect(asText(out.bytes)).not.toContain(JS_MARKER);
  });

  it('leaves the page and its non-JS content intact', async () => {
    // The over-reach control: a GC that deleted too much would satisfy the two cases above by
    // destroying the document.
    const out = await sanitizePdf(await pdfWithOrphanablePayloads());
    const reloaded = await PDFDocument.load(out.bytes, { updateMetadata: false });
    expect(reloaded.getPageCount()).toBe(1);
    expect(reloaded.getPage(0).getSize().width).toBe(200);
  });
});
