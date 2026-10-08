/**
 * SEC-1 (review 2026-10-07, P0) — a page that is NOT copied must never ride into the export on a reference.
 *
 * pdf-lib's `PDFObjectCopier` deep-copies everything a copied page reaches. Before this fix, a kept page that
 * referenced an excluded page — a GoTo link, a form field whose widgets span pages, a chain of links — carried that
 * page whole into the file: absent from `/Pages`, so no viewer showed it, but its text was in the bytes. And because
 * the copier memoises a page on its CLONE, a link to a page that WAS kept landed on a second, orphan copy of it, so
 * pdf.js sent every internal link to page 1, and an annotation's `/P` duplicated its own page.
 *
 * Ruling (developer, 2026-10-08): links land on the real export page; a link to a REDACTED page goes to its image
 * page (a stand-in resolved by `resolveStandIns`); a link to a deleted or out-of-range page is removed; a multi-page
 * form field keeps only the widgets of exported pages; nothing from an excluded page is copied.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFObjectCopier, PDFPage, PDFRawStream, PDFRef, PDFString,
  StandardFonts, decodePDFRawStream,
} from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { copySourcePages, resolveStandIns } from '../../src/export/copySourcePages';
import { ExportService, type IExportContext } from '../../src/export/exportService';

const SECRET = (i: number) => `TOPSECRETNEEDLE${i}X`;

type Link = { from: number; to: number; via?: 'dest' | 'goto' };

/** `n` pages, page i drawing SECRET(i); optional links and one field whose widgets sit on `fieldOn` pages. */
async function source(n: number, links: Link[] = [], fieldOn: number[] = [], selfP = false): Promise<PDFDocument> {
  const d = await PDFDocument.create({ updateMetadata: false });
  const font = await d.embedFont(StandardFonts.Helvetica);
  const pages = Array.from({ length: n }, (_, i) => {
    const p = d.addPage([300, 300]);
    p.drawText(SECRET(i), { x: 20, y: 200, font, size: 12 });
    return p;
  });
  const annots = pages.map(() => [] as PDFRef[]);
  for (const { from, to, via = 'dest' } of links) {
    const target = [pages[to].ref, PDFName.of('Fit')];
    const dict = via === 'dest'
      ? { Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 40], Dest: target }
      : { Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 40], A: { S: 'GoTo', D: target } };
    annots[from].push(d.context.register(d.context.obj(dict)));
  }
  if (fieldOn.length) {
    const fieldRef = d.context.nextRef();
    const kids = fieldOn.map(i => {
      const w = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 60, 100, 90], Parent: fieldRef, P: pages[i].ref }));
      annots[i].push(w);
      return w;
    });
    d.context.assign(fieldRef, d.context.obj({ FT: 'Tx', T: PDFString.of('name'), Kids: kids }));
  }
  if (selfP) {
    annots[0].push(d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('note'), P: pages[0].ref })));
  }
  pages.forEach((p, i) => { if (annots[i].length) p.node.set(PDFName.of('Annots'), d.context.obj(annots[i])); });
  return PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
}

/** Which page secrets are in the file's decoded streams — whatever /Pages says. */
function secretsIn(doc: PDFDocument, n: number): number[] {
  const found = new Set<number>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let text: string;
    try { text = Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1'); } catch { text = Buffer.from(obj.contents).toString('latin1'); }
    const upper = text.toUpperCase();
    for (let i = 0; i < n; i++) {
      const hex = Buffer.from(SECRET(i), 'latin1').toString('hex').toUpperCase();
      if (text.includes(SECRET(i)) || upper.includes(hex)) found.add(i);
    }
  }
  return [...found].sort();
}

function pageDictCount(doc: PDFDocument): number {
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Page')) n++;
  }
  return n;
}

async function copyAndSave(src: PDFDocument, keep: number[]): Promise<PDFDocument> {
  const dest = await PDFDocument.create({ updateMetadata: false });
  const { pages } = await copySourcePages(dest, src, keep);
  pages.forEach(p => dest.addPage(p));
  return PDFDocument.load(await dest.save({ useObjectStreams: false }), { updateMetadata: false });
}

function linksOf(page: PDFPage): PDFDict[] {
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return [];
  return annots.asArray().map(r => page.doc.context.lookup(r)).filter((a): a is PDFDict =>
    a instanceof PDFDict && a.get(PDFName.of('Subtype')) === PDFName.of('Link'));
}

/** The 0-based index pdf.js resolves page `pageNo`'s first link to — what a click in the viewer does. */
async function pdfjsLinkTarget(bytes: Uint8Array, pageNo = 1): Promise<number | null> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0), verbosity: 0 }).promise;
  try {
    const link = (await (await doc.getPage(pageNo)).getAnnotations()).find(a => a.subtype === 'Link');
    if (!link) return null;
    return await doc.getPageIndex(link.dest[0]);
  } finally {
    await doc.loadingTask.destroy();
  }
}

describe('copySourcePages — an excluded page never rides in on a reference (SEC-1)', () => {
  it('control: the scan sees every page secret in the source', async () => {
    expect(secretsIn(await source(3), 3)).toEqual([0, 1, 2]);
  });

  it('a GoTo /Dest link to an excluded page: the page is not in the file and the link is removed', async () => {
    const out = await copyAndSave(await source(2, [{ from: 0, to: 1 }]), [0]);
    expect(secretsIn(out, 2)).toEqual([0]);
    expect(linksOf(out.getPage(0))).toHaveLength(0);
  });

  it('an /A /GoTo action to an excluded page: same', async () => {
    const out = await copyAndSave(await source(2, [{ from: 0, to: 1, via: 'goto' }]), [0]);
    expect(secretsIn(out, 2)).toEqual([0]);
    expect(linksOf(out.getPage(0))).toHaveLength(0);
  });

  it('a form field with widgets on both pages keeps only the exported page\'s widget', async () => {
    const out = await copyAndSave(await source(2, [], [0, 1]), [0]);
    expect(secretsIn(out, 2)).toEqual([0]);
    const annots = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const widget = out.context.lookup(annots.get(0), PDFDict);
    const kids = widget.lookup(PDFName.of('Parent'), PDFDict).lookup(PDFName.of('Kids'), PDFArray);
    expect(kids.size()).toBe(1);
    expect(kids.get(0)).toBe(annots.get(0));
  });

  it('a chain of links through excluded pages carries none of them', async () => {
    const out = await copyAndSave(await source(3, [{ from: 0, to: 1 }, { from: 1, to: 2 }]), [0]);
    expect(secretsIn(out, 3)).toEqual([0]);
    expect(pageDictCount(out)).toBe(1);
  });
});

describe('copySourcePages — links between copied pages land on the visible page', () => {
  it('a link to a kept page resolves to that page in pdf.js (it went to page 1)', async () => {
    const src = await source(3, [{ from: 0, to: 2 }]);
    const srcBytes = await src.save({ useObjectStreams: false });
    expect(await pdfjsLinkTarget(srcBytes)).toBe(2); // control: the source link works
    const out = await copyAndSave(src, [0, 1, 2]);
    expect(await pdfjsLinkTarget(await out.save({ useObjectStreams: false }))).toBe(2);
    expect(pageDictCount(out)).toBe(3);
  });

  it('a kept-page link survives a subset that keeps its target', async () => {
    const out = await copyAndSave(await source(3, [{ from: 0, to: 2 }]), [0, 2]);
    expect(await pdfjsLinkTarget(await out.save({ useObjectStreams: false }))).toBe(1);
    expect(secretsIn(out, 3)).toEqual([0, 2]);
  });

  it('an annotation whose /P names its own page does not duplicate the page', async () => {
    const out = await copyAndSave(await source(1, [], [], true), [0]);
    expect(pageDictCount(out)).toBe(1);
  });
});

describe('copySourcePages — a redacted page is a stand-in for its image page', () => {
  it('resolves a link to a stand-in onto the page that replaces it, and carries nothing of the original', async () => {
    const src = await source(2, [{ from: 0, to: 1 }]);
    const dest = await PDFDocument.create({ updateMetadata: false });
    const { pages, standIns } = await copySourcePages(dest, src, [0], { standIns: [1] });
    dest.addPage(pages[0]);
    const image = dest.addPage([300, 300]);
    const standIn = standIns.get(1);
    expect(standIn).toBeInstanceOf(PDFRef);
    await resolveStandIns(dest, new Map([[standIn as PDFRef, image.ref]]));
    const bytes = await dest.save({ useObjectStreams: false });
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(secretsIn(out, 2)).toEqual([0]);
    expect(await pdfjsLinkTarget(bytes)).toBe(1);
  });

  it('removes a link to a stand-in that no page replaced', async () => {
    const src = await source(2, [{ from: 0, to: 1 }]);
    const dest = await PDFDocument.create({ updateMetadata: false });
    const { pages, standIns } = await copySourcePages(dest, src, [0], { standIns: [1] });
    dest.addPage(pages[0]);
    await resolveStandIns(dest, new Map([[standIns.get(1) as PDFRef, undefined]]));
    const out = await PDFDocument.load(await dest.save({ useObjectStreams: false }), { updateMetadata: false });
    expect(linksOf(out.getPage(0))).toHaveLength(0);
    expect(secretsIn(out, 2)).toEqual([0]);
  });

  it('returns no stand-in for a page nothing references', async () => {
    const dest = await PDFDocument.create({ updateMetadata: false });
    const { standIns } = await copySourcePages(dest, await source(2), [0], { standIns: [1] });
    expect(standIns.size).toBe(0);
  });
});

describe('copySourcePages — byte-identical where no page references another', () => {
  /** The copy as it was before SEC-1: `PDFDocument.copyPages`' own four lines. */
  async function legacy(src: PDFDocument, keep: number[]): Promise<Uint8Array> {
    const dest = await PDFDocument.create({ updateMetadata: false });
    const copier = PDFObjectCopier.for(src.context, dest.context);
    const srcPages = src.getPages();
    for (const i of keep) {
      const node = copier.copy(srcPages[i].node);
      dest.addPage(PDFPage.of(node, dest.context.register(node), dest));
    }
    return dest.save({ useObjectStreams: false });
  }

  it.each([[[0, 1]], [[1]], [[0]]])('keep %j', async keep => {
    const src = await source(2, [], [], false);
    // A URI link carries an annotation graph without a page reference.
    const uri = src.context.register(src.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [1, 1, 9, 9], A: { S: 'URI', URI: PDFString.of('https://example.com') } }));
    src.getPage(1).node.set(PDFName.of('Annots'), src.context.obj([uri]));
    const dest = await PDFDocument.create({ updateMetadata: false });
    const { pages } = await copySourcePages(dest, src, keep);
    pages.forEach(p => dest.addPage(p));
    expect(Buffer.from(await dest.save({ useObjectStreams: false })).equals(Buffer.from(await legacy(src, keep)))).toBe(true);
  });
});

/** An ExportService over one source whose document model lists `keep` (0-based source pages), in order. */
function assembler(src: Uint8Array, keep: number[]): ExportService {
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: keep.length,
      currentPageIndex: 0,
      pages: keep.map(i => ({ id: `p${i}`, sourcePdfId: 's', sourcePageNum: i + 1, rotation: 0 })),
      sourcePdfs: new Map([['s', { bytes: src }]]),
      watermark: { enabled: false },
      bates: { enabled: false },
    },
    elements: [],
    formValues: {},
    currentFilename: 'sec1.pdf',
    exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info() {}, warn() {}, error() {} },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  return new ExportService(ctx);
}

describe('the assembled export — SEC-1 through _assemblePdfDoc', () => {
  it('a deleted page linked from a kept page is not in the export, and a kept link still works', async () => {
    // The kept link targets output index 1, never 0: pdf.js resolves a link to an ORPHAN page to index 0, so a
    // link aimed at page 1 could not tell a working link from a broken one (found by sabotage, 2026-10-08).
    const src = await source(3, [{ from: 0, to: 1 }, { from: 0, to: 2 }]);
    const bytes = await assembler(await src.save({ useObjectStreams: false }), [0, 2]).assemblePdfBytes();
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(secretsIn(out, 3)).toEqual([0, 2]);
    expect(linksOf(out.getPage(0))).toHaveLength(1);
    expect(await pdfjsLinkTarget(bytes, 1)).toBe(1);
  });

  it('a form field spanning a deleted page leaves that page out', async () => {
    const src = await source(2, [], [0, 1]);
    const bytes = await assembler(await src.save({ useObjectStreams: false }), [0]).assemblePdfBytes();
    expect(secretsIn(await PDFDocument.load(bytes, { updateMetadata: false }), 2)).toEqual([0]);
  });
});

// ── Milestone-1 panel, round 1 (2026-10-08) ─────────────────────────────────────────────────────────────────────
// Every shape below was reproduced by a reviewer's probe before it was written here.

/** The whole saved file as latin1 — sees string values (`/V`, `/Contents`) that `secretsIn` (streams only) cannot. */
function fileHas(bytes: Uint8Array, token: string): boolean {
  return Buffer.from(bytes).toString('latin1').includes(token);
}

/**
 * Two pages drawing one Form XObject each (`/Fm0`, `/Fm1`), whose text is SECRET(i), through ONE resources dictionary
 * — shared by reference (FPDF/FPDI style) or inherited from the page tree.
 */
async function sharedResourcesSource(shape: 'shared' | 'inherited', brokenContent = false): Promise<PDFDocument> {
  const d = await PDFDocument.create({ updateMetadata: false });
  const font = await d.embedFont(StandardFonts.Helvetica);
  const ctx = d.context;
  const forms = [0, 1].map(i => ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${SECRET(i)}) Tj ET`, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300],
  })));
  const resources = ctx.register(ctx.obj({ Font: { F1: font.ref }, XObject: { Fm0: forms[0], Fm1: forms[1] } }));
  const pages = [0, 1].map(i => {
    const p = d.addPage([300, 300]);
    p.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(`/Fm${i} Do`)));
    if (shape === 'shared') p.node.set(PDFName.of('Resources'), resources);
    else p.node.delete(PDFName.of('Resources'));
    return p;
  });
  if (shape === 'inherited') d.catalog.Pages().set(PDFName.of('Resources'), resources);
  if (brokenContent) {
    pages[0].node.set(PDFName.of('Contents'), ctx.register(ctx.stream(new Uint8Array([1, 2, 3, 4, 5]), { Filter: 'FlateDecode' })));
  }
  return PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
}

async function copyPruned(src: PDFDocument, keep: number[]): Promise<PDFDocument> {
  const dest = await PDFDocument.create({ updateMetadata: false });
  const { pages } = await copySourcePages(dest, src, keep, { pruneSharedResources: true });
  pages.forEach(p => dest.addPage(p));
  return PDFDocument.load(await dest.save({ useObjectStreams: false }), { updateMetadata: false });
}

describe('copySourcePages — shared or inherited /Resources carry nothing a kept page does not draw (M1-S1)', () => {
  it.each(['shared', 'inherited'] as const)('%s resources: the removed page\'s form is not in the file, the kept one is', async shape => {
    const src = await sharedResourcesSource(shape);
    expect(secretsIn(src, 2)).toEqual([0, 1]); // control
    const out = await copyPruned(src, [0]);
    expect(secretsIn(out, 2)).toEqual([0]);
  });

  it('a kept page whose content cannot be read refuses the export instead of guessing (fail closed)', async () => {
    const src = await sharedResourcesSource('shared', true);
    const dest = await PDFDocument.create({ updateMetadata: false });
    await expect(copySourcePages(dest, src, [0], { pruneSharedResources: true }))
      .rejects.toMatchObject({ name: 'ExportResourcesUnreadableError' });
  });

  it('every page kept: byte-identical to the plain copy (nothing to prune)', async () => {
    const src = await sharedResourcesSource('shared');
    const a = await PDFDocument.create({ updateMetadata: false });
    (await copySourcePages(a, src, [0, 1], { pruneSharedResources: true })).pages.forEach(p => a.addPage(p));
    const b = await PDFDocument.create({ updateMetadata: false });
    (await copySourcePages(b, src, [0, 1])).pages.forEach(p => b.addPage(p));
    expect(Buffer.from(await a.save({ useObjectStreams: false })).equals(Buffer.from(await b.save({ useObjectStreams: false })))).toBe(true);
  });
});

describe('copySourcePages — panel round 1, reference shapes', () => {
  it('a sibling field whose only widget is on the removed page does not carry its value (M1-C1/S2)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const [p0, p1] = [d.addPage([300, 300]), d.addPage([300, 300])];
    const parent = ctx.nextRef(), nameF = ctx.nextRef(), ssnF = ctx.nextRef();
    const w0 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 90, 30], Parent: nameF, P: p0.ref }));
    const w1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 90, 30], Parent: ssnF, P: p1.ref }));
    ctx.assign(parent, ctx.obj({ T: PDFString.of('applicant'), Kids: [nameF, ssnF] }));
    ctx.assign(nameF, ctx.obj({ FT: 'Tx', T: PDFString.of('name'), Parent: parent, V: PDFString.of('PUBLICNAME'), Kids: [w0] }));
    ctx.assign(ssnF, ctx.obj({ FT: 'Tx', T: PDFString.of('ssn'), Parent: parent, V: PDFString.of('SSNSECRETVALUE'), Kids: [w1] }));
    p0.node.set(PDFName.of('Annots'), ctx.obj([w0]));
    p1.node.set(PDFName.of('Annots'), ctx.obj([w1]));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    expect(fileHas(await src.save({ useObjectStreams: false }), 'SSNSECRETVALUE')).toBe(true); // control
    const dest = await PDFDocument.create({ updateMetadata: false });
    (await copySourcePages(dest, src, [0])).pages.forEach(p => dest.addPage(p));
    const bytes = await dest.save({ useObjectStreams: false });
    expect(fileHas(bytes, 'SSNSECRETVALUE')).toBe(false);
    expect(fileHas(bytes, 'PUBLICNAME')).toBe(true);
  });

  it('a reply on a kept page to a note on the removed page does not carry the note (/IRT)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const [p0, p1] = [d.addPage([300, 300]), d.addPage([300, 300])];
    const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('NOTESECRETTEXT'), P: p1.ref }));
    const reply = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('reply'), IRT: note, P: p0.ref }));
    p0.node.set(PDFName.of('Annots'), ctx.obj([reply]));
    p1.node.set(PDFName.of('Annots'), ctx.obj([note]));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    const dest = await PDFDocument.create({ updateMetadata: false });
    (await copySourcePages(dest, src, [0])).pages.forEach(p => dest.addPage(p));
    expect(fileHas(await dest.save({ useObjectStreams: false }), 'NOTESECRETTEXT')).toBe(false);
  });

  it('a page dictionary outside the page tree (a pre-fix export\'s orphan) is cut, not copied (M1-S4)', async () => {
    // Exactly what the pre-fix build wrote: a full page dictionary listed in no /Kids, with no /Parent, reached only
    // through a kept page's link.
    const d = await PDFDocument.create({ updateMetadata: false });
    const font = await d.embedFont(StandardFonts.Helvetica);
    const ctx = d.context;
    const p0 = d.addPage([300, 300]);
    const orphan = ctx.register(ctx.obj({
      Type: 'Page', MediaBox: [0, 0, 300, 300], Resources: { Font: { F1: font.ref } },
      Contents: ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${SECRET(1)}) Tj ET`)),
    }));
    const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 40], Dest: [orphan, PDFName.of('Fit')] }));
    p0.node.set(PDFName.of('Annots'), ctx.obj([link]));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    expect(secretsIn(src, 2)).toEqual([1]); // control: the orphan is in the source
    const out = await copyAndSave(src, [0]);
    expect(secretsIn(out, 2)).toEqual([]);
  });

  it('a non-link annotation with a GoTo to the removed page stays on its page (only links are dropped, M1-C2)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const [p0, p1] = [d.addPage([300, 300]), d.addPage([300, 300])];
    const button = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Btn', Ff: 65536, T: PDFString.of('go'), Rect: [10, 10, 90, 30], P: p0.ref, A: { S: 'GoTo', D: [p1.ref, PDFName.of('Fit')] } }));
    p0.node.set(PDFName.of('Annots'), ctx.obj([button]));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    const out = await copyAndSave(src, [0]);
    expect(out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).size()).toBe(1);
  });

  it('a link listed on two kept pages leaves no dangling reference on either (M1-C4)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const [p0, p1, p2] = [d.addPage([300, 300]), d.addPage([300, 300]), d.addPage([300, 300])];
    const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 40], Dest: [p2.ref, PDFName.of('Fit')] }));
    p0.node.set(PDFName.of('Annots'), ctx.obj([link]));
    p1.node.set(PDFName.of('Annots'), ctx.obj([link]));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    const out = await copyAndSave(src, [0, 1]);
    for (const page of out.getPages()) {
      const annots = page.node.lookup(PDFName.of('Annots'));
      expect(annots instanceof PDFArray ? annots.size() : 0).toBe(0);
    }
  });

  it('an indirect /Kids array loses the removed page\'s widget instead of holding a null (M1-C4)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const [p0, p1] = [d.addPage([300, 300]), d.addPage([300, 300])];
    const field = ctx.nextRef();
    const w0 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 90, 30], Parent: field, P: p0.ref }));
    const w1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 90, 30], Parent: field, P: p1.ref }));
    ctx.assign(field, ctx.obj({ FT: 'Tx', T: PDFString.of('f'), Kids: ctx.register(ctx.obj([w0, w1])) }));
    p0.node.set(PDFName.of('Annots'), ctx.obj([w0]));
    p1.node.set(PDFName.of('Annots'), ctx.obj([w1]));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    const out = await copyAndSave(src, [0]);
    const widgetRef = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).get(0);
    const kids = out.context.lookup(widgetRef, PDFDict).lookup(PDFName.of('Parent'), PDFDict).lookup(PDFName.of('Kids'), PDFArray);
    expect(kids.asArray()).toEqual([widgetRef]);
  });
});

describe('the assembled export — an extracted range (pagesSubset) cuts the pages outside it (F4)', () => {
  it('a link from the extracted page to a page outside the range is removed and the page is not in the file', async () => {
    const src = await source(3, [{ from: 0, to: 2 }]);
    const bytes = await src.save({ useObjectStreams: false });
    const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
    const pages = [0, 1, 2].map(i => ({ id: `p${i}`, sourcePdfId: 's', sourcePageNum: i + 1, rotation: 0 }));
    const svc = new ExportService({
      documentModel: { pageCount: 3, currentPageIndex: 0, pages, sourcePdfs: new Map([['s', { bytes }]]), watermark: { enabled: false }, bates: { enabled: false } },
      elements: [], formValues: {}, currentFilename: 'r.pdf', exportPassword: null,
      inkLayer: { getStrokes: () => [] }, reportError: { info() {}, warn() {}, error() {} },
      progress: { begin: () => handle }, cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
    } as unknown as IExportContext);
    const assemble = (svc as unknown as { _assemblePdfDoc(o: undefined, s: typeof pages): Promise<PDFDocument> })._assemblePdfDoc.bind(svc);
    const doc = await assemble(undefined, [pages[0]]);
    const out = await PDFDocument.load(await doc.save({ useObjectStreams: false }), { updateMetadata: false });
    expect(secretsIn(out, 3)).toEqual([0]);
    expect(linksOf(out.getPage(0))).toHaveLength(0);
  });
});

it('a form the kept page draws THROUGH another form is kept — pruning must not blank the page', async () => {
  // Page 0 draws /Fm0, which has no /Resources of its own and draws /Fm2 from the same shared dictionary.
  const d = await PDFDocument.create({ updateMetadata: false });
  const font = await d.embedFont(StandardFonts.Helvetica);
  const ctx = d.context;
  const text = (i: number) => ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${SECRET(i)}) Tj ET`, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300],
  }));
  const fm2 = text(2);
  const fm1 = text(1);
  const fm0 = ctx.register(ctx.stream(`BT /F1 12 Tf 20 100 Td (${SECRET(0)}) Tj ET /Fm2 Do`, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300],
  }));
  const resources = ctx.register(ctx.obj({ Font: { F1: font.ref }, XObject: { Fm0: fm0, Fm1: fm1, Fm2: fm2 } }));
  [0, 1].forEach(i => {
    const p = d.addPage([300, 300]);
    p.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(`/Fm${i} Do`)));
    p.node.set(PDFName.of('Resources'), resources);
  });
  const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
  expect(secretsIn(await copyPruned(src, [0]), 3)).toEqual([0, 2]);
});

it('a reply to a dropped link loses its /IRT instead of pointing at a deleted object (M1-C4)', async () => {
  const src = await source(2, [{ from: 0, to: 1 }]);
  const page0 = src.getPage(0);
  const link = (page0.node.lookup(PDFName.of('Annots')) as PDFArray).get(0) as PDFRef;
  const reply = src.context.register(src.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], IRT: link, Contents: PDFString.of('reply'),
  }));
  (page0.node.lookup(PDFName.of('Annots')) as PDFArray).push(reply);
  const dest = await PDFDocument.create({ updateMetadata: false });
  const { pages } = await copySourcePages(dest, src, [0]);
  dest.addPage(pages[0]);
  const dangling: string[] = [];
  const seen = new Set<unknown>();
  const visit = (o: unknown): void => {
    if (o instanceof PDFRef) { if (!dest.context.lookup(o)) dangling.push(o.toString()); return; }
    if (seen.has(o)) return;
    seen.add(o);
    if (o instanceof PDFRawStream) visit(o.dict);
    else if (o instanceof PDFArray) o.asArray().forEach(visit);
    else if (o instanceof PDFDict) o.values().forEach(visit);
  };
  for (const [, obj] of dest.context.enumerateIndirectObjects()) visit(obj);
  expect(dangling).toEqual([]);
  const annots = linksOf(dest.getPage(0));
  expect(annots).toHaveLength(0);
  const kept = (dest.getPage(0).node.lookup(PDFName.of('Annots')) as PDFArray).asArray()
    .map(r => dest.context.lookup(r) as PDFDict);
  expect(kept.map(a => a.get(PDFName.of('Subtype'))?.toString())).toEqual(['/Text']);
  expect(kept[0].has(PDFName.of('IRT'))).toBe(false);
});

describe('the export entry points prune shared resources, and the refusal has a way out (M1-S1 wiring)', () => {
  const saved = (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false });

  it('Download (assemblePdfBytes) carries no form only a removed page draws', async () => {
    const src = await sharedResourcesSource('shared');
    const out = await saved(await assembler(await src.save({ useObjectStreams: false }), [0]).assemblePdfBytes());
    expect(secretsIn(out, 2)).toEqual([0]);
  });

  it('Download refuses when the kept page cannot be read', async () => {
    const src = await sharedResourcesSource('shared', true);
    await expect(assembler(await src.save({ useObjectStreams: false }), [0]).assemblePdfBytes())
      .rejects.toMatchObject({ name: 'ExportResourcesUnreadableError' });
  });

  it('the raster-only assembly does not refuse — its bytes are only ever rendered', async () => {
    const src = await sharedResourcesSource('shared', true);
    const bytes = await assembler(await src.save({ useObjectStreams: false }), [0]).assemblePdfBytes({ rasterOnly: true });
    expect(bytes.length).toBeGreaterThan(0);
  });

  it.each([
    ['lossy', { rasterOnly: true }],
    ['lossless', undefined],
    ['images', undefined],
  ] as const)('Compress (%s) assembles with %j', async (mode, expected) => {
    const src = await sharedResourcesSource('shared');
    const svc = assembler(await src.save({ useObjectStreams: false }), [0]);
    const internals = svc as unknown as Record<string, unknown>;
    const assemble = vi.spyOn(svc, 'assemblePdfBytes').mockResolvedValue(new Uint8Array([1]));
    internals._compressLossy = vi.fn().mockResolvedValue(new Uint8Array([1]));
    internals._compressLossless = vi.fn().mockResolvedValue(new Uint8Array([1]));
    internals._saveOrDownload = vi.fn().mockResolvedValue(undefined);
    await svc.compressAndDownload({ mode });
    expect(assemble).toHaveBeenCalledTimes(1);
    if (expected) expect(assemble).toHaveBeenCalledWith(expected);
    else expect(assemble.mock.calls[0][0]?.rasterOnly).toBeFalsy();
  });

  it('single-page download carries no form only a removed page draws', async () => {
    const src = await sharedResourcesSource('shared');
    const svc = assembler(await src.save({ useObjectStreams: false }), [0]);
    let bytes: Uint8Array | undefined;
    (svc as unknown as Record<string, unknown>)._saveOrDownload = vi.fn((_t: unknown, b: Uint8Array) => { bytes = b; return Promise.resolve(); });
    await svc.downloadPage(0);
    if (!bytes) throw new Error('downloadPage saved nothing');
    expect(secretsIn(await saved(bytes), 2)).toEqual([0]);
  });

  it('single-page download shows the refusal as its own message, not "export failed"', async () => {
    const src = await sharedResourcesSource('shared', true);
    const svc = assembler(await src.save({ useObjectStreams: false }), [0]);
    const errors: string[] = [];
    (svc as unknown as { _ctx: { reportError: { error: (k: string) => void } } })._ctx.reportError.error = k => { errors.push(k); };
    await svc.downloadPage(0);
    expect(errors).toEqual(['toast.exportResourcesUnreadable']);
  });
});
