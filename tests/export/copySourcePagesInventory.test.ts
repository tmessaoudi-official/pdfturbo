/**
 * SEC-1, milestone-1 panel round 6 (2026-10-08): the INVENTORY round. Two tables were built — every place pdf.js
 * resolves a resource name or picks a resources dictionary (Table A), and every PDF key that leads to resources or
 * to something a viewer draws (Table B) — and each row was matched to the code in `copySourcePages.ts`. Every case
 * below is a row that had no match. Page index 1 (or 2) is left out; its content must not reach the export, and a
 * kept page must keep everything pdf.js draws for it. Where order can matter, both orders are pinned.
 */
import { describe, it, expect } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { copySourcePages, resolveStandIns } from '../../src/export/copySourcePages';

const PUB = 'PUBLICKEPTNEEDLE';
const SEC = 'SECRETREMOVEDNEEDLE';

const latin = (b: Uint8Array) => Buffer.from(b).toString('latin1');

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

/** A two-page source; `build` fills it. Page 1 (index 1) is the one left out. */
async function shape(build: (h: {
  d: PDFDocument; ctx: PDFDocument['context']; p1: ReturnType<PDFDocument['addPage']>; p2: ReturnType<PDFDocument['addPage']>;
  form: (t: string, extra?: Record<string, unknown>) => ReturnType<PDFDocument['context']['register']>;
  content: (s: string, extra?: Parameters<PDFDocument['context']['stream']>[1]) => ReturnType<PDFDocument['context']['register']>;
  font: ReturnType<PDFDocument['context']['register']>;
}) => void): Promise<PDFDocument> {
  const d = await PDFDocument.create({ updateMetadata: false });
  const ctx = d.context;
  const p1 = d.addPage([300, 300]); const p2 = d.addPage([300, 300]);
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const form = (t: string, extra: Record<string, unknown> = {}) => ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${t}) Tj ET`,
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], Resources: { Font: { F1: font } }, ...extra }));
  const content = (s: string, extra: Parameters<PDFDocument['context']['stream']>[1] = {}) => ctx.register(ctx.stream(s, extra));
  build({ d, ctx, p1, p2, form, content, font });
  return reload(d);
}

/** Every unmatched leak row, as a two-page document whose page 2 alone draws the secret. */
const LEAKS: Record<string, () => Promise<PDFDocument>> = {
  // Table A row 1: pdf.js merges the page's /Resources with every ancestor's; the removed page draws through the
  // /Pages node's /XObject because its own /Resources has none (R6-C-1).
  ancestorResources: () => shape(({ d, ctx, p1, p2, form, content, font }) => {
    const fm2 = form(SEC, { Resources: {} }); // shares nothing else with the removed page
    (d.catalog.lookup(PDFName.of('Pages')) as PDFDict).set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm2: fm2 } }));
    p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font } }));
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(PUB), Fm2: fm2 } }));
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  }),
  // Table B row 40: a GoTo with a PDF 2.0 structure destination /SD names a structure element, whose /P chain is the
  // whole structure tree — the removed page's marked content (an /MCR /Stm form) and its /ActualText (R6-S-1).
  structDestSD: () => structShape('SD'),
  // The same through a /Dest array whose first element is a structure element (PDF 2.0) instead of a page.
  structDestArray: () => structShape('Dest'),
  // Table B rows 44/45: a field node without /FT holds the inheritable /V above a terminal kid whose widget is only
  // on the removed page; a kept button's ResetForm names the node (R6-S-2).
  ftlessFieldNode: () => shape(({ d, ctx, p1, p2, content, font }) => {
    for (const [p, t] of [[p1, PUB], [p2, 'other']] as const) {
      p.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font } }));
      p.node.set(PDFName.of('Contents'), content(`BT /F1 12 Tf 20 200 Td (${t}) Tj ET`));
    }
    const node = ctx.nextRef(); const kid = ctx.nextRef();
    const w2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 100, 40], Parent: kid, P: p2.ref }));
    ctx.assign(kid, ctx.obj({ FT: 'Tx', T: PDFString.of('last4'), Parent: node, Kids: [w2] }));
    ctx.assign(node, ctx.obj({ T: PDFString.of('ssn'), V: PDFString.of(SEC), Kids: [kid] }));
    const btn = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Btn', Ff: 65536, T: PDFString.of('clear'), Rect: [10, 60, 100, 90], P: p1.ref,
      A: { S: 'ResetForm', Fields: [node] } }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([btn])); p2.node.set(PDFName.of('Annots'), ctx.obj([w2]));
    d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [btn, node] }));
  }),
  // Table B rows 31/33/62/23: keys a viewer never draws for the kept page, shared with the removed one (R6-S-3/4/6/7).
  pieceInfo: () => sharedKeyShape((ctx, secretStream) => ({ page: { PieceInfo: { Illustrator: { Private: { AIPrivateData1: secretStream } } } } })),
  thumb: () => sharedKeyShape((ctx, _s, image) => ({ page: { Thumb: image } })),
  dpart: () => sharedKeyShape((ctx, _s, _i, p2ref) => {
    const root = ctx.nextRef();
    const mine = ctx.register(ctx.obj({ Type: 'DPart', Parent: root, Start: p2ref, DPM: { Recipient: PDFString.of('Alice') } }));
    const theirs = ctx.register(ctx.obj({ Type: 'DPart', Parent: root, Start: p2ref, DPM: { Recipient: PDFString.of(SEC) } }));
    ctx.assign(root, ctx.obj({ Type: 'DPart', DParts: [[mine, theirs]] }));
    return { page: { DPart: mine }, removed: { DPart: theirs } };
  }),
  alternates: () => sharedKeyShape((ctx, _s, image) => ({ image: { Alternates: [{ Image: image }] } })),
  // Table B row 65 (spec-INVALID): a category no viewer reads, in the shared /Resources (R6-S-8).
  unknownCategory: () => shape(({ ctx, p1, p2, form, content, font }) => {
    const S = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(PUB) }, Foo: { Fm2: form(SEC) } }));
    p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  }),
};

function structShape(via: 'SD' | 'Dest'): Promise<PDFDocument> {
  return shape(({ d, ctx, p1, p2, form, content, font }) => {
    const fm2 = form(SEC);
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(PUB) } }));
    p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm2: fm2 } }));
    p1.node.set(PDFName.of('Contents'), content('/P <</MCID 0>> BDC /Fm1 Do EMC'));
    p2.node.set(PDFName.of('Contents'), content('/P <</MCID 0>> BDC /Fm2 Do EMC'));
    const root = ctx.nextRef(); const doc = ctx.nextRef();
    const se1 = ctx.register(ctx.obj({ Type: 'StructElem', S: 'H1', P: doc, Pg: p1.ref, K: 0 }));
    const se2 = ctx.register(ctx.obj({ Type: 'StructElem', S: 'P', P: doc, Pg: p2.ref, ActualText: PDFString.of(SEC + 'AT'),
      K: { Type: 'MCR', Pg: p2.ref, MCID: 0, Stm: fm2 } }));
    ctx.assign(doc, ctx.obj({ Type: 'StructElem', S: 'Document', P: root, K: [se1, se2] }));
    ctx.assign(root, ctx.obj({ Type: 'StructTreeRoot', K: doc }));
    d.catalog.set(PDFName.of('StructTreeRoot'), root);
    d.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
    const action = via === 'SD' ? { A: { S: 'GoTo', D: [p1.ref, PDFName.of('Fit')], SD: [se1, PDFName.of('Fit')] } } : { Dest: [se1, PDFName.of('Fit')] };
    p1.node.set(PDFName.of('Annots'), ctx.obj([ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], ...action })]));
  });
}

/** A key on the kept page (or on its image) whose value is shared with the removed page and carries its secret. */
function sharedKeyShape(keys: (ctx: PDFDocument['context'], secretStream: ReturnType<PDFDocument['context']['register']>,
  image: ReturnType<PDFDocument['context']['register']>, p2ref: ReturnType<PDFDocument['context']['register']>) =>
  { page?: Record<string, unknown>; image?: Record<string, unknown>; removed?: Record<string, unknown> }): Promise<PDFDocument> {
  return shape(({ ctx, p1, p2, form, content, font }) => {
    const secretStream = ctx.register(ctx.stream(`ARTWORK ${SEC}`));
    const image = ctx.register(ctx.stream(`IMG${SEC}`, { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
    const k = keys(ctx, secretStream, image, p2.ref);
    const im1 = ctx.register(ctx.stream(new Uint8Array([7]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8, ...(k.image ?? {}) }));
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(PUB), Im1: im1 } }));
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do q 9 0 0 9 0 0 cm /Im1 Do Q'));
    for (const [key, v] of Object.entries(k.page ?? {})) p1.node.set(PDFName.of(key), ctx.obj(v as never));
    p2.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Img: image } }));
    p2.node.set(PDFName.of('Contents'), content('q 9 0 0 9 0 0 cm /Img Do Q'));
    p2.node.set(PDFName.of('PieceInfo'), ctx.obj({ Illustrator: { Private: { AIPrivateData1: secretStream } } }));
    for (const [key, v] of Object.entries(k.removed ?? {})) p2.node.set(PDFName.of(key), ctx.obj(v as never));
  });
}

describe('SEC-1 round 6 — every unmatched inventory row that carried a left-out page', () => {
  it.each(Object.keys(LEAKS).flatMap(name => (['cut', 'standIn'] as const).map(mode => [name, mode] as const)))('%s (%s)', async (name, mode) => {
    const src = await LEAKS[name]();
    expect(latin(await src.save({ useObjectStreams: false })).includes(SEC), 'control: the source carries it').toBe(true);
    const out = latin(await exported(src, [0], { standIn: mode === 'standIn' ? [1] : undefined }));
    expect(out.includes(SEC), 'the removed page\'s content').toBe(false);
    expect(out.includes(PUB), 'the kept page\'s own content').toBe(true);
  });

  it('a link with /SD still opens its page — only the structure destination goes', async () => {
    const out = await PDFDocument.load(await exported(await structShape('SD'), [0]), { updateMetadata: false });
    const link = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
    const action = link.lookup(PDFName.of('A'), PDFDict);
    expect(action.has(PDFName.of('SD'))).toBe(false);
    expect(action.lookup(PDFName.of('D'), PDFArray).get(0)).toBe(out.getPage(0).ref);
  });

  // The cut is for a left-out page's content: with every page kept the tree carries nothing the export lacks, so a
  // structure destination is copied as before round 6 (the ruling keeps clean exports unchanged).
  it.each(['SD', 'Dest'] as const)('every page kept: a structure destination (%s) is copied, not cut', async (via) => {
    const out = await PDFDocument.load(await exported(await structShape(via), [0, 1]), { updateMetadata: false });
    const link = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
    const dest = via === 'SD' ? link.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('SD'), PDFArray) : link.lookup(PDFName.of('Dest'), PDFArray);
    expect(dest.lookup(0, PDFDict).lookup(PDFName.of('Type'))).toBe(PDFName.of('StructElem'));
  });

  it('a /PieceInfo or /Thumb the kept page does not share is kept (byte-identical to the unpruned copy)', async () => {
    const src = await shape(({ ctx, p1, p2, form, content, font }) => {
      p1.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm1: form(PUB) } }));
      p1.node.set(PDFName.of('Contents'), content('/Fm1 Do'));
      p1.node.set(PDFName.of('PieceInfo'), ctx.obj({ App: { Private: ctx.register(ctx.stream('OWNDATA')) } }));
      p1.node.set(PDFName.of('Thumb'), ctx.register(ctx.stream(new Uint8Array([1]), { Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 })));
      p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm2: form(SEC) } }));
      p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
    });
    const pruned = await exported(src, [0]);
    expect(latin(pruned).includes('OWNDATA')).toBe(true);
    expect(Buffer.from(pruned).equals(Buffer.from(await exported(src, [0], { prune: false })))).toBe(true);
  });
});

describe('SEC-1 round 6 — a kept page keeps everything pdf.js draws for it', () => {
  // Table A row 17 vs rows 5/14: a resource-less form reached first through a tiling pattern (whose own /XObject
  // hides the page's) and then drawn by the page itself must count for the page too (R6-C-2, a round-5 regression).
  it.each(['patternFirst', 'formFirst'] as const)('a form drawn both through a pattern and by the page (%s)', async order => {
    const src = await shape(({ ctx, p1, p2, form, content, font }) => {
      const x1 = form('SHAREDDRAWN');
      const f = ctx.register(ctx.stream('/X1 Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300] }));
      const pat = ctx.register(ctx.stream('/F Do', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 300, 300], XStep: 300, YStep: 300,
        Resources: { Font: { F1: font }, XObject: { F: f, X1: form('PATTERNOWNX1') } } }));
      const res = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { F: f, X1: x1, Fm2: form(SEC) }, Pattern: { P: pat } }));
      p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
      const paint = '/Pattern cs /P scn 0 0 300 300 re f';
      p1.node.set(PDFName.of('Contents'), content(order === 'patternFirst' ? `${paint} /F Do` : `/F Do ${paint}`));
      p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
    });
    const out = latin(await exported(src, [0]));
    expect(out.includes('SHAREDDRAWN'), 'the form the page draws through /F').toBe(true);
    expect(out.includes(SEC)).toBe(false);
  });

  // Table A rows 6/7: an XObject whose /OC is a NAME is resolved in the caller's /Properties (R6-C-3).
  it.each(['form', 'image'] as const)('an %s whose /OC is a name keeps its /Properties entry', async kind => {
    const src = await shape(({ d, ctx, p1, p2, form, content, font }) => {
      const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('L1') }));
      d.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [ocg], D: { Order: [ocg] } }));
      const oc = PDFName.of('oc1');
      const img = ctx.register(ctx.stream(new Uint8Array([0]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8, OC: oc }));
      const res = ctx.register(ctx.obj({ Font: { F1: font }, Properties: { oc1: ocg }, XObject: { Fm1: form(PUB, kind === 'form' ? { OC: oc } : {}), Im1: img, Fm2: form(SEC) } }));
      p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
      p1.node.set(PDFName.of('Contents'), content(kind === 'image' ? '/Fm1 Do q 9 0 0 9 0 0 cm /Im1 Do Q' : '/Fm1 Do'));
      p2.node.set(PDFName.of('Contents'), content('/Fm2 Do /Fm1 Do /Im1 Do'));
    });
    const out = await PDFDocument.load(await exported(src, [0]), { updateMetadata: false });
    const props = out.getPage(0).node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Properties'), PDFDict);
    expect(props.has(PDFName.of('oc1'))).toBe(true);
  });

  // Table A row 26: a regenerated widget appearance resolves its /DA font in the merge of /DR and the appearance's
  // own /Resources — the only place the font lives once the AcroForm is not copied (R6-C-4). Indirect and inline
  // widget, and one appearance shared by the kept and the removed page's widgets.
  it.each(['indirect', 'inline', 'sharedAppearance'] as const)('a widget\'s appearance keeps the font its /DA names (%s)', async kind => {
    const src = await shape(({ d, ctx, p1, p2, form, content }) => {
      const courier = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Courier' }));
      const apRes = ctx.register(ctx.obj({ Font: { Helv: courier }, XObject: { Fm2: form(SEC) } }));
      const ap = () => ctx.register(ctx.stream('/Tx BMC EMC', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 90, 30], Resources: apRes }));
      const ap1 = ap(); const ap2 = kind === 'sharedAppearance' ? ap1 : ap();
      const widget = (p: typeof p1, n: ReturnType<typeof ap>) => ({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of(`f${p === p1 ? 1 : 2}`),
        DA: PDFString.of('/Helv 10 Tf 0 g'), Rect: [10, 10, 100, 40], P: p.ref, AP: { N: n } });
      const w2 = ctx.register(ctx.obj(widget(p2, ap2)));
      const w1 = kind === 'inline' ? ctx.obj(widget(p1, ap1)) : ctx.register(ctx.obj(widget(p1, ap1)));
      d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: kind === 'inline' ? [w2] : [w1, w2], DR: { Font: { Helv: courier } } }));
      p1.node.set(PDFName.of('Annots'), ctx.obj([w1])); p2.node.set(PDFName.of('Annots'), ctx.obj([w2]));
      p1.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm1: form(PUB) } }));
      p2.node.set(PDFName.of('Resources'), apRes);
      p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
    });
    const out = await PDFDocument.load(await exported(src, [0]), { updateMetadata: false });
    const widget = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
    const apStream = widget.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as unknown as { dict: PDFDict };
    const fonts = apStream.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
    expect(fonts.has(PDFName.of('Helv')), 'the /DA font').toBe(true);
    expect(latin(await out.save({ useObjectStreams: false })).includes(SEC)).toBe(false);
  });

  // An array /Contents member's own /Resources draws nothing — unless the same stream is also a form a kept page
  // draws, or another kept page's single /Contents. Both orders (R6-K-1, a round-5 regression).
  for (const role of ['form', 'single'] as const) {
    it.each(['arrayFirst', 'otherFirst'] as const)(`a stream that is an array member AND a ${role === 'form' ? 'drawn form' : 'single /Contents'} keeps what it draws (%s)`, async order => {
      const d = await PDFDocument.create({ updateMetadata: false });
      const font = await d.embedFont(StandardFonts.Helvetica);
      const ctx = d.context;
      const fx = (body: string) => ctx.register(ctx.stream(body, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300] }));
      const SH = ctx.register(ctx.obj({ Font: { F1: font.ref }, XObject: { FmK: fx('BT /F1 12 Tf 20 20 Td (KEPTDRAWN) Tj ET'), Fm2: fx(`BT /F1 12 Tf (${SEC}) Tj ET`) } }));
      const S = ctx.register(ctx.stream('/FmK Do', { ...(role === 'form' ? { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300] } : {}), Resources: SH }));
      const pages = [0, 1, 2].map(() => d.addPage([300, 300]));
      const [arr, other] = order === 'arrayFirst' ? [pages[0], pages[1]] : [pages[1], pages[0]];
      arr.node.set(PDFName.of('Resources'), ctx.obj({})); arr.node.set(PDFName.of('Contents'), ctx.obj([S]));
      if (role === 'form') {
        other.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fs: S } }));
        other.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fs Do')));
      } else {
        other.node.set(PDFName.of('Resources'), ctx.obj({})); other.node.set(PDFName.of('Contents'), S);
      }
      pages[2].node.set(PDFName.of('Resources'), SH); pages[2].node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm2 Do')));
      const out = latin(await exported(await reload(d), [0, 1]));
      expect(out.includes('KEPTDRAWN'), 'what the kept page draws through the stream').toBe(true);
      expect(out.includes(SEC)).toBe(false);
    });
  }

  // The completeness lens's net (round 6): every owner kind, nested deep, shared with nothing the removed page
  // reaches — the prune must change nothing at all, byte for byte.
  it.each([false, true])('deep but unshared: the pruned copy is byte-identical to the unpruned one (control shares one form: %s)', async control => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const fa = await d.embedFont(StandardFonts.Helvetica);
    const fb = await d.embedFont(StandardFonts.Courier);
    const ctx = d.context;
    const fx = (body: string, extra: Record<string, unknown> = {}) => ctx.register(ctx.stream(body, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], ...extra }));
    const fmC = fx('BT /F1 12 Tf 20 20 Td (DEEPC) Tj ET', { Resources: { Font: { F1: fa.ref } } });
    const fmB = fx('/FmC Do', { Resources: ctx.register(ctx.obj({ XObject: { FmC: fmC } })) });
    const fmA = fx('/FmB Do', { Resources: { XObject: { FmB: fmB } }, PieceInfo: { X: { Private: { Type: 'Font', Subtype: 'Type3', Resources: ctx.register(ctx.obj({ XObject: { G: fmC } })) } } } });
    const R3 = ctx.register(ctx.obj({ XObject: { G: fx('0 0 9 9 re f % GLYPH') } }));
    const t3 = { Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1, 1], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: ctx.register(ctx.stream('1000 0 d0 /G Do')) },
      Encoding: { Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1000], Resources: R3 };
    const pat = ctx.register(ctx.stream('/FmB Do', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 300, 300], XStep: 300, YStep: 300, Resources: { XObject: { FmB: fmB } } }));
    const gs = ctx.register(ctx.obj({ Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: fx('/FmA Do', { Group: { S: 'Transparency' }, Resources: { XObject: { FmA: fmA } } }) } }));
    const own = ctx.register(ctx.obj({ XObject: { FmA: fmA, Unused: fx('(UNUSED) Tj') }, Font: { F1: fa.ref, T3: t3 }, Pattern: { P: pat }, ExtGState: { G1: gs } }));
    const p0 = d.addPage([300, 300]); const p1 = d.addPage([300, 300]);
    p0.node.set(PDFName.of('Resources'), own);
    p0.node.set(PDFName.of('Contents'), ctx.obj([ctx.register(ctx.stream('/G1 gs /FmA Do', { Resources: { XObject: { FmA: fmA } } })),
      ctx.register(ctx.stream('/Pattern cs /P scn 0 0 9 9 re f BT /T3 9 Tf (a) Tj ET'))]));
    p0.node.set(PDFName.of('Annots'), ctx.obj([ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('w'), Rect: [1, 1, 50, 20], DR: own, DA: PDFString.of('/F1 0 Tf 0 g') })]));
    p0.node.set(PDFName.of('PieceInfo'), ctx.obj({ Y: { Private: { Type: 'Font', Subtype: 'Type3', Resources: own } } }));
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: fb.ref }, XObject: { Fm2: fx(`BT /F1 12 Tf (${SEC}) Tj ET`), ...(control ? { U: fmC } : {}) } }));
    p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm2 Do')));
    const src = await reload(d);
    const pruned = await exported(src, [0]);
    expect(latin(pruned).includes(SEC)).toBe(false);
    expect(latin(pruned).includes('DEEPC')).toBe(true);
    expect(Buffer.from(pruned).equals(Buffer.from(await exported(src, [0], { prune: false }))), 'byte-identical').toBe(!control);
  });
});
