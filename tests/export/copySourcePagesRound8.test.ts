/**
 * SEC-1, milestone-1 panel round 8 (2026-10-08). Fixed by CLASS (developer ruling "fix round 8, then ship"): a value
 * that is not the dictionary the prune expects is refused or dropped, never copied whole; a DIRECT dictionary a removed
 * page draws from — an inherited `/Pages` `/Resources` — is the removed page's like a shared one; the prune reads only
 * when a read can decide something, and reads what pdf.js reads; every kept page is read before any page is copied;
 * and the class-1 cuts close the shapes their tests missed. Page index 1 is left out unless a case says otherwise.
 */
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import { copySourcePages, resolveStandIns } from '../../src/export/copySourcePages';

const PUB = 'PUBLICKEPTNEEDLE';
const SEC = 'SECRETREMOVEDNEEDLE';

const latin = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const txt = (t: string) => `BT /F1 12 Tf 20 200 Td (${t}) Tj ET`;
type Mode = 'cut' | 'standIn' | 'noPrune';

async function exported(src: PDFDocument, keep: number[], mode: Mode = 'cut'): Promise<Uint8Array> {
  const dest = await PDFDocument.create({ updateMetadata: false });
  const left = [...Array(src.getPageCount()).keys()].filter(i => !keep.includes(i));
  const { pages, standIns } = await copySourcePages(dest, src, keep, {
    ...(mode === 'noPrune' ? {} : { pruneSharedResources: true }), ...(mode === 'standIn' ? { standIns: left } : {}),
  });
  pages.forEach(p => dest.addPage(p));
  if (standIns.size) await resolveStandIns(dest, new Map([...standIns.values()].map(r => [r, undefined])));
  return dest.save({ useObjectStreams: false });
}

const reload = async (d: PDFDocument) => PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });

type Ctx = PDFDocument['context'];
type Ref = ReturnType<Ctx['register']>;
type Helpers = {
  d: PDFDocument; ctx: Ctx; p1: ReturnType<PDFDocument['addPage']>; p2: ReturnType<PDFDocument['addPage']>;
  form: (t: string, extra?: Record<string, unknown>) => Ref; content: (s: string, extra?: Parameters<Ctx['stream']>[1]) => Ref; font: Ref;
};
async function shape(build: (h: Helpers) => void): Promise<PDFDocument> {
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

/** Two pages showing text only; `extra` adds the shape. */
const plain = (extra: (h: Helpers) => void) => shape(h => {
  const { ctx, p1, p2, content, font } = h;
  for (const [p, t] of [[p1, PUB], [p2, 'other']] as const) {
    p.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font } }));
    p.node.set(PDFName.of('Contents'), content(txt(t)));
  }
  extra(h);
});

/** A DIRECT /Resources on the /Pages node, inherited by both pages — neither has its own (R8-S-1). */
const ancestor = (kind: 'propsDirect' | 'unknownDirect' | 't3PieceInfo') => shape(({ d, ctx, p1, p2, form, content, font }) => {
  const glyph = ctx.register(ctx.stream('0 0 0 0 0 0 d1 0 0 1 1 re f'));
  const t3 = { Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1, 1], FontMatrix: [1, 0, 0, 1, 0, 0], FirstChar: 97, LastChar: 97, Widths: [1],
    Encoding: { Differences: [97, 'a'] }, CharProcs: { a: glyph }, Resources: {}, PieceInfo: { App: { Private: PDFString.of(SEC) } } };
  const res: Record<string, unknown> = { Font: { F1: font, ...(kind === 't3PieceInfo' ? { T3: t3 } : {}) }, XObject: { Fm1: form(PUB), Fm2: form('r') } };
  if (kind === 'propsDirect') res.Properties = { MC1: { ActualText: PDFString.of('k') }, MC2: { ActualText: PDFString.of(SEC) } };
  if (kind === 'unknownDirect') res.MyCat = { X: PDFString.of(SEC) };
  p1.node.delete(PDFName.of('Resources')); p2.node.delete(PDFName.of('Resources'));
  ctx.lookup(d.catalog.get(PDFName.of('Pages')), PDFDict).set(PDFName.of('Resources'), ctx.obj(res as never));
  p1.node.set(PDFName.of('Contents'), content(kind === 't3PieceInfo' ? '/Span /MC1 BDC /Fm1 Do EMC BT /T3 12 Tf (a) Tj ET' : '/Span /MC1 BDC /Fm1 Do EMC'));
  p2.node.set(PDFName.of('Contents'), content('/Span /MC2 BDC /Fm2 Do EMC'));
});

/** A structure element written DIRECTLY as the first element of a kept link's /SD or /Dest (R8-S-4). */
const inlineElement = (via: 'SD' | 'Dest') => shape(({ d, ctx, p1, p2, form, content, font }) => {
  const fm2 = form(SEC);
  p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(PUB) } }));
  p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm2: fm2 } }));
  p1.node.set(PDFName.of('Contents'), content('/H1 <</MCID 0>> BDC /Fm1 Do EMC'));
  p2.node.set(PDFName.of('Contents'), content('/P <</MCID 0>> BDC /Fm2 Do EMC'));
  const root = ctx.nextRef(); const doc = ctx.nextRef();
  const se1 = ctx.register(ctx.obj({ Type: 'StructElem', S: 'H1', P: doc, Pg: p1.ref, K: 0 }));
  const inline = ctx.obj({ Type: 'StructElem', S: 'P', P: doc, Pg: p2.ref, ActualText: PDFString.of(SEC + 'AT'), K: { Type: 'MCR', Pg: p2.ref, MCID: 0, Stm: fm2 } });
  ctx.assign(doc, ctx.obj({ Type: 'StructElem', S: 'Document', P: root, K: [se1] }));
  ctx.assign(root, ctx.obj({ Type: 'StructTreeRoot', K: [doc] }));
  d.catalog.set(PDFName.of('StructTreeRoot'), root);
  const action = via === 'SD' ? { A: { S: 'GoTo', D: [p1.ref, PDFName.of('Fit')], SD: [inline, PDFName.of('Fit')] } } : { Dest: [inline, PDFName.of('Fit')] };
  p1.node.set(PDFName.of('Annots'), ctx.obj([ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], ...action })]));
});

/** Class 1 shapes: the cuts are not the prune's, so each runs with the prune off too. */
const CUTS: Record<string, () => Promise<PDFDocument>> = {
  // /RV, the inheritable rich-text value, on a kept chain parent only the removed kid inherits (R8-S-2).
  'chain parent /RV': () => plain(({ d, ctx, p1, p2 }) => {
    const P = ctx.nextRef();
    const f1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', Ff: 33554432, T: PDFString.of('a'), V: PDFString.of('mine'), RV: PDFString.of('<p>mine</p>'),
      Parent: P, Rect: [10, 10, 100, 40], P: p1.ref }));
    const f2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', T: PDFString.of('b'), Parent: P, Rect: [10, 10, 100, 40], P: p2.ref }));
    ctx.assign(P, ctx.obj({ T: PDFString.of('grp'), FT: 'Tx', Ff: 33554432, V: PDFString.of('x'), RV: PDFString.of(`<p>${SEC}</p>`), Kids: [f1, f2] }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([f1])); p2.node.set(PDFName.of('Annots'), ctx.obj([f2]));
    d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [P] }));
  }),
  // A node holding /V with NO /Kids: only its kid's /Parent names it, and a kept /ResetForm reaches it (R8-S-3).
  'field node only a /Parent names': () => plain(({ d, ctx, p1, p2 }) => {
    const node = ctx.nextRef();
    const w2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('last4'), Parent: node, Rect: [10, 10, 100, 40], P: p2.ref }));
    ctx.assign(node, ctx.obj({ T: PDFString.of('ssn'), V: PDFString.of(SEC) }));
    const btn = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Btn', Ff: 65536, T: PDFString.of('clear'), Rect: [10, 60, 100, 90], P: p1.ref,
      A: { S: 'ResetForm', Fields: [node] } }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([btn])); p2.node.set(PDFName.of('Annots'), ctx.obj([w2]));
    d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [btn, w2] }));
  }),
  // A structure element written inline where a reference belongs (R8-S-4).
  'inline structure element in /SD': () => inlineElement('SD'),
  'inline structure element in /Dest': () => inlineElement('Dest'),
  // A kept chain field whose /Kids holds the removed page's widget inline (R8-S-5).
  'inline kid in a chain /Kids': () => plain(({ d, ctx, p1, p2 }) => {
    const P = ctx.nextRef();
    const f1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', T: PDFString.of('a'), Parent: P, Rect: [10, 10, 100, 40], P: p1.ref }));
    ctx.assign(P, ctx.obj({ T: PDFString.of('grp'), FT: 'Tx',
      Kids: [f1, ctx.obj({ Type: 'Annot', Subtype: 'Widget', T: PDFString.of('b'), V: PDFString.of(SEC), Parent: P, Rect: [10, 10, 100, 40], P: p2.ref })] }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([f1]));
    d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [P] }));
  }),
  // An annotation whose /P is a page dictionary outside the tree, reached by a kept reply's /IRT (R8-S-7).
  'orphan page note via /IRT': () => plain(({ ctx, p1 }) => {
    const orphan = ctx.nextRef();
    const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of(SEC), P: orphan }));
    ctx.assign(orphan, ctx.obj({ Type: 'Page', MediaBox: [0, 0, 300, 300], Annots: [note] }));
    const reply = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('re'), IRT: note, P: p1.ref }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([reply]));
  }),
  // A removed page's note, on no /Annots and without its required /Subtype (R8-S-8).
  'unlisted note without /Subtype': () => plain(({ ctx, p1, p2 }) => {
    const note = ctx.register(ctx.obj({ Type: 'Annot', Rect: [10, 10, 30, 30], Contents: PDFString.of(SEC), P: p2.ref }));
    const reply = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('re'), IRT: note, P: p1.ref }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([reply]));
  }),
};

/** Class 2 shapes and dropped non-dictionaries: the prune's. */
const PRUNES: Record<string, () => Promise<PDFDocument>> = {
  'inherited direct /Resources: a property list': () => ancestor('propsDirect'),
  'inherited direct /Resources: an unknown category': () => ancestor('unknownDirect'),
  'inherited direct /Resources: a drawn Type3 font\'s /PieceInfo': () => ancestor('t3PieceInfo'),
  // A pruned category whose value is an array: pdf.js resolves no name through it, so nothing draws it (R8-S-11).
  'shared category written as an array': () => shape(({ ctx, p1, p2, form, content, font }) => {
    const fm2 = form(SEC);
    const R = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(PUB) }, Shading: [fm2] }));
    p1.node.set(PDFName.of('Resources'), R);
    p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm2: fm2 }, Shading: ctx.lookup(R, PDFDict).get(PDFName.of('Shading')) }));
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  }),
};

describe('SEC-1 round 8 — the leak classes', () => {
  it.each(Object.keys(CUTS).flatMap(name => (['cut', 'standIn', 'noPrune'] as const).map(mode => [name, mode] as const)))('%s (%s)', async (name, mode) => {
    const src = await CUTS[name]();
    expect(latin(await src.save({ useObjectStreams: false })).includes(SEC), 'control: the source carries it').toBe(true);
    const out = latin(await exported(src, [0], mode));
    expect(out.includes(SEC), "the removed page's content").toBe(false);
    expect(out.includes(PUB), "the kept page's own content").toBe(true);
  });

  it.each(Object.keys(PRUNES).flatMap(name => (['cut', 'standIn'] as const).map(mode => [name, mode] as const)))('%s (%s)', async (name, mode) => {
    const src = await PRUNES[name]();
    expect(latin(await src.save({ useObjectStreams: false })).includes(SEC), 'control: the source carries it').toBe(true);
    const out = latin(await exported(src, [0], mode));
    expect(out.includes(SEC), "the removed page's content").toBe(false);
    expect(out.includes(PUB), "the kept page's own content").toBe(true);
  });
});

/** A shared /Resources R the kept page reaches through a value that is not a dictionary (R8-S-9, R8-S-10). */
const notADict = (kind: 'pageArray' | 'pageStream' | 'formArray' | 'pageNumber' | 'pageDict' | 'formDict') => shape(({ ctx, p1, p2, form, content, font }) => {
  const fm2 = form(SEC);
  const R = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(PUB), Fm2: fm2 } }));
  p2.node.set(PDFName.of('Resources'), R);
  p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  const own = `/Fm1 Do BT /F1 9 Tf (${PUB}) Tj ET`;
  if (kind === 'pageArray') p1.node.set(PDFName.of('Resources'), ctx.obj([R]));
  if (kind === 'pageNumber') p1.node.set(PDFName.of('Resources'), ctx.obj(5));
  if (kind === 'pageDict') p1.node.set(PDFName.of('Resources'), R);
  if (kind === 'pageStream') p1.node.set(PDFName.of('Resources'), ctx.register(ctx.stream('', { Font: { F1: font }, XObject: { Fm1: form(PUB), Fm2: fm2 } })));
  if (kind.startsWith('page')) p1.node.set(PDFName.of('Contents'), content(own));
  if (kind === 'formArray' || kind === 'formDict') {
    const wrap = ctx.register(ctx.stream('/Fm1 Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], Resources: kind === 'formArray' ? ctx.obj([R]) : R }));
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { W: wrap } }));
    p1.node.set(PDFName.of('Contents'), content(`/W Do BT /F1 9 Tf (${PUB}) Tj ET`));
  }
});

describe('SEC-1 round 8 — a value that is not a dictionary is refused, never copied whole', () => {
  it.each(['pageArray', 'pageStream', 'formArray'] as const)('a %s /Resources reaching the removed page\'s dictionary refuses (R8-S-9/10)', async (kind) => {
    const src = await notADict(kind);
    for (const mode of ['cut', 'standIn'] as const) {
      await expect(exported(src, [0], mode), mode).rejects.toMatchObject({ name: 'ExportResourcesUnreadableError' });
    }
  });

  it("a field's /DR written as an array holding the removed page's dictionary refuses", async () => {
    const src = await shape(({ d, ctx, p1, p2, form, content, font }) => {
      const R = ctx.register(ctx.obj({ Font: { Helv: font }, XObject: { Fm2: form(SEC) } }));
      p2.node.set(PDFName.of('Resources'), R); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
      p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font } })); p1.node.set(PDFName.of('Contents'), content(txt(PUB)));
      const w1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('a'), DA: PDFString.of('/Helv 10 Tf 0 g'),
        DR: [R], Rect: [10, 10, 100, 40], P: p1.ref }));
      p1.node.set(PDFName.of('Annots'), ctx.obj([w1]));
      d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [w1] }));
    });
    await expect(exported(src, [0])).rejects.toMatchObject({ name: 'ExportResourcesUnreadableError' });
  });

  it.each(['pageNumber', 'pageDict', 'formDict'] as const)('control: a %s /Resources exports without the removed page', async (kind) => {
    const out = latin(await exported(await notADict(kind), [0]));
    expect(out.includes(SEC)).toBe(false);
    expect(out.includes(PUB)).toBe(true);
  });
});

describe('SEC-1 round 8 — the cuts keep what the kept pages show', () => {
  it.each(['cut', 'noPrune'] as const)('a kept link written directly in a structure /K stays on its page (%s, R8-C-3)', async (mode) => {
    const src = await shape(({ d, ctx, p1, p2, form, content }) => {
      p1.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm1: form(PUB) } }));
      p1.node.set(PDFName.of('Contents'), content('/Fm1 Do'));
      p2.node.set(PDFName.of('Contents'), content('0 0 9 9 re f'));
      const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 60, 30], A: { S: 'URI', URI: PDFString.of('https://example.com/kept') }, P: p1.ref, StructParent: 0 }));
      p1.node.set(PDFName.of('Annots'), ctx.obj([link]));
      const root = ctx.nextRef();
      const elem = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Link', P: root, K: [link] }));
      ctx.assign(root, ctx.obj({ Type: 'StructTreeRoot', K: [elem] }));
      d.catalog.set(PDFName.of('StructTreeRoot'), root);
    });
    const bytes = await exported(src, [0], mode);
    const annots = (await PDFDocument.load(bytes, { updateMetadata: false })).getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    expect(annots.lookup(0, PDFDict).lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Link'));
    expect(latin(bytes).includes('example.com/kept')).toBe(true);
  });

  it('an unlisted note whose /P is the KEPT page stays when a kept reply names it', async () => {
    const src = await plain(({ ctx, p1 }) => {
      const note = ctx.register(ctx.obj({ Type: 'Annot', Rect: [10, 10, 30, 30], Contents: PDFString.of('KEPTNOTE'), P: p1.ref }));
      p1.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], IRT: note, P: p1.ref }))]));
    });
    expect(latin(await exported(src, [0])).includes('KEPTNOTE')).toBe(true);
  });

  it('control: a structure element given by REFERENCE in /SD is still cut, with every page kept nothing is', async () => {
    const src = await inlineElement('SD');
    expect(latin(await exported(src, [0, 1])).includes(SEC + 'AT')).toBe(true);
  });
});

describe('SEC-1 round 8 — the prune reads only what decides, and what pdf.js reads', () => {
  const pngNone = (text: string, cols: number) => {
    const bytes = Buffer.from(text, 'latin1'); const out: number[] = [];
    for (let i = 0; i < bytes.length; i += cols) { out.push(0); for (let k = 0; k < cols; k++) out.push(bytes[i + k] ?? 0x20); }
    return new Uint8Array(deflateSync(Buffer.from(out)));
  };

  it('a reached /Resources holding nothing prunable is not read, so a predicted kept page exports (R8-C-4)', async () => {
    const src = await shape(({ ctx, p1, p2, content }) => {
      const S = ctx.register(ctx.obj({ ProcSet: [PDFName.of('PDF')], ColorSpace: { CS0: PDFName.of('DeviceRGB') } }));
      p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
      p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(pngNone('0 0 1 rg 10 10 100 100 re f\n', 4), { Filter: 'FlateDecode', DecodeParms: { Predictor: 10, Columns: 4 } })));
      p2.node.set(PDFName.of('Contents'), content('1 0 0 rg 0 0 9 9 re f'));
    });
    await expect(exported(src, [0])).resolves.toBeInstanceOf(Uint8Array);
  });

  it.each(['DP', 'F'] as const)('a content stream with the /%s alias pdf.js reads refuses (R8-C-1)', async (alias) => {
    const src = await shape(({ ctx, p1, p2, form }) => {
      const S = ctx.register(ctx.obj({ XObject: { Fm1: form(PUB), Fm2: form(SEC) } }));
      p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
      p1.node.set(PDFName.of('Contents'), alias === 'DP'
        ? ctx.register(ctx.stream(pngNone('/Fm1 Do\n', 2), { Filter: 'FlateDecode', DP: { Predictor: 10, Columns: 2 } }))
        : ctx.register(ctx.stream(new Uint8Array(deflateSync(Buffer.from('q /Fm1 Do Q\n'))), { F: 'FlateDecode' })));
      p2.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm2 Do')));
    });
    await expect(exported(src, [0])).rejects.toMatchObject({ name: 'ExportResourcesUnreadableError' });
    expect(latin(await exported(src, [0], 'noPrune')).includes(PUB), 'control: the unpruned copy keeps it').toBe(true);
  });

  it.each([[0, 1], [1, 0]])('a tiling pattern two kept pages draw keeps what EITHER page draws through it (indices %i, %i; R8-C-2)', async (...order) => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const ps = [0, 1, 2].map(() => d.addPage([300, 300]));
    const fa = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Courier' }));
    const fb = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Times-Roman' }));
    const pat = ctx.register(ctx.stream('/Fm Do', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 300, 300], XStep: 300, YStep: 300,
      Resources: { Font: { FA: fa, FB: fb } } }));
    const fm = (f: string) => ctx.register(ctx.stream(`BT /${f} 12 Tf 20 100 Td (x) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300] }));
    ps[0].node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm: fm('FA') }, Pattern: { P: pat } }));
    ps[1].node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm: fm('FB') }, Pattern: { P: pat } }));
    for (const p of [ps[0], ps[1]]) p.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Pattern cs /P scn 0 0 300 300 re f')));
    ps[2].node.set(PDFName.of('Resources'), ctx.obj({ Font: { FA: fa, FB: fb } }));
    ps[2].node.set(PDFName.of('Contents'), ctx.register(ctx.stream('BT /FA 9 Tf (a) Tj /FB 9 Tf (b) Tj ET')));
    const out = await PDFDocument.load(await exported(await reload(d), order), { updateMetadata: false });
    const p = out.getPage(0).node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Pattern'), PDFDict).lookup(PDFName.of('P')) as unknown as { dict: PDFDict };
    const fonts = p.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
    expect(fonts.keys().map(k => k.decodeText()).sort()).toEqual(['FA', 'FB']);
  });
});

describe('SEC-1 round 8 — every PDF download prunes (R8-K-4)', () => {
  // The raster-only opt-out has two spellings: the assembly's own flag, and the caller's `rasterOnly: true`. Each may
  // appear at its one site only — lossy Compress, whose bytes are only ever rendered to pixels.
  it('rasterOnly: true is passed only by lossy Compress', () => {
    const src = readFileSync('src/export/exportService.ts', 'utf8');
    expect([...src.matchAll(/rasterOnly: true/g)].length).toBe(1);
    expect(src).toMatch(/assemblePdfBytes\(opts\.mode === 'lossy' \? \{ rasterOnly: true \} : undefined\)/);
    expect([...src.matchAll(/assemblePdfBytes\(([^)]*)\)/g)].map(m => m[1]).filter(a => a && !a.startsWith("opts.mode === 'lossy'") && !a.startsWith('opts?'))).toEqual([]);
  });
});
