/**
 * SEC-1, milestone-1 panel round 7 (2026-10-08). The shapes the round found, fixed by CLASS (developer ruling: "bound
 * the hunt"): a cut that only catches what a walk found fails open (structure tree, field tree), a direct entry of a
 * dictionary a removed page reaches is the removed page's too, an annotation tied to a removed page by `/P` is the
 * removed page's (Flatten takes it out of `/Annots` first), and the prune must read what pdf.js reads — or refuse.
 * Page index 1 is left out unless a case says otherwise.
 */
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import { copySourcePages, resolveStandIns } from '../../src/export/copySourcePages';
import { flattenDocumentAnnotations } from '../../src/export/flattenAnnotations';
import { ExportService, type IExportContext } from '../../src/export/exportService';

const PUB = 'PUBLICKEPTNEEDLE';
const SEC = 'SECRETREMOVEDNEEDLE';

const latin = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const txt = (t: string) => `BT /F1 12 Tf 20 200 Td (${t}) Tj ET`;

async function exported(src: PDFDocument, keep: number[], opts: { prune?: boolean; standIn?: number[] } = {}): Promise<Uint8Array> {
  const dest = await PDFDocument.create({ updateMetadata: false });
  const { pages, standIns } = await copySourcePages(dest, src, keep, {
    ...(opts.prune === false ? {} : { pruneSharedResources: true }), ...(opts.standIn ? { standIns: opts.standIn } : {}),
  });
  pages.forEach(p => dest.addPage(p));
  if (standIns.size) await resolveStandIns(dest, new Map([...standIns.values()].map(r => [r, undefined])));
  return dest.save({ useObjectStreams: false });
}

const reload = async (d: PDFDocument) => PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });

type Ctx = PDFDocument['context'];
type Ref = ReturnType<Ctx['register']>;
async function shape(build: (h: {
  d: PDFDocument; ctx: Ctx; p1: ReturnType<PDFDocument['addPage']>; p2: ReturnType<PDFDocument['addPage']>;
  form: (t: string, extra?: Record<string, unknown>) => Ref; content: (s: string, extra?: Parameters<Ctx['stream']>[1]) => Ref; font: Ref;
}) => void): Promise<PDFDocument> {
  const d = await PDFDocument.create({ updateMetadata: false });
  const ctx = d.context;
  const p1 = d.addPage([300, 300]); const p2 = d.addPage([300, 300]);
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const form = (t: string, extra: Record<string, unknown> = {}) => ctx.register(ctx.stream(txt(t),
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], Resources: { Font: { F1: font } }, ...extra }));
  const content = (s: string, extra: Parameters<Ctx['stream']>[1] = {}) => ctx.register(ctx.stream(s, extra));
  build({ d, ctx, p1, p2, form, content, font });
  return reload(d);
}

type StructVariant = 'rootKIndirect' | 'sectIndirect' | 'docSString' | 'noRoot' | 'orphanSe2' | 'typelessSubtype';
/** `typeless`: no element carries /Type, so only the tree walk and the /P chain can tell them apart. */
function struct(variant: StructVariant, via: 'SD' | 'Dest', typeless = false, brokenP = false): Promise<PDFDocument> {
  return shape(({ d, ctx, p1, p2, form, content, font }) => {
    const fm2 = form(SEC);
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(PUB) } }));
    p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm2: fm2 } }));
    p1.node.set(PDFName.of('Contents'), content('/H1 <</MCID 0>> BDC /Fm1 Do EMC'));
    p2.node.set(PDFName.of('Contents'), content('/P <</MCID 0>> BDC /Fm2 Do EMC'));
    const root = ctx.nextRef(); const doc = ctx.nextRef(); const sect = ctx.nextRef();
    const parentOfLeaves = variant === 'sectIndirect' ? sect : doc;
    const T = typeless ? {} : { Type: 'StructElem' };
    const se1 = ctx.register(ctx.obj({ ...T, S: 'H1', P: parentOfLeaves, Pg: p1.ref, K: 0 }));
    const se2 = ctx.register(ctx.obj({
      ...(variant === 'typelessSubtype' ? { Subtype: 'X' } : T), S: 'P', P: brokenP ? ctx.register(ctx.obj({})) : parentOfLeaves, Pg: p2.ref,
      ActualText: PDFString.of(SEC + 'AT'), K: { Type: 'MCR', Pg: p2.ref, MCID: 0, Stm: fm2 },
    }));
    const leaves = variant === 'orphanSe2' ? [se1] : [se1, se2];
    if (variant === 'sectIndirect') {
      ctx.assign(sect, ctx.obj({ ...T, S: 'Sect', P: doc, K: leaves }));
      ctx.assign(doc, ctx.obj({ ...T, S: 'Document', P: root, K: ctx.register(ctx.obj([sect])) }));
    } else {
      ctx.assign(doc, ctx.obj({ ...T, S: variant === 'docSString' ? PDFString.of('Document') : 'Document', P: root, K: leaves }));
    }
    const rootK = variant === 'rootKIndirect' ? ctx.register(ctx.obj([doc])) : ctx.obj([doc]);
    ctx.assign(root, ctx.obj({ Type: 'StructTreeRoot', K: rootK }));
    if (variant !== 'noRoot') d.catalog.set(PDFName.of('StructTreeRoot'), root);
    const target = variant === 'orphanSe2' || variant === 'typelessSubtype' || brokenP ? se2 : se1;
    const action = via === 'SD' ? { A: { S: 'GoTo', D: [p1.ref, PDFName.of('Fit')], SD: [target, PDFName.of('Fit')] } } : { Dest: [target, PDFName.of('Fit')] };
    p1.node.set(PDFName.of('Annots'), ctx.obj([ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], ...action })]));
  });
}

/** Two pages showing text only; `extra` adds the shape. */
const plain = (extra: (h: Parameters<Parameters<typeof shape>[0]>[0]) => void) => shape(h => {
  const { ctx, p1, p2, content, font } = h;
  for (const [p, t] of [[p1, PUB], [p2, 'other']] as const) {
    p.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font } }));
    p.node.set(PDFName.of('Contents'), content(txt(t)));
  }
  extra(h);
});

/** A field parent on the kept widget's chain whose /V only the removed page's kid shows (R7-S-3). */
const fieldParentV = (inAcroForm: boolean) => plain(({ d, ctx, p1, p2 }) => {
  const P = ctx.nextRef();
  const f1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('a'), V: PDFString.of('visible'), DV: PDFString.of('own'),
    Parent: P, Rect: [10, 10, 100, 40], P: p1.ref }));
  const f2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('b'), Parent: P, Rect: [10, 10, 100, 40], P: p2.ref }));
  ctx.assign(P, ctx.obj({ T: PDFString.of('grp'), FT: 'Tx', V: PDFString.of(SEC), DV: PDFString.of(SEC + 'DV'), Kids: [f1, f2] }));
  p1.node.set(PDFName.of('Annots'), ctx.obj([f1])); p2.node.set(PDFName.of('Annots'), ctx.obj([f2]));
  if (inAcroForm) d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [P] }));
});

/** Shared undrawn keys the round-6 list did not name (R7-S-5). */
type UndrawnWhere = 'pageAF' | 'pageMetadata' | 'imageMetadata' | 'formAF' | 'annotAF' | 'vpPtData' | 'oiIccMetadata';
const sharedUndrawn = (where: UndrawnWhere) => shape(({ ctx, p1, p2, form, content, font }) => {
  const secretStream = ctx.register(ctx.stream(`DATA ${SEC}`, { Type: 'EmbeddedFile' }));
  const fs = ctx.register(ctx.obj({ Type: 'Filespec', F: PDFString.of('x.csv'), EF: { F: secretStream }, AFRelationship: 'Data' }));
  const xmp = ctx.register(ctx.stream(`<x:xmpmeta>${SEC}</x:xmpmeta>`, { Type: 'Metadata', Subtype: 'XML' }));
  const icc = ctx.register(ctx.stream('ICCBYTES', { N: 3, Metadata: xmp }));
  const pt = ctx.register(ctx.obj({ Type: 'PtData', Subtype: 'Cloud', Names: [PDFString.of(SEC)], XPTS: [[1]] }));
  const vp = () => ctx.obj([{ Type: 'Viewport', BBox: [0, 0, 100, 100], Measure: { Type: 'Measure', Subtype: 'GEO', PtData: pt } }]);
  const oi = () => ctx.obj([{ Type: 'OutputIntent', S: 'GTS_PDFX', OutputConditionIdentifier: PDFString.of('x'), DestOutputProfile: icc }]);
  const im1 = ctx.register(ctx.stream(new Uint8Array([7]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
    ...(where === 'imageMetadata' ? { Metadata: xmp } : {}) }));
  const fm1 = form(PUB, where === 'formAF' ? { AF: [fs] } : {});
  p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm1: fm1, Im1: im1 } }));
  p1.node.set(PDFName.of('Contents'), content('/Fm1 Do q 9 0 0 9 0 0 cm /Im1 Do Q'));
  if (where === 'pageAF') p1.node.set(PDFName.of('AF'), ctx.obj([fs]));
  if (where === 'pageMetadata') p1.node.set(PDFName.of('Metadata'), xmp);
  if (where === 'vpPtData') p1.node.set(PDFName.of('VP'), vp());
  if (where === 'oiIccMetadata') p1.node.set(PDFName.of('OutputIntents'), oi());
  if (where === 'annotAF') p1.node.set(PDFName.of('Annots'), ctx.obj([ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [1, 1, 9, 9], AF: [fs] })]));
  p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm2: form('other'), Im2: ctx.register(ctx.stream(new Uint8Array([8]),
    { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Metadata: xmp })) } }));
  p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  p2.node.set(PDFName.of('AF'), ctx.obj([fs])); p2.node.set(PDFName.of('VP'), vp()); p2.node.set(PDFName.of('OutputIntents'), oi());
});

/** A shared /Properties holding a DIRECT property list only the removed page names (R7-S-10). */
const propertiesDirect = (subIndirect: boolean) => shape(({ ctx, p1, p2, form, content, font }) => {
  const P = ctx.obj({ MC1: { ActualText: PDFString.of(PUB) }, MC2: { ActualText: PDFString.of(SEC) } });
  const S = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form('k'), Fm2: form('r') }, Properties: subIndirect ? ctx.register(P) : P }));
  p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
  p1.node.set(PDFName.of('Contents'), content('/Span /MC1 BDC /Fm1 Do EMC')); p2.node.set(PDFName.of('Contents'), content('/Span /MC2 BDC /Fm2 Do EMC'));
});

/** A reply on the kept page to a removed page's note; `listed` false = the note is on no page's /Annots (R7-S-8). */
const noteReply = (listed: boolean) => plain(({ ctx, p1, p2 }) => {
  const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of(SEC), P: p2.ref }));
  const reply = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('re'), IRT: note, P: p1.ref }));
  p1.node.set(PDFName.of('Annots'), ctx.obj([reply]));
  if (listed) p2.node.set(PDFName.of('Annots'), ctx.obj([note]));
});

/** A field's /DR, shared with the removed page, whose removed widget's /DA names the removed page's form (R7-S-6). */
const daDescendant = () => shape(({ d, ctx, p1, p2, form, content, font }) => {
  const S = ctx.register(ctx.obj({ Font: { F1: font, Helv: font }, XObject: { Fm1: form(PUB), Fm2: form(SEC) } }));
  p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
  p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  const P = ctx.nextRef();
  const w1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Parent: P, Rect: [10, 10, 100, 40], P: p1.ref, DA: PDFString.of('/Helv 10 Tf 0 g') }));
  const w2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Parent: P, Rect: [10, 10, 100, 40], P: p2.ref, DA: PDFString.of('/Fm2 Do /Helv 10 Tf 0 g') }));
  ctx.assign(P, ctx.obj({ T: PDFString.of('f'), FT: 'Tx', Kids: [w1, w2], DR: S }));
  p1.node.set(PDFName.of('Annots'), ctx.obj([w1])); p2.node.set(PDFName.of('Annots'), ctx.obj([w2]));
  d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [P] }));
});

const LEAKS: Record<string, () => Promise<PDFDocument>> = {
  // Class 1, the structure cut: membership decided, so what the walk missed passed (R7-S-1, R7-S-2).
  ...Object.fromEntries((['rootKIndirect', 'sectIndirect', 'docSString', 'noRoot', 'orphanSe2', 'typelessSubtype'] as const)
    .flatMap(v => (['SD', 'Dest'] as const).map(via => [`struct ${v} via ${via}`, () => struct(v, via)]))),
  // The same with no /Type anywhere: the walk (an indirect /K, a non-name /S) and the /P chain each have to hold alone.
  ...Object.fromEntries((['rootKIndirect', 'sectIndirect', 'docSString', 'noRoot', 'orphanSe2'] as const)
    .map(v => [`struct ${v}, untyped`, () => struct(v, 'SD', true)])),
  // Untyped, and its /P leads nowhere: only the walk of the tree finds it, through the /K array stored on its own.
  'struct rootKIndirect, untyped, broken /P': () => struct('rootKIndirect', 'Dest', true, true),
  // Class 1, the field cut: a field-tree node /Fields does not list (R7-S-4).
  nodeNotInFields: () => plain(({ d, ctx, p1, p2 }) => {
    const node = ctx.nextRef(); const kid = ctx.nextRef();
    const w2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 100, 40], Parent: kid, P: p2.ref }));
    ctx.assign(kid, ctx.obj({ FT: 'Tx', T: PDFString.of('last4'), Parent: node, Kids: [w2] }));
    ctx.assign(node, ctx.obj({ T: PDFString.of('ssn'), V: PDFString.of(SEC), Kids: [kid] }));
    const btn = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Btn', Ff: 65536, T: PDFString.of('clear'), Rect: [10, 60, 100, 90], P: p1.ref,
      A: { S: 'ResetForm', Fields: [node] } }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([btn])); p2.node.set(PDFName.of('Annots'), ctx.obj([w2]));
    d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [btn, kid] }));
  }),
  'field parent /V (in /Fields)': () => fieldParentV(true),
  'field parent /V (no AcroForm)': () => fieldParentV(false),
  // Class 2, direct entries: a direct value in a dictionary a removed page reaches is the removed page's too.
  'properties direct (sub-dictionary direct)': () => propertiesDirect(false),
  'properties direct (sub-dictionary indirect)': () => propertiesDirect(true),
  // A shared /Resources holding no reference at all: reached, so shared, though no entry "touches" anything.
  'shared resources with only direct entries': () => shape(({ ctx, p1, p2, content }) => {
    const S = ctx.register(ctx.obj({ Properties: { MC1: { ActualText: PDFString.of(PUB) }, MC2: { ActualText: PDFString.of(SEC) } } }));
    p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
    p1.node.set(PDFName.of('Contents'), content('/Span /MC1 BDC EMC')); p2.node.set(PDFName.of('Contents'), content('/Span /MC2 BDC EMC'));
  }),
  // A direct /PieceInfo inside a form both pages draw: the form is reached, so its direct application data is too.
  'direct /PieceInfo in a shared form': () => shape(({ ctx, p1, p2, form, content, font }) => {
    const fm = form(PUB, { PieceInfo: { App: { Private: PDFString.of(SEC) } } });
    for (const p of [p1, p2]) { p.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm: fm } })); p.node.set(PDFName.of('Contents'), content('/Fm Do')); }
  }),
  ...Object.fromEntries((['pageAF', 'pageMetadata', 'imageMetadata', 'formAF', 'annotAF', 'vpPtData', 'oiIccMetadata'] as const)
    .map(w => [`undrawn ${w}`, () => sharedUndrawn(w)])),
  // An annotation whose /P is the removed page is the removed page's, listed or not (R7-S-8).
  'note on no page, /P the removed page': () => noteReply(false),
  'removed widget /DA in a shared /DR': daDescendant,
};

describe('SEC-1 round 7 — the leak classes', () => {
  it.each(Object.keys(LEAKS).flatMap(name => (['cut', 'standIn'] as const).map(mode => [name, mode] as const)))('%s (%s)', async (name, mode) => {
    const src = await LEAKS[name]();
    expect(latin(await src.save({ useObjectStreams: false })).includes(SEC), 'control: the source carries it').toBe(true);
    const out = latin(await exported(src, [0], { standIn: mode === 'standIn' ? [1] : undefined }));
    expect(out.includes(SEC), "the removed page's content").toBe(false);
    expect(out.includes(PUB), "the kept page's own content").toBe(true);
  });

  // Flatten & download flattens the SOURCE first, taking the removed page's annotations out of its /Annots (R7-S-12).
  it.each(['reply without an appearance', 'link hiding the note'] as const)('Flatten, then a page left out: %s', async (kind) => {
    const src = await plain(({ ctx, p1, p2, font }) => {
      const ap = ctx.register(ctx.stream(`BT /F1 9 Tf 1 1 Td (${SEC}AP) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 20], Resources: { Font: { F1: font } } }));
      const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: kind === 'reply without an appearance' ? 'Text' : 'FreeText', Rect: [10, 10, 110, 30], F: 4,
        Contents: PDFString.of(SEC), DA: PDFString.of('/Helv 9 Tf 0 g'), P: p2.ref, AP: { N: ap } }));
      const onKept = kind === 'reply without an appearance'
        ? ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 20, 20], F: 4, Contents: PDFString.of('reply'), IRT: note, P: p1.ref }))
        : ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], A: { S: 'Hide', T: note, H: true } });
      p1.node.set(PDFName.of('Annots'), ctx.obj([onKept])); p2.node.set(PDFName.of('Annots'), ctx.obj([note]));
    });
    await flattenDocumentAnnotations(src);
    for (const mode of ['cut', 'standIn'] as const) {
      const out = latin(await exported(src, [0], { standIn: mode === 'standIn' ? [1] : undefined }));
      expect(out.includes(SEC), mode).toBe(false);
    }
  });
});

/** A removed page's note WITHOUT /P (it is optional), replied to from the kept page: only /Annots ties it to its page. */
const noteNoP = () => plain(({ ctx, p1, p2, font }) => {
  const ap = ctx.register(ctx.stream(`BT /F1 9 Tf 1 1 Td (${SEC}AP) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 20], Resources: { Font: { F1: font } } }));
  const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 110, 30], F: 4, Contents: PDFString.of(SEC), AP: { N: ap } }));
  const reply = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 20, 20], F: 4, Contents: PDFString.of('reply'), IRT: note, P: p1.ref }));
  p1.node.set(PDFName.of('Annots'), ctx.obj([reply])); p2.node.set(PDFName.of('Annots'), ctx.obj([note]));
});

describe('SEC-1 round 7 — Flatten empties /Annots before the copy (R7-S-12)', () => {
  it("copySourcePages cuts what each page's /Annots listed BEFORE the source was flattened", async () => {
    const src = await noteNoP();
    const listed = src.getPages().map(p => (p.node.lookup(PDFName.of('Annots'), PDFArray)).asArray() as Ref[]);
    await flattenDocumentAnnotations(src);
    const dest = await PDFDocument.create({ updateMetadata: false });
    const { pages } = await copySourcePages(dest, src, [0], { annotsBefore: listed });
    pages.forEach(p => dest.addPage(p));
    expect(latin(await dest.save({ useObjectStreams: false })).includes(SEC)).toBe(false);
  });

  it('Flatten & download with the note\'s page deleted carries no note text', async () => {
    const src = await noteNoP();
    const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
    const svc = new ExportService({
      documentModel: {
        pageCount: 1, currentPageIndex: 0, pages: [{ id: 'p0', sourcePdfId: 's', sourcePageNum: 1, rotation: 0 }],
        sourcePdfs: new Map([['s', { bytes: await src.save({ useObjectStreams: false }) }]]), watermark: { enabled: false }, bates: { enabled: false },
      },
      elements: [], formValues: {}, currentFilename: 'r7.pdf', exportPassword: null, inkLayer: { getStrokes: () => [] },
      reportError: { info() {}, warn() {}, error() {} }, progress: { begin: () => handle },
      cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
    } as unknown as IExportContext);
    const assemble = (svc as unknown as { _assemblePdfDoc(p: undefined, s: undefined, o: { flattenAllForms: boolean }): Promise<PDFDocument> })._assemblePdfDoc.bind(svc);
    const out = await assemble(undefined, undefined, { flattenAllForms: true });
    expect(latin(await out.save({ useObjectStreams: false })).includes(SEC)).toBe(false);
  });
});

describe('SEC-1 round 7 — the cuts keep what the kept pages show', () => {
  it("a field parent's /V a KEPT widget inherits stays", async () => {
    const src = await plain(({ d, ctx, p1, p2 }) => {
      const P = ctx.nextRef();
      const f1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('a'), Parent: P, Rect: [10, 10, 100, 40], P: p1.ref }));
      const f2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('b'), Parent: P, Rect: [10, 10, 100, 40], P: p2.ref }));
      ctx.assign(P, ctx.obj({ T: PDFString.of('grp'), FT: 'Tx', V: PDFString.of('SHOWNONKEPT'), Kids: [f1, f2] }));
      p1.node.set(PDFName.of('Annots'), ctx.obj([f1])); p2.node.set(PDFName.of('Annots'), ctx.obj([f2]));
      d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [P] }));
    });
    expect(latin(await exported(src, [0])).includes('SHOWNONKEPT')).toBe(true);
  });

  it("a field parent's /DV a kept widget inherits stays, though the kept widget has its own /V", async () => {
    const src = await plain(({ d, ctx, p1, p2 }) => {
      const P = ctx.nextRef();
      const f1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('a'), V: PDFString.of('x'), Parent: P, Rect: [10, 10, 100, 40], P: p1.ref }));
      const f2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('b'), Parent: P, Rect: [10, 10, 100, 40], P: p2.ref }));
      ctx.assign(P, ctx.obj({ T: PDFString.of('grp'), FT: 'Tx', V: PDFString.of(SEC), DV: PDFString.of('DEFAULTONKEPT'), Kids: [f1, f2] }));
      p1.node.set(PDFName.of('Annots'), ctx.obj([f1])); p2.node.set(PDFName.of('Annots'), ctx.obj([f2]));
      d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [P] }));
    });
    const out = latin(await exported(src, [0]));
    expect(out.includes('DEFAULTONKEPT')).toBe(true);
    expect(out.includes(SEC)).toBe(false);
  });

  it('with every page kept, a field parent keeps its /V (nothing is cut)', async () => {
    expect(latin(await exported(await fieldParentV(true), [0, 1])).includes(SEC)).toBe(true);
  });

  it('a drawn direct property list stays', async () => {
    const out = await PDFDocument.load(await exported(await propertiesDirect(false), [0]), { updateMetadata: false });
    const props = out.getPage(0).node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Properties'), PDFDict);
    expect(props.keys().map(k => k.decodeText())).toEqual(['MC1']);
  });

  it('a note listed on the KEPT page stays, though its /P names the removed page', async () => {
    const src = await plain(({ ctx, p1, p2 }) => {
      p1.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('KEPTNOTE'), P: p2.ref }))]));
    });
    expect(latin(await exported(src, [0])).includes('KEPTNOTE')).toBe(true);
  });
});

describe('SEC-1 round 7 — the prune reads what pdf.js reads', () => {
  /** PNG predictor 10 (None) with `cols` columns: a 0 tag byte before every row — pdf.js reads it, pdf-lib does not. */
  const pngNone = (text: string, cols: number) => {
    const bytes = Buffer.from(text, 'latin1'); const out: number[] = [];
    for (let i = 0; i < bytes.length; i += cols) { out.push(0); for (let k = 0; k < cols; k++) out.push(bytes[i + k] ?? 0x20); }
    return new Uint8Array(deflateSync(Buffer.from(out)));
  };

  it('a content stream with a /Predictor refuses instead of dropping what it draws (R7-C-1)', async () => {
    const src = await shape(({ ctx, p1, p2, form }) => {
      const S = ctx.register(ctx.obj({ XObject: { Fm1: form(PUB), Fm2: form(SEC) } }));
      p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
      p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(pngNone('/Fm1 Do\n', 2), { Filter: 'FlateDecode', DecodeParms: { Predictor: 10, Columns: 2 } })));
      p2.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm2 Do')));
    });
    await expect(exported(src, [0])).rejects.toMatchObject({ name: 'ExportResourcesUnreadableError' });
    expect(latin(await exported(src, [0], { prune: false })).includes(PUB), 'control: unshared reading is not needed').toBe(true);
  });

  it.each([['removed', 5], ['removed', [1]], ['kept', 5], ['kept', [1]]] as const)('a %s page with /Resources %j exports, as pdf.js reads it empty (R7-C-2)', async (where, bad) => {
    const src = await shape(({ ctx, p1, p2, form }) => {
      p1.node.set(PDFName.of('Resources'), where === 'kept' ? ctx.obj(bad as never) : ctx.obj({ XObject: { Fm1: form(PUB) } }));
      p2.node.set(PDFName.of('Resources'), where === 'removed' ? ctx.obj(bad as never) : ctx.obj({ XObject: { Fm2: form(SEC) } }));
      p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm1 Do')));
      p2.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm2 Do')));
    });
    const out = latin(await exported(src, [0]));
    expect(out.includes(SEC)).toBe(false);
    if (where === 'removed') expect(out.includes(PUB)).toBe(true);
  });

  it.each(['helvFirst', 'courFirst'] as const)('two kept widgets sharing one appearance keep both /DA fonts (%s, R7-C-3)', async (order) => {
    const src = await shape(({ d, ctx, p1, p2, form }) => {
      const helv = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
      const cour = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Courier' }));
      const apRes = ctx.register(ctx.obj({ Font: { Helv: helv, Cour: cour }, XObject: { Fm2: form(SEC) } }));
      const ap = ctx.register(ctx.stream('/Tx BMC EMC', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 90, 30], Resources: apRes }));
      const w = (name: string, da: string, y: number) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of(name),
        DA: PDFString.of(da), Rect: [10, y, 100, y + 30], P: p1.ref, AP: { N: ap } }));
      const wa = w('a', '/Helv 10 Tf 0 g', 10); const wb = w('b', '/Cour 10 Tf 0 g', 60);
      p1.node.set(PDFName.of('Annots'), ctx.obj(order === 'helvFirst' ? [wa, wb] : [wb, wa]));
      d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [wa, wb] }));
      p1.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm1: form(PUB) } }));
      p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm1 Do')));
      p2.node.set(PDFName.of('Resources'), apRes); p2.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm2 Do')));
    });
    const out = await PDFDocument.load(await exported(src, [0]), { updateMetadata: false });
    const annot = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
    const ap = annot.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as unknown as { dict: PDFDict };
    const fonts = ap.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
    expect(fonts.keys().map(k => k.decodeText()).sort()).toEqual(['Cour', 'Helv']);
    expect(latin(await exported(src, [0])).includes(SEC)).toBe(false);
  });

  it.each([[0, 1], [1, 0]])('a stream that is the single /Contents of two kept pages keeps what EITHER draws (indices %i, %i; R7-C-4)', async (...order) => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const im = ctx.register(ctx.stream('KEPTIMAGEBYTES', { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
    const S = ctx.register(ctx.stream('q 100 0 0 100 0 0 cm /Fx Do Q', { Resources: { XObject: { Im: im } } }));
    const fxA = ctx.register(ctx.stream('/Im Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1] }));
    const fxB = ctx.register(ctx.stream('0 0 1 1 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1] }));
    const [A, B, C] = [0, 1, 2].map(() => d.addPage([300, 300]));
    A.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fx: fxA } })); A.node.set(PDFName.of('Contents'), S);
    B.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fx: fxB } })); B.node.set(PDFName.of('Contents'), S);
    C.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Im: im } })); C.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Im Do')));
    expect(latin(await exported(await reload(d), order)).includes('KEPTIMAGEBYTES')).toBe(true);
  });

  it("a tiling pattern's own /Font, used by a form it draws from the parent, stays (R7-C-5)", async () => {
    const src = await shape(({ ctx, p1, p2, form }) => {
      const f2 = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Courier' }));
      const fm1 = ctx.register(ctx.stream(`BT /F2 12 Tf 20 20 Td (${PUB}) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300] }));
      const pat = ctx.register(ctx.stream('/Fm1 Do', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 300, 300], XStep: 300, YStep: 300,
        Resources: { Font: { F2: f2 } } }));
      p1.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm1: fm1 }, Pattern: { P: pat } }));
      p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Pattern cs /P scn 0 0 300 300 re f')));
      p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F2: f2 }, XObject: { Fm2: form(SEC) } }));
      p2.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('BT /F2 9 Tf (x) Tj ET /Fm2 Do')));
    });
    const out = await PDFDocument.load(await exported(src, [0]), { updateMetadata: false });
    const pat = out.getPage(0).node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Pattern'), PDFDict).lookup(PDFName.of('P')) as unknown as { dict: PDFDict };
    const fonts = pat.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
    expect(fonts.keys().map(k => k.decodeText())).toEqual(['F2']);
  });

  it('a comment inside an inline BDC dictionary is read, not refused (R7-C-6)', async () => {
    const src = await shape(({ ctx, p1, p2, form }) => {
      const S = ctx.register(ctx.obj({ XObject: { Fm1: form(PUB), Fm2: form(SEC) } }));
      p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
      p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Span <</Alt (x) % note >>\n>> BDC /Fm1 Do EMC')));
      p2.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm2 Do')));
    });
    const out = latin(await exported(src, [0]));
    expect(out.includes(PUB)).toBe(true);
    expect(out.includes(SEC)).toBe(false);
  });
});

describe('SEC-1 round 7 — every PDF download prunes (R7-K-6)', () => {
  // Download, Download range, Flatten & download and Sanitize reach the prune only by NOT opting out of it; a source
  // guard pins the two opt-outs that exist — the raster-only assembly (lossy Compress, pixels only) and the sign-rect
  // box (reads a crop box) — so a third, on any PDF download, reds here.
  it('keepSharedResources is set only by the raster-only assembly and the sign-rect box', () => {
    const src = readFileSync('src/export/exportService.ts', 'utf8');
    const sites = [...src.matchAll(/keepSharedResources: ([^ }]+)/g)].map(m => m[1]);
    expect(sites).toEqual(['opts?.rasterOnly', 'true']);
    expect(src).toMatch(/async assembledPageBox[\s\S]{0,800}keepSharedResources: true/);
  });
});
