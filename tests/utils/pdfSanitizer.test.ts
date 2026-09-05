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
      // The dirty fixture carries no egress action and no paperclip: both false, and asserted so
      // the ruling's two flags cannot silently become true on a document that has neither.
      externalActions: false,
      fileAttachments: false,
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

/**
 * WS7 round 6 — `/S` was compared RAW while its sibling `/A` was resolved.
 *
 * `stripNodeActions` did `ctx.lookup(node.get(NAME_A))` and then `action.get(NAME_S) === NAME_JS`.
 * A PDF may write any value as an indirect reference, so `/S 12 0 R` → `/JavaScript` yields a
 * `PDFRef` from `get`, which never equals `PDFName.of('JavaScript')` — the action survived AND
 * `report.annotActions` stayed false, so the UI reported a clean sanitize. Resolved on one key and
 * raw on its sibling is the same asymmetry this repo has now hit in four separate places.
 *
 * The URI case is the over-reach control: the fix makes `/S` resolve, and a hyperlink written the
 * same way must still survive, or "URI/GoTo hyperlinks must survive" (the function's own docstring)
 * quietly becomes false in the other direction.
 */
describe('sanitizePdf — an action whose /S is an INDIRECT reference (WS7)', () => {
  const JS_MARKER = 'SANITIZER_INDIRECT_S_MUST_NOT_SURVIVE_8831()';
  const URI_MARKER = 'https://example.invalid/indirect-s-must-survive-8831';

  /** `kind` is registered as its OWN indirect object, so `/S` reads back as a PDFRef. */
  async function pdfWithIndirectS(kind: 'JavaScript' | 'URI'): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const action = ctx.obj(kind === 'JavaScript'
      ? { S: ctx.register(PDFName.of('JavaScript')), JS: PDFString.of(JS_MARKER) }
      : { S: ctx.register(PDFName.of('URI')), URI: PDFString.of(URI_MARKER) });
    const annot = ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'),
      Rect: ctx.obj([0, 0, 10, 10]), A: ctx.register(action),
    });
    page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
    return doc.save({ useObjectStreams: false });
  }

  const asText = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

  it('the fixture really carries the payload — the negative control', async () => {
    expect(asText(await pdfWithIndirectS('JavaScript'))).toContain(JS_MARKER);
  });

  it('strips the JavaScript action even when /S is an indirect reference', async () => {
    const out = await sanitizePdf(await pdfWithIndirectS('JavaScript'));
    expect(asText(out.bytes)).not.toContain(JS_MARKER);
  });

  it('REPORTS the strip — a clean-looking report over a surviving script is the worse half', async () => {
    const out = await sanitizePdf(await pdfWithIndirectS('JavaScript'));
    expect(out.report.annotActions).toBe(true);
  });

  it('keeps a URI hyperlink whose /S is equally indirect — the over-reach control', async () => {
    const out = await sanitizePdf(await pdfWithIndirectS('URI'));
    expect(asText(out.bytes)).toContain(URI_MARKER);
  });
});

/**
 * WS7 round 7 — round 6 closed ONE shape of "a script survives sanitize"; the CLASS was open.
 *
 * `stripNodeActions` looked at the top-level action dict only, and the node set covered annotations
 * and form fields. So three shapes survived, each with the report saying `false` — i.e. the UI
 * calling the sanitize clean:
 *   - a JavaScript action reached through `/Next` (an action CHAIN);
 *   - a `/Next` that is an ARRAY of actions;
 *   - `/Outlines` — bookmarks were never walked at all.
 * A real engine runs all three: `pdf.worker.mjs` `_collectJS` recurses `getRaw("Next")` and array
 * elements, and collects outline actions.
 *
 * The chain is SPLICED, not truncated: removing a JS link reattaches its `/Next`, so a `/URI` that
 * followed the script still works. Deleting the whole chain would be the over-reach direction, and
 * `SECURITY.md` promises `/URI` and `/GoTo` links are never touched. Beware the two meanings of `/Next` — on an OUTLINE ITEM
 * it is the next sibling bookmark, on an ACTION it is the next action; they are walked separately.
 */
describe('sanitizePdf — JavaScript anywhere in an action chain, and /Outlines (WS7 r7)', () => {
  const CHAIN = 'SANITIZE_CHAIN_JS_MUST_NOT_SURVIVE_9042()';
  const ARRAY = 'SANITIZE_ARRAY_JS_MUST_NOT_SURVIVE_9042()';
  const OUTLINE = 'SANITIZE_OUTLINE_JS_MUST_NOT_SURVIVE_9042()';
  const URI_A = 'https://example.invalid/first-must-survive-9042';
  const URI_B = 'https://example.invalid/after-the-script-must-survive-9042';
  const URI_O = 'https://example.invalid/outline-link-must-survive-9042';
  const asText = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

  async function build(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const uri = (u: string) => ({ S: PDFName.of('URI'), URI: PDFString.of(u) });
    const js = (m: string) => ({ S: PDFName.of('JavaScript'), JS: PDFString.of(m) });

    // 1. /A -> URI, /Next -> JS, whose own /Next is a second URI. Splice must keep BOTH URIs.
    const tail = ctx.register(ctx.obj(uri(URI_B)));
    const mid = ctx.obj(js(CHAIN)); mid.set(PDFName.of('Next'), tail);
    const head = ctx.obj(uri(URI_A)); head.set(PDFName.of('Next'), ctx.register(mid));
    const a1 = ctx.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: ctx.obj([0, 0, 9, 9]) });
    a1.set(PDFName.of('A'), ctx.register(head));

    // 2. /Next as an ARRAY carrying a JS entry.
    const head2 = ctx.obj(uri(URI_A));
    head2.set(PDFName.of('Next'), ctx.obj([ctx.register(ctx.obj(js(ARRAY)))]));
    const a2 = ctx.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: ctx.obj([0, 0, 9, 9]) });
    a2.set(PDFName.of('A'), ctx.register(head2));
    page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(a1), ctx.register(a2)]));

    // 3. Outline: a JS bookmark whose SIBLING (/Next on the item) is a legitimate link.
    const sibling = ctx.obj({ Title: PDFString.of('link') });
    sibling.set(PDFName.of('A'), ctx.register(ctx.obj(uri(URI_O))));
    const first = ctx.obj({ Title: PDFString.of('script') });
    first.set(PDFName.of('A'), ctx.register(ctx.obj(js(OUTLINE))));
    first.set(PDFName.of('Next'), ctx.register(sibling));
    const outlines = ctx.obj({ Type: PDFName.of('Outlines') });
    outlines.set(PDFName.of('First'), ctx.register(first));
    doc.catalog.set(PDFName.of('Outlines'), ctx.register(outlines));
    return doc.save({ useObjectStreams: false });
  }

  it('the fixture carries all three payloads — the negative control', async () => {
    const raw = asText(await build());
    for (const m of [CHAIN, ARRAY, OUTLINE]) expect(raw).toContain(m);
  });

  it('strips a JavaScript action reached through /Next', async () => {
    expect(asText((await sanitizePdf(await build())).bytes)).not.toContain(CHAIN);
  });

  it('strips a JavaScript action inside an ARRAY-valued /Next', async () => {
    expect(asText((await sanitizePdf(await build())).bytes)).not.toContain(ARRAY);
  });

  it('strips a JavaScript action on an /Outlines bookmark', async () => {
    expect(asText((await sanitizePdf(await build())).bytes)).not.toContain(OUTLINE);
  });

  it('SPLICES rather than truncates — a URI after the script survives', async () => {
    const out = asText((await sanitizePdf(await build())).bytes);
    expect(out).toContain(URI_A);
    expect(out).toContain(URI_B);
  });

  it('leaves an unrelated outline bookmark link alone — the over-reach control', async () => {
    expect(asText((await sanitizePdf(await build())).bytes)).toContain(URI_O);
  });

  it('REPORTS the strip rather than claiming a clean document', async () => {
    expect((await sanitizePdf(await build())).report.annotActions).toBe(true);
  });
});

/**
 * WS7 round 8 — round 7 spliced the MIDDLE of an action chain and truncated everywhere else, so the
 * class it was written to close was still open in three places, and one of them hung the browser.
 *
 * All three lenses of the round-8 panel found the head-of-`/A` case independently, which is the
 * clearest signal yet that "fix one member of the class, leave the siblings" is not a slip here but
 * a habit. The cases below pin the whole class at once:
 *
 *  - a CYCLIC `/Next` looped forever. `seen` guarded only the dict a call was ENTERED on; the splice
 *    branch re-pointed `/Next` at the same JavaScript dict every iteration and never recorded it.
 *    Measured on the shipped code: `timeout 60` → killed, against 11 ms for the acyclic control.
 *    A synchronous `for(;;)` on the main thread, reachable from the 🧹 button — so it is not a slow
 *    sanitize, it is a frozen tab, and `sanitizeAndDownload`'s catch can never fire because nothing
 *    throws.
 *  - a script at the HEAD of `/A` was deleted whole, taking a `/URI` chained behind it.
 *  - an ARRAY-valued `/Next` dropped its script entries instead of splicing their continuations in.
 *
 * The fix is one function rather than three patches: `spliceActions` returns the actions that
 * SURVIVE in place of a value, so head, middle, array element and cycle are the same operation
 * applied at different positions. A defect class stays closed only when the code cannot express the
 * distinction that let it reopen.
 */
describe('sanitizePdf — the whole splice class, at every position (WS7 r8)', () => {
  const HEAD_JS = 'SANITIZE_HEAD_JS_MUST_NOT_SURVIVE_8801()';
  const ARR_JS = 'SANITIZE_ARRAY_TAIL_JS_MUST_NOT_SURVIVE_8801()';
  const CYCLE_JS = 'SANITIZE_CYCLIC_JS_MUST_NOT_SURVIVE_8801()';
  const AFTER_HEAD = 'https://example.invalid/chained-behind-the-head-script-8801';
  const AFTER_ARR = 'https://example.invalid/chained-behind-an-array-script-8801';
  const asText = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

  const uri = (u: string) => ({ S: PDFName.of('URI'), URI: PDFString.of(u) });
  const js = (m: string) => ({ S: PDFName.of('JavaScript'), JS: PDFString.of(m) });

  /** One Link annotation carrying `action` as its `/A`. */
  async function withAction(build: (ctx: PDFDocument['context']) => PDFDict): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const annot = ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: ctx.obj([0, 0, 9, 9]),
    });
    annot.set(PDFName.of('A'), ctx.register(build(ctx)));
    page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
    return doc.save({ useObjectStreams: false });
  }

  /** `/A` IS the script, and a legitimate hyperlink is chained behind it. */
  const headScript = () => withAction(ctx => {
    const head = ctx.obj(js(HEAD_JS));
    head.set(PDFName.of('Next'), ctx.register(ctx.obj(uri(AFTER_HEAD))));
    return head;
  });

  /** An array-valued `/Next` whose single entry is a script with a hyperlink behind IT. */
  const arrayScript = () => withAction(ctx => {
    const tail = ctx.register(ctx.obj(uri(AFTER_ARR)));
    const inner = ctx.obj(js(ARR_JS)); inner.set(PDFName.of('Next'), tail);
    const head = ctx.obj(uri('https://example.invalid/array-head-8801'));
    head.set(PDFName.of('Next'), ctx.obj([ctx.register(inner)]));
    return head;
  });

  /** A script whose `/Next` points back at itself — the shape that hung the shipped code. */
  const selfCycle = () => withAction(ctx => {
    const script = ctx.obj(js(CYCLE_JS));
    const ref = ctx.register(script);
    script.set(PDFName.of('Next'), ref);
    const head = ctx.obj(uri('https://example.invalid/cycle-head-8801'));
    head.set(PDFName.of('Next'), ref);
    return head;
  });

  /** Two scripts pointing at each other — a cycle no single-step guard would catch. */
  const twoCycle = () => withAction(ctx => {
    const a = ctx.obj(js(CYCLE_JS));
    const b = ctx.obj(js(`B_${CYCLE_JS}`));
    const aRef = ctx.register(a); const bRef = ctx.register(b);
    a.set(PDFName.of('Next'), bRef);
    b.set(PDFName.of('Next'), aRef);
    const head = ctx.obj(uri('https://example.invalid/two-cycle-head-8801'));
    head.set(PDFName.of('Next'), aRef);
    return head;
  });

  it('the fixtures really carry their payloads — the negative controls', async () => {
    expect(asText(await headScript())).toContain(HEAD_JS);
    expect(asText(await arrayScript())).toContain(ARR_JS);
    expect(asText(await selfCycle())).toContain(CYCLE_JS);
  });

  it('TERMINATES on a self-cyclic /Next — the shipped code looped forever', async () => {
    const out = await sanitizePdf(await selfCycle());
    expect(asText(out.bytes)).not.toContain(CYCLE_JS);
  });

  it('TERMINATES on a two-action cycle', async () => {
    const out = await sanitizePdf(await twoCycle());
    expect(asText(out.bytes)).not.toContain(CYCLE_JS);
  });

  it('strips a script at the HEAD of /A', async () => {
    expect(asText((await sanitizePdf(await headScript())).bytes)).not.toContain(HEAD_JS);
  });

  it('SPLICES the head — a hyperlink chained behind the script survives', async () => {
    // The whole point of splicing, and the case the shipped code got wrong in the one position its
    // own commit message advertised. Deleting `/A` satisfies the strip assertion above while
    // destroying the link, so this is the half that has to be asserted.
    expect(asText((await sanitizePdf(await headScript())).bytes)).toContain(AFTER_HEAD);
  });

  it('leaves the annotation with a usable /A rather than none at all', async () => {
    const doc = await PDFDocument.load((await sanitizePdf(await headScript())).bytes, {
      updateMetadata: false,
    });
    const annots = doc.getPages()[0].node.lookup(PDFName.of('Annots'), PDFArray);
    const action = annots.lookup(0, PDFDict).lookup(PDFName.of('A'), PDFDict);
    expect(action.lookup(PDFName.of('S'))).toBe(PDFName.of('URI'));
  });

  it('SPLICES inside an ARRAY-valued /Next, keeping the continuation behind the script', async () => {
    const out = asText((await sanitizePdf(await arrayScript())).bytes);
    expect(out).not.toContain(ARR_JS);
    expect(out).toContain(AFTER_ARR);
  });

  it('REPORTS every one of them — a clean report over a surviving script is the worse half', async () => {
    for (const fixture of [headScript, arrayScript, selfCycle, twoCycle]) {
      expect((await sanitizePdf(await fixture())).report.annotActions).toBe(true);
    }
  });
});

/**
 * WS7 round 8 — two more shapes, both of which make a SHIPPED claim false rather than merely
 * incomplete.
 *
 * `/S /Rendition` with a `/JS` entry executes that script at `/OP 4`. It is JavaScript by any
 * reading, it survived untouched, and `report.javascript` came back `false` — while `README.md`,
 * `SECURITY.md` and the sanitize tooltip in all three locales promise JavaScript is removed, with
 * `SECURITY.md` marking the row `[pinned]` to say a test vouches for it. No test did.
 *
 * The `/Outlines` walk added in round 7 recursed on the sibling `/Next`, i.e. over a LINEAR list, so
 * a book-sized bookmark tree overflowed the stack: measured 8000 siblings fine, 10000 → RangeError.
 * It failed closed (`toast.sanitizeFailed`), which is the right direction but the wrong outcome —
 * a document that sanitized before round 7 stopped being sanitizable after it. Sibling traversal is
 * a loop; only the `/First` descent needs a stack.
 */
describe('sanitizePdf — script-bearing Renditions and book-sized outlines (WS7 r8)', () => {
  const REND_JS = 'SANITIZE_RENDITION_JS_MUST_NOT_SURVIVE_8802()';
  const MEDIA = 'SANITIZE_RENDITION_MEDIA_MUST_SURVIVE_8802';
  const asText = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

  async function withRendition(withJs: boolean): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const action = ctx.obj({ S: PDFName.of('Rendition'), OP: 4, N: PDFString.of(MEDIA) });
    if (withJs) action.set(PDFName.of('JS'), PDFString.of(REND_JS));
    const annot = ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Screen'), Rect: ctx.obj([0, 0, 9, 9]),
    });
    annot.set(PDFName.of('A'), ctx.register(action));
    page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
    return doc.save({ useObjectStreams: false });
  }

  /** A flat bookmark list of `n` siblings — the shape a long document's outline actually has. */
  async function outlineOfDepth(n: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const ctx = doc.context;
    let nextRef: ReturnType<typeof ctx.register> | undefined;
    for (let i = n - 1; i >= 0; i--) {
      const item = ctx.obj({ Title: PDFString.of(`item ${i}`) });
      if (nextRef) item.set(PDFName.of('Next'), nextRef);
      nextRef = ctx.register(item);
    }
    const outlines = ctx.obj({ Type: PDFName.of('Outlines') });
    if (nextRef) outlines.set(PDFName.of('First'), nextRef);
    doc.catalog.set(PDFName.of('Outlines'), ctx.register(outlines));
    return doc.save({ useObjectStreams: false });
  }

  it('the fixture really carries the Rendition script — the negative control', async () => {
    expect(asText(await withRendition(true))).toContain(REND_JS);
  });

  it('strips a /Rendition action carrying a /JS payload', async () => {
    expect(asText((await sanitizePdf(await withRendition(true))).bytes)).not.toContain(REND_JS);
  });

  it('keeps a /Rendition that carries NO script — the over-reach control', async () => {
    // A media rendition is ordinary document content. Stripping every /Rendition would satisfy the
    // case above while silently deleting legitimate multimedia, so the discriminator is the /JS
    // entry, not the /S subtype.
    expect(asText((await sanitizePdf(await withRendition(false))).bytes)).toContain(MEDIA);
  });

  it('walks a 10000-sibling outline without overflowing the stack', async () => {
    // 8000 passed on the shipped code and 10000 did not, so the guard sits above the measured cliff.
    const out = await sanitizePdf(await outlineOfDepth(10_000));
    expect(out.bytes.length).toBeGreaterThan(0);
  });
});

/**
 * Developer ruling, 2026-09-05 — sanitize strips the whole NON-JavaScript EGRESS class, and
 * `/FileAttachment` annotations with it.
 *
 * Five action subtypes reach outside the document without executing script, and none was named
 * anywhere in the sanitizer or the docs: `/SubmitForm` posts form data to a URL, `/Launch` starts an
 * external application or file, `/GoToR` and `/GoToE` open another document, `/ImportData` reads a
 * file into the form. A sanitized copy that still phones home on a button is the shape the
 * "cleaned" toast makes worse, not better. They ride the SAME splice as scripts, so a hyperlink
 * chained behind one survives and every position (head, chain, array, field, bookmark, cycle) is
 * covered by construction rather than one at a time — the defect shape this module has already
 * suffered three times.
 *
 * A paperclip annotation carries its file through `/FS`→`/EF`. Deleting the annotation from
 * `/Annots` is NOT enough on its own: an Acrobat-authored attachment has a `/Popup` whose `/Parent`
 * points back at it, which keeps the stream reachable for the sweep — exactly the reference-deleted,
 * payload-serialised shape WS5 P1 found. So `/FS` is deleted on the dict as well, and the Popup goes.
 */
describe('sanitizePdf — non-JavaScript egress actions and paperclip attachments (ruled 2026-09-05)', () => {
  const asText = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
  const uri = (u: string) => ({ S: PDFName.of('URI'), URI: PDFString.of(u) });
  const CHAINED = 'https://example.invalid/chained-behind-an-egress-action-9101';

  const EGRESS: Array<[string, string, (ctx: PDFDocument['context'], marker: string) => PDFDict]> = [
    ['SubmitForm', 'https://example.invalid/collect-9101', (ctx, m) => ctx.obj({
      S: PDFName.of('SubmitForm'), F: { FS: PDFName.of('URL'), F: PDFString.of(m) }, Flags: 4,
    })],
    ['Launch', 'SANITIZE_LAUNCH_TARGET_9101.exe', (ctx, m) => ctx.obj({
      S: PDFName.of('Launch'), F: PDFString.of(m),
    })],
    ['GoToR', 'SANITIZE_GOTOR_TARGET_9101.pdf', (ctx, m) => ctx.obj({
      S: PDFName.of('GoToR'), F: PDFString.of(m), D: ctx.obj([0, PDFName.of('Fit')]),
    })],
    ['GoToE', 'SANITIZE_GOTOE_TARGET_9101.pdf', (ctx, m) => ctx.obj({
      S: PDFName.of('GoToE'), F: PDFString.of(m), D: ctx.obj([0, PDFName.of('Fit')]),
    })],
    ['ImportData', 'SANITIZE_IMPORTDATA_TARGET_9101.fdf', (ctx, m) => ctx.obj({
      S: PDFName.of('ImportData'), F: PDFString.of(m),
    })],
  ];

  /** One Link annotation whose `/A` is the egress action, with a real hyperlink chained behind. */
  async function annotWith(build: (ctx: PDFDocument['context']) => PDFDict): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const action = build(ctx);
    action.set(PDFName.of('Next'), ctx.register(ctx.obj(uri(CHAINED))));
    const annot = ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: ctx.obj([0, 0, 9, 9]),
    });
    annot.set(PDFName.of('A'), ctx.register(action));
    page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
    return doc.save({ useObjectStreams: false });
  }

  it('the fixtures really carry their targets — the negative controls', async () => {
    for (const [, marker, build] of EGRESS) {
      expect(asText(await annotWith(ctx => build(ctx, marker)))).toContain(marker);
    }
  });

  for (const [subtype, marker, build] of EGRESS) {
    it(`strips /S /${subtype} from an annotation, reports it, and keeps the link chained behind it`, async () => {
      const out = await sanitizePdf(await annotWith(ctx => build(ctx, marker)));
      const text = asText(out.bytes);
      expect(text).not.toContain(marker);
      expect(text).toContain(CHAINED);
      expect(out.report.externalActions).toBe(true);
    });
  }

  it('keeps /GoTo and /URI — the over-reach controls, and the hyperlink promise', async () => {
    // The helper chains CHAINED (a /URI) behind whatever it is given; here that is a /GoTo, so
    // BOTH hyperlink kinds are in the file and both must come out.
    const out = await sanitizePdf(await annotWith(ctx =>
      ctx.obj({ S: PDFName.of('GoTo'), D: ctx.obj([0, PDFName.of('Fit')]) })));
    const doc = await PDFDocument.load(out.bytes, { updateMetadata: false });
    const annots = doc.getPages()[0].node.lookup(PDFName.of('Annots'), PDFArray);
    const action = annots.lookup(0, PDFDict).lookup(PDFName.of('A'), PDFDict);
    expect(action.lookup(PDFName.of('S'))).toBe(PDFName.of('GoTo'));
    expect(asText(out.bytes)).toContain(CHAINED);
    expect(out.report.externalActions).toBe(false);
    expect(out.report.annotActions).toBe(false);
  });

  it('strips a /SubmitForm on a FORM FIELD and on a BOOKMARK — the class covers every position', async () => {
    const FIELD = 'https://example.invalid/field-submit-9101';
    const BOOKMARK = 'https://example.invalid/bookmark-submit-9101';
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const ctx = doc.context;
    const submit = (m: string) => ctx.register(ctx.obj({
      S: PDFName.of('SubmitForm'), F: { FS: PDFName.of('URL'), F: PDFString.of(m) },
    }));
    const field = ctx.obj({ FT: PDFName.of('Btn'), T: PDFString.of('go') });
    field.set(PDFName.of('A'), submit(FIELD));
    doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: ctx.obj([ctx.register(field)]) }));
    const item = ctx.obj({ Title: PDFString.of('Send') });
    item.set(PDFName.of('A'), submit(BOOKMARK));
    const itemRef = ctx.register(item);
    doc.catalog.set(PDFName.of('Outlines'), ctx.obj({ First: itemRef, Last: itemRef }));
    const src = await doc.save({ useObjectStreams: false });
    expect(asText(src)).toContain(FIELD);
    expect(asText(src)).toContain(BOOKMARK);

    const out = asText((await sanitizePdf(src)).bytes);
    expect(out).not.toContain(FIELD);
    expect(out).not.toContain(BOOKMARK);
  });

  // ── paperclip attachments ─────────────────────────────────────────────────────────────────
  const PAYLOAD = 'SANITIZE_PAPERCLIP_PAYLOAD_MUST_NOT_SURVIVE_9102';
  const NOTE = 'SANITIZE_STICKY_NOTE_MUST_SURVIVE_9102';

  /**
   * `/Annots` = [Text, FileAttachment, Popup(parent → FileAttachment), Text]. The Popup sits
   * DIRECTLY after the attachment because that is the only order in which a forward loop over
   * `remove` (which shifts later indices down) is observable: removing index 1 moves the Popup
   * to index 1 and the loop steps past it. A note in between made the first version of this
   * fixture pass under that exact sabotage. `irt` adds a reply note carrying `/IRT` → the
   * attachment, which keeps the attachment dict reachable through something that is NOT removed —
   * the shape that makes deleting `/FS` on the dict load-bearing rather than belt-and-braces.
   * `indirectSubtype` writes `/Subtype` as an indirect ref — round 6 found an indirect `/S`
   * survived every check, and `/Subtype` is the same trap.
   */
  async function withPaperclip(opts: { popup: boolean; indirectSubtype?: boolean; irt?: boolean }): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const note = (y: number) => ctx.register(ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Text'), Rect: ctx.obj([0, y, 9, y + 9]),
      Contents: PDFString.of(NOTE),
    }));
    // UNCOMPRESSED, so the byte scan can see it — a flate stream would hide the marker and the
    // assertion would pass whether the payload survived or not.
    const ef = ctx.register(ctx.stream(PAYLOAD, { Type: PDFName.of('EmbeddedFile') }));
    const fs = ctx.register(ctx.obj({
      Type: PDFName.of('Filespec'), F: PDFString.of('secret.txt'), EF: ctx.obj({ F: ef }),
    }));
    const attach = ctx.obj({
      Type: PDFName.of('Annot'), Rect: ctx.obj([20, 0, 29, 9]), FS: fs,
    });
    attach.set(PDFName.of('Subtype'),
      opts.indirectSubtype ? ctx.register(PDFName.of('FileAttachment')) : PDFName.of('FileAttachment'));
    const attachRef = ctx.register(attach);
    const annots = [note(0), attachRef];
    if (opts.popup) {
      const popup = ctx.obj({
        Type: PDFName.of('Annot'), Subtype: PDFName.of('Popup'), Rect: ctx.obj([50, 0, 90, 40]),
        Parent: attachRef, Open: false,
      });
      const popupRef = ctx.register(popup);
      attach.set(PDFName.of('Popup'), popupRef);
      annots.push(popupRef);
    }
    const last = note(40);
    if (opts.irt) {
      const reply = ctx.lookup(last, PDFDict);
      reply.set(PDFName.of('IRT'), attachRef);
      reply.set(PDFName.of('RT'), PDFName.of('R'));
    }
    annots.push(last);
    page.node.set(PDFName.of('Annots'), ctx.obj(annots));
    return doc.save({ useObjectStreams: false });
  }

  async function annotSubtypes(bytes: Uint8Array): Promise<string[]> {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const annots = doc.getPages()[0].node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return [];
    return annots.asArray().map(ref => {
      const dict = doc.context.lookup(ref, PDFDict);
      return (doc.context.lookup(dict.get(PDFName.of('Subtype'))) as PDFName).decodeText();
    });
  }

  it('the fixture really carries the payload — the negative control', async () => {
    expect(asText(await withPaperclip({ popup: true }))).toContain(PAYLOAD);
  });

  it('removes the paperclip annotation and its file from the BYTES, and reports it', async () => {
    const out = await sanitizePdf(await withPaperclip({ popup: false }));
    expect(asText(out.bytes)).not.toContain(PAYLOAD);
    expect(out.report.fileAttachments).toBe(true);
    expect(await annotSubtypes(out.bytes)).toEqual(['Text', 'Text']);
  });

  it('keeps BOTH sticky notes around the attachment — the over-reach control', async () => {
    const out = await sanitizePdf(await withPaperclip({ popup: false }));
    const text = asText(out.bytes);
    expect(text.split(NOTE).length - 1).toBe(2);
  });

  it('removes the /Popup that sits DIRECTLY after the attachment — the forward-loop shape', async () => {
    // `PDFArray.remove` shifts later indices down: a forward loop that removes index 1 finds the
    // Popup at index 1 next and steps past it to index 2. Sabotage-measured — with a note between
    // the two this case stayed green under exactly that mutation.
    const out = await sanitizePdf(await withPaperclip({ popup: true }));
    expect(asText(out.bytes)).not.toContain(PAYLOAD);
    expect(await annotSubtypes(out.bytes)).toEqual(['Text', 'Text']);
  });

  it('removes the payload when a REPLY note still references the attachment through /IRT', async () => {
    // Pages → Annots → Text(/IRT) → attachment → /FS → /EF reaches the stream after the attachment
    // and its Popup are off the array, and the sweep keeps everything reachable. So `/FS` has to go
    // on the dict itself; removing the annotation alone re-serialises the file bytes.
    const out = await sanitizePdf(await withPaperclip({ popup: true, irt: true }));
    expect(asText(out.bytes)).not.toContain(PAYLOAD);
    expect(await annotSubtypes(out.bytes)).toEqual(['Text', 'Text']);
  });

  it('recognises an INDIRECT /Subtype', async () => {
    const out = await sanitizePdf(await withPaperclip({ popup: true, indirectSubtype: true }));
    expect(asText(out.bytes)).not.toContain(PAYLOAD);
    expect(out.report.fileAttachments).toBe(true);
  });

  it('leaves a document with no paperclip untouched on that axis — the over-reach control', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Text'), Rect: ctx.obj([0, 0, 9, 9]),
      Contents: PDFString.of(NOTE),
    }))]));
    const out = await sanitizePdf(await doc.save({ useObjectStreams: false }));
    expect(out.report.fileAttachments).toBe(false);
    expect(await annotSubtypes(out.bytes)).toEqual(['Text']);
  });
});

/**
 * Post-push single-lens review of `3fc0863` (2026-09-05) — five findings, the first a P0.
 *
 * `/AF` (PDF 2.0 associated files) is a SECOND path from an annotation dict to a Filespec. The
 * commit deleted `/FS` on a paperclip and handled `/AF` on the catalog and every page, but never on
 * an annotation — so with `/AF [fs]` on the attachment and ANY surviving reference to the dict (a
 * reply note's `/IRT`, a Popup listed on another page) the sweep followed dict → `/AF` → `/EF` and
 * re-serialised the file while `report.fileAttachments` said `true`. The same shape the commit
 * message claims to close, one key over. Every annotation now loses `/AF`, paperclip or not.
 */
describe('sanitizePdf — /AF on annotations, cross-page Popups, array cycles, kept media (review of 3fc0863)', () => {
  const asText = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
  const PAYLOAD = 'SANITIZE_AF_PAYLOAD_MUST_NOT_SURVIVE_9103';

  function filespec(ctx: PDFDocument['context']) {
    const ef = ctx.register(ctx.stream(PAYLOAD, { Type: PDFName.of('EmbeddedFile') }));
    return ctx.register(ctx.obj({
      Type: PDFName.of('Filespec'), F: PDFString.of('secret.txt'), EF: ctx.obj({ F: ef }),
    }));
  }
  async function subtypesOf(bytes: Uint8Array, pageIdx: number): Promise<string[]> {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const annots = doc.getPages()[pageIdx].node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return [];
    return annots.asArray().map(ref => {
      const dict = doc.context.lookup(ref, PDFDict);
      return (doc.context.lookup(dict.get(PDFName.of('Subtype'))) as PDFName).decodeText();
    });
  }

  it('P0 — a paperclip carrying /AF as well as /FS, kept alive by a reply note, still loses its file', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const fs = filespec(ctx);
    const attach = ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('FileAttachment'), Rect: ctx.obj([0, 0, 9, 9]),
      FS: fs, AF: ctx.obj([fs]),
    });
    const attachRef = ctx.register(attach);
    const reply = ctx.register(ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Text'), Rect: ctx.obj([20, 0, 29, 9]),
      IRT: attachRef, RT: PDFName.of('R'),
    }));
    page.node.set(PDFName.of('Annots'), ctx.obj([attachRef, reply]));
    const src = await doc.save({ useObjectStreams: false });
    expect(asText(src)).toContain(PAYLOAD);
    const out = await sanitizePdf(src);
    expect(asText(out.bytes)).not.toContain(PAYLOAD);
    expect(out.report.fileAttachments).toBe(true);
    expect(await subtypesOf(out.bytes, 0)).toEqual(['Text']);
  });

  it('P2 — /AF on an ORDINARY annotation is removed and reported as an associated file', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const note = ctx.register(ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Text'), Rect: ctx.obj([0, 0, 9, 9]),
      AF: ctx.obj([filespec(ctx)]),
    }));
    page.node.set(PDFName.of('Annots'), ctx.obj([note]));
    const out = await sanitizePdf(await doc.save({ useObjectStreams: false }));
    expect(asText(out.bytes)).not.toContain(PAYLOAD);
    expect(out.report.associatedFiles).toBe(true);
    expect(out.report.fileAttachments).toBe(false);
    expect(await subtypesOf(out.bytes, 0)).toEqual(['Text']);
  });

  it('P3 — a Popup listed on ANOTHER page than its paperclip is removed with it', async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([200, 200]);
    const p2 = doc.addPage([200, 200]);
    const ctx = doc.context;
    const attach = ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('FileAttachment'), Rect: ctx.obj([0, 0, 9, 9]),
      FS: filespec(ctx),
    });
    const attachRef = ctx.register(attach);
    const popup = ctx.register(ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Popup'), Rect: ctx.obj([0, 0, 40, 40]),
      Parent: attachRef,
    }));
    attach.set(PDFName.of('Popup'), popup);
    p1.node.set(PDFName.of('Annots'), ctx.obj([attachRef]));
    p2.node.set(PDFName.of('Annots'), ctx.obj([popup]));
    const out = await sanitizePdf(await doc.save({ useObjectStreams: false }));
    expect(asText(out.bytes)).not.toContain(PAYLOAD);
    expect(await subtypesOf(out.bytes, 0)).toEqual([]);
    expect(await subtypesOf(out.bytes, 1)).toEqual([]);
  });

  it('P3 — a /Next ARRAY that contains itself terminates instead of overflowing the stack', async () => {
    const JS = 'SANITIZE_ARRAY_SELF_CYCLE_JS_9103()';
    const KEEP = 'https://example.invalid/kept-beside-a-self-cyclic-array-9103';
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const arr = ctx.obj([]) as PDFArray;
    const arrRef = ctx.register(arr);
    arr.push(arrRef);
    arr.push(ctx.register(ctx.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of(JS) })));
    arr.push(ctx.register(ctx.obj({ S: PDFName.of('URI'), URI: PDFString.of(KEEP) })));
    const head = ctx.obj({ S: PDFName.of('URI'), URI: PDFString.of('https://example.invalid/head-9103') });
    head.set(PDFName.of('Next'), arrRef);
    const annot = ctx.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: ctx.obj([0, 0, 9, 9]) });
    annot.set(PDFName.of('A'), ctx.register(head));
    page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
    const out = await sanitizePdf(await doc.save({ useObjectStreams: false }));
    const text = asText(out.bytes);
    expect(text).not.toContain(JS);
    expect(text).toContain(KEEP);
    expect(out.report.annotActions).toBe(true);
  });

  it('keeps in-document media actions — the sentence in SECURITY.md that had no test', async () => {
    const MEDIA = 'https://example.invalid/media-must-survive-9103.mp3';
    const kinds = ['Sound', 'Movie', 'GoTo3DView', 'RichMediaExecute', 'Rendition'];
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const annots = kinds.map((k, i) => {
      const action = ctx.obj({ S: PDFName.of(k), F: PDFString.of(`${k}-${MEDIA}`) });
      const annot = ctx.obj({
        Type: PDFName.of('Annot'), Subtype: PDFName.of('Screen'), Rect: ctx.obj([i * 10, 0, i * 10 + 9, 9]),
      });
      annot.set(PDFName.of('A'), ctx.register(action));
      return ctx.register(annot);
    });
    page.node.set(PDFName.of('Annots'), ctx.obj(annots));
    const out = await sanitizePdf(await doc.save({ useObjectStreams: false }));
    const text = asText(out.bytes);
    for (const k of kinds) expect(text).toContain(`${k}-${MEDIA}`);
    expect(out.report.annotActions).toBe(false);
    expect(out.report.externalActions).toBe(false);
  });
});
