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
import { RedactionElement } from '../../src/elements/redactionElement';

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

  /** `_assemblePdfDoc` over the first page of a 2-page source, with `elements` on the document model. */
  async function extractFirst(srcBytes: Uint8Array, elements: unknown[] = []): Promise<PDFDocument> {
    const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
    const pages = [0, 1].map(i => ({ id: `p${i}`, sourcePdfId: 's', sourcePageNum: i + 1, rotation: 0 }));
    const svc = new ExportService({
      documentModel: { pageCount: 2, currentPageIndex: 0, pages, sourcePdfs: new Map([['s', { bytes: srcBytes }]]), watermark: { enabled: false }, bates: { enabled: false } },
      elements, formValues: {}, currentFilename: 'r.pdf', exportPassword: null,
      inkLayer: { getStrokes: () => [] }, reportError: { info() {}, warn() {}, error() {} },
      progress: { begin: () => handle }, cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
    } as unknown as IExportContext);
    const assemble = (svc as unknown as { _assemblePdfDoc(o: undefined, s: typeof pages): Promise<PDFDocument> })._assemblePdfDoc.bind(svc);
    const doc = await assemble(undefined, [pages[0]]);
    return PDFDocument.load(await doc.save({ useObjectStreams: false }), { updateMetadata: false });
  }

  it('a resources dictionary the extracted page shares with a page outside the range carries only what it draws', async () => {
    const src = await sharedResourcesSource('shared');
    expect(secretsIn(await extractFirst(await src.save({ useObjectStreams: false })), 2)).toEqual([0]);
  });

  it('a REDACTED page outside the range is cut, not held as a stand-in: the link to it goes', async () => {
    const src = await source(2, [{ from: 0, to: 1 }]);
    const redaction = new RedactionElement(10, 10, 100, 30, 'p1', '#000000');
    const out = await extractFirst(await src.save({ useObjectStreams: false }), [redaction]);
    expect(secretsIn(out, 2)).toEqual([0]);
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

  it('the sign-rect box is read without the prune: an unreadable shared page still gives its box (R4-K-3)', async () => {
    const src = await sharedResourcesSource('shared', true);
    const svc = assembler(await src.save({ useObjectStreams: false }), [0]);
    await expect(svc.assembledPageBox(0)).resolves.toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
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

const ROUTE_PUBLIC = 'PUBLICP1NEEDLE';
const ROUTE_SECRET = 'SECRETP2NEEDLE';
/** The safety lens's round-2 probe shapes (panel 2026-10-08), verbatim; page index 1 is the one left out. */
async function routeShape(shape: string): Promise<PDFDocument> {
  const src = await PDFDocument.create(); const ctx = src.context;
  const p1 = src.addPage([300, 300]); const p2 = src.addPage([300, 300]);
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const form = (t: string, extra: Record<string, unknown> = {}) => ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${t}) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], ...extra }));
  const content = (s: string) => ctx.register(ctx.stream(s));
  const im2 = ctx.register(ctx.stream('IMG' + ROUTE_SECRET, { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
  const fm2 = form(ROUTE_SECRET);
  const t3 = (res: unknown) => ({ Type: 'Font', Subtype: 'Type3', FontBBox: [0,0,1,1], FontMatrix: [1,0,0,1,0,0],
    CharProcs: { a: ctx.register(ctx.stream('0 0 d0')) }, Encoding: { Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1], Resources: res });
  if (shape === 'control') {          // kept page DRAWS the secret: the scan must see it
    const res = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC), Fm2: fm2 } }));
    p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
    p1.node.set(PDFName.of('Contents'), content('/Fm2 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'roundOneShared') {   // round-1 shape, should be clean now
    const res = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC), Fm2: fm2, Im2: im2 } }));
    p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do /Im2 Do'));
  } else if (shape === 'formOwnResIsShared') {  // TCPDF/FPDI: a drawn form whose /Resources IS the shared dict
    const res = ctx.nextRef();
    const fm1 = form(ROUTE_PUBLIC, { Resources: res });
    ctx.assign(res, ctx.obj({ Font: { F1: font }, XObject: { Fm1: fm1, Fm2: fm2, Im2: im2 } }));
    p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do /Im2 Do'));
  } else if (shape === 'annotApSharedRes') {    // TCPDF _putAPXObject: an annotation appearance with /Resources 2 0 R
    const res = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC), Fm2: fm2, Im2: im2 } }));
    p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do /Im2 Do'));
    const ap = ctx.register(ctx.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 90, 30], Resources: res }));
    const w = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('f'), Rect: [10, 10, 100, 40], P: p1.ref, AP: { N: ap } }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([w]));
  } else if (shape === 'xobjectSubdictShared') { // distinct /Resources dicts, ONE shared /XObject subdict
    const xo = ctx.register(ctx.obj({ Fm1: form(ROUTE_PUBLIC), Fm2: fm2, Im2: im2 }));
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: xo }));
    p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: xo }));
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do /Im2 Do'));
  } else if (shape === 'extGStateSMask') {      // shared dict, removed page's ExtGState soft-mask group draws text
    const res = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC) },
      ExtGState: { GS2: { Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: form(ROUTE_SECRET, { Group: { S: 'Transparency', CS: 'DeviceGray' } }) } } } }));
    p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/GS2 gs 0 0 300 300 re f'));
  } else if (shape === 'type3Font') {           // shared dict, removed page's Type3 font, glyph proc carries text
    const proc = ctx.register(ctx.stream(`0 0 d0 BT /F1 1 Tf (${ROUTE_SECRET}) Tj ET`));
    const res = ctx.register(ctx.obj({ Font: { F1: font, T3: { Type: 'Font', Subtype: 'Type3', FontBBox: [0,0,1,1], FontMatrix: [1,0,0,1,0,0], CharProcs: { a: proc }, Encoding: { Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1], Resources: { Font: { F1: font } } } }, XObject: { Fm1: form(ROUTE_PUBLIC) } }));
    p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('BT /T3 12 Tf (a) Tj ET'));
  } else if (shape === 'parentResPlusOwnPartial') { // /Pages carries Fm2; kept page has its own partial /Resources
    const pagesNode = src.catalog.lookup(PDFName.of('Pages')) as PDFDict;
    pagesNode.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm2: fm2 } }));
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC) } }));
    p2.node.delete(PDFName.of('Resources'));
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'patternOwnResIsShared') { // kept page paints a tiling pattern whose /Resources IS the shared dict
    const res = ctx.nextRef();
    const pat = ctx.register(ctx.stream(`BT /F1 4 Tf 0 0 Td (${ROUTE_PUBLIC}) Tj ET`, { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0,0,10,10], XStep: 10, YStep: 10, Resources: res }));
    ctx.assign(res, ctx.obj({ Font: { F1: font }, Pattern: { P1: pat }, XObject: { Fm2: fm2, Im2: im2 } }));
    p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
    p1.node.set(PDFName.of('Contents'), content('/Pattern cs /P1 scn 0 0 300 300 re f')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do /Im2 Do'));
  } else if (shape === 'resetFormFields') {      // a kept button's ResetForm /Fields names the removed page's field
    for (const [p, t] of [[p1, ROUTE_PUBLIC], [p2, 'other']] as const) {
      p.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font } }));
      p.node.set(PDFName.of('Contents'), content(`BT /F1 12 Tf 20 200 Td (${t}) Tj ET`));
    }
    const ssn = ctx.nextRef();
    const w2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 100, 40], Parent: ssn, P: p2.ref }));
    ctx.assign(ssn, ctx.obj({ FT: 'Tx', T: PDFString.of('ssn'), V: PDFString.of(ROUTE_SECRET), Kids: [w2] }));
    const btn = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Btn', Ff: 65536, T: PDFString.of('clear'), Rect: [10, 60, 100, 90], P: p1.ref,
      A: { S: 'ResetForm', Fields: [ssn] } }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([btn])); p2.node.set(PDFName.of('Annots'), ctx.obj([w2]));
    src.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [btn, ssn] }));
  } else if (shape === 'hideActionField') {      // a kept button's /Hide action /T names the removed page's FIELD
    for (const [p, t] of [[p1, ROUTE_PUBLIC], [p2, 'other']] as const) {
      p.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font } }));
      p.node.set(PDFName.of('Contents'), content(`BT /F1 12 Tf 20 200 Td (${t}) Tj ET`));
    }
    const ssn = ctx.nextRef();
    const w2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 100, 40], Parent: ssn, P: p2.ref }));
    ctx.assign(ssn, ctx.obj({ FT: 'Tx', T: PDFString.of('ssn'), V: PDFString.of(ROUTE_SECRET), Kids: [w2] }));
    const btn = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Btn', Ff: 65536, T: PDFString.of('toggle'), Rect: [10, 60, 100, 90], P: p1.ref,
      A: { S: 'Hide', T: ssn, H: false } }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([btn])); p2.node.set(PDFName.of('Annots'), ctx.obj([w2]));
  } else if (shape === 'directType3SharedRes') {   // round 3: an INLINE Type3 font whose /Resources is the shared dict
    const S = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC), Fm2: fm2 } }));
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font, T3: t3(S) }, XObject: { Fm1: (ctx.lookup(S) as PDFDict).lookup(PDFName.of('XObject'), PDFDict).get(PDFName.of('Fm1')) } }));
    p2.node.set(PDFName.of('Resources'), S);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do BT /T3 12 Tf (a) Tj ET')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'directType3InShared') {    // round 3: ONE shared dict; the inline Type3 inside it points back at it
    const S = ctx.nextRef();
    ctx.assign(S, ctx.obj({ Font: { F1: font, T3: t3(S) }, XObject: { Fm1: form(ROUTE_PUBLIC), Fm2: fm2 } }));
    p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do BT /T3 12 Tf (a) Tj ET')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'inheritedFTActionField') {  // round 3: a reset button names a field whose /FT its parent carries
    for (const [p, t] of [[p1, ROUTE_PUBLIC], [p2, 'other']] as const) {
      p.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font } }));
      p.node.set(PDFName.of('Contents'), content(`BT /F1 12 Tf 20 200 Td (${t}) Tj ET`));
    }
    const root = ctx.nextRef(); const ssn = ctx.nextRef();
    const w2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 100, 40], Parent: ssn, P: p2.ref }));
    ctx.assign(ssn, ctx.obj({ T: PDFString.of('ssn'), V: PDFString.of(ROUTE_SECRET), Parent: root, Kids: [w2] }));
    ctx.assign(root, ctx.obj({ FT: 'Tx', T: PDFString.of('person'), Kids: [ssn] }));
    const btn = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Btn', Ff: 65536, T: PDFString.of('clear'), Rect: [10, 60, 100, 90], P: p1.ref,
      A: { S: 'ResetForm', Fields: [ssn] } }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([btn])); p2.node.set(PDFName.of('Annots'), ctx.obj([w2]));
    src.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [btn, root] }));
  } else if (shape === 'inDesignActualText') {     // round 3: InDesign's marked-content dictionary on a kept page that shares
    const res = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC), Fm2: fm2 } }));
    p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
    p1.node.set(PDFName.of('Contents'), content('/Span<</ActualText<FEFF0009>>> BDC /Fm1 Do EMC')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'inlineT3IndirectRes') {   // round 4: an inline Type3 whose INDIRECT /Resources only the kept page reaches lists the removed form
    const R = ctx.register(ctx.obj({ XObject: { Fm2: fm2 } }));
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font, T3: t3(R) }, XObject: { Fm1: form(ROUTE_PUBLIC) } }));
    p2.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm2: fm2 } }));
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do BT /T3 12 Tf (a) Tj ET')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'extGStateInlineT3') {     // round 4: an inline Type3 in a drawn ExtGState's /Font array, resources = the shared dict
    const S = ctx.nextRef();
    ctx.assign(S, ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC), Fm2: fm2 }, ExtGState: { GS1: { Type: 'ExtGState', Font: [t3(S), 12] } } }));
    p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
    p1.node.set(PDFName.of('Contents'), content('/GS1 gs /Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'extGStateInlineT3Indirect') { // round 4: the same, in an INDIRECT ExtGState — reached by the copier hook
    const S = ctx.nextRef();
    const gs1 = ctx.register(ctx.obj({ Type: 'ExtGState', Font: [t3(S), 12] }));
    ctx.assign(S, ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC), Fm2: fm2 }, ExtGState: { GS1: gs1 } }));
    p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
    p1.node.set(PDFName.of('Contents'), content('/GS1 gs /Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'contentResShadows') { // round 4: the content stream's /Fm1 shadows the page's — pdf.js draws the local one
    const res = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: fm2 } }));
    p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
    p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm1 Do', { Resources: { XObject: { Fm1: form(ROUTE_PUBLIC) } } })));
    p2.node.set(PDFName.of('Contents'), content('/Fm1 Do'));
  } else if (shape === 'fieldDRKidDA') { // round 4 keep shape: the field holds /DR, only its widget holds the /DA naming /F1
    const S = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC), Fm2: fm2 } }));
    p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
    const field = ctx.nextRef();
    const w = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 100, 40], P: p1.ref, Parent: field, DA: PDFString.of('/F1 9 Tf 0 g') }));
    ctx.assign(field, ctx.obj({ FT: 'Tx', T: PDFString.of('name'), Kids: [w], DR: S }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([w]));
    src.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [field] }));
  } else if (shape === 'unusedWrapperForm' || shape === 'unusedWrapperPattern' || shape === 'unusedWrapperGs') {
    // round 5 (R5-S-1): the kept page LISTS but never draws a form / pattern / soft-mask group that only it reaches,
    // whose own resources name the removed page's form
    const own = { XObject: { Fm2: fm2 } };
    const wrapper = shape === 'unusedWrapperPattern'
      ? { Pattern: { Pk: ctx.register(ctx.stream('/Fm2 Do', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 300, 300], XStep: 300, YStep: 300, Resources: own })) } }
      : shape === 'unusedWrapperGs'
        ? { ExtGState: { GSk: ctx.register(ctx.obj({ Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity',
          G: ctx.register(ctx.stream('/Fm2 Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], Group: { S: 'Transparency' }, Resources: own })) } })) } }
        : { XObject: { FmA: ctx.register(ctx.stream('/Fm2 Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], Resources: own })) } };
    const fm1 = form(ROUTE_PUBLIC);
    p1.node.set(PDFName.of('Resources'), ctx.obj({ ...wrapper, XObject: { Fm1: fm1, ...(wrapper.XObject ?? {}) } }));
    p2.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm2: fm2 } }));
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'patternShadow') { // round 5 (R5-S-2): a tiling pattern's own /XObject HIDES the parent's (no sub-dict merge)
    const pat = ctx.register(ctx.stream('/Fm2 Do', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 300, 300], XStep: 300, YStep: 300,
      Resources: { XObject: { Fm2: form('PATTERNOWNFORM') } } }));
    const S = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm2: fm2, Fm1: form(ROUTE_PUBLIC) }, Pattern: { P1: pat } }));
    p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
    p1.node.set(PDFName.of('Contents'), content('/Pattern cs /P1 scn 0 0 300 300 re f /Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'arrayContentsLocalRes') { // round 5 (R5-S-3): an ARRAY /Contents — pdf.js never reads a member's /Resources
    const S = ctx.register(ctx.obj({ XObject: { Fm2: fm2 } }));
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font }, XObject: { Fm2: form(ROUTE_PUBLIC) } }));
    p1.node.set(PDFName.of('Contents'), ctx.obj([ctx.register(ctx.stream('/Fm2 Do', { Resources: S }))]));
    p2.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'inlineOwnerInStreamDict') { // round 5 (R5-S-4): an inline Type3 under a drawn form's /PieceInfo, resources = p2's
    const S = ctx.register(ctx.obj({ XObject: { Fm2: fm2 } }));
    const fmK = form(ROUTE_PUBLIC, { Resources: { Font: { F1: font } }, PieceInfo: { X: { Private: t3(S) } } });
    p1.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm1: fmK } }));
    p2.node.set(PDFName.of('Resources'), S);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  } else if (shape === 'inlineWidgetDR') { // round 5 (R5-C-1): an INLINE widget in the kept page's /Annots whose /DR is the shared dict
    const S = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC), Fm2: fm2 } }));
    p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
    p1.node.set(PDFName.of('Annots'), ctx.obj([ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('n'), Rect: [10, 10, 100, 40], DR: S, DA: PDFString.of('/F1 0 Tf 0 g') })]));
  } else if (shape === 'widgetDR' || shape === 'fieldDR') { // round 4: a kept widget's (or its field's) /DR IS the shared dict
    const S = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Fm1: form(ROUTE_PUBLIC), Fm2: fm2 } }));
    p1.node.set(PDFName.of('Resources'), S); p2.node.set(PDFName.of('Resources'), S);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
    const dr = { DR: S, DA: PDFString.of('/F1 0 Tf 0 g') };
    const field = ctx.nextRef();
    const w = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 100, 40], P: p1.ref, Parent: field, ...(shape === 'widgetDR' ? dr : {}) }));
    ctx.assign(field, ctx.obj({ FT: 'Tx', T: PDFString.of('name'), Kids: [w], ...(shape === 'fieldDR' ? dr : {}) }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([w]));
    src.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [field] }));
  } else if (shape === 'brokenFormOwner') {      // as formOwnResIsShared, but the kept form cannot be decoded
    const res = ctx.nextRef();
    const fm1 = ctx.register(ctx.stream(new Uint8Array([1, 2, 3, 4, 5]), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], Filter: 'FlateDecode', Resources: res }));
    ctx.assign(res, ctx.obj({ Font: { F1: font }, XObject: { Fm1: fm1, Fm2: fm2, Im2: im2 } }));
    p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
    p1.node.set(PDFName.of('Contents'), content('/Fm1 Do')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do /Im2 Do'));
  } else if (shape === 'keptUsesType3AndGs') {   // the kept page DRAWS through the shared Type3 font and ExtGState
    // The glyph procedure draws the shared /GlyphFont, and the soft-mask group the shared /MaskForm — neither has
    // resources of its own, so both draw from the page's dictionary and must keep what they name there.
    const glyphFont = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Courier' }));
    const maskForm = form('SMASKKEPT');
    const proc = ctx.register(ctx.stream(`0 0 d0 BT /GlyphFont 1 Tf (${ROUTE_PUBLIC}) Tj ET`));
    const group = ctx.register(ctx.stream('/MaskForm Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], Group: { S: 'Transparency' } }));
    const res = ctx.register(ctx.obj({ Font: { F1: font, GlyphFont: glyphFont, T3: { Type: 'Font', Subtype: 'Type3', FontBBox: [0,0,1,1], FontMatrix: [1,0,0,1,0,0], CharProcs: { a: proc }, Encoding: { Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1] } },
      ExtGState: { GS1: { Type: 'ExtGState', CA: 0.5, SMask: { Type: 'Mask', S: 'Luminosity', G: group } } }, XObject: { Fm2: fm2, MaskForm: maskForm } }));
    p1.node.set(PDFName.of('Resources'), res); p2.node.set(PDFName.of('Resources'), res);
    p1.node.set(PDFName.of('Contents'), content('/GS1 gs BT /T3 12 Tf (a) Tj ET')); p2.node.set(PDFName.of('Contents'), content('/Fm2 Do'));
  }
  return PDFDocument.load(await src.save({ useObjectStreams: false }), { updateMetadata: false });
}


async function copyRoute(shape: string, mode: 'cut' | 'standIn'): Promise<string> {
  const src = await routeShape(shape);
  const dest = await PDFDocument.create({ updateMetadata: false });
  const { pages, standIns } = await copySourcePages(dest, src, [0], { pruneSharedResources: true, ...(mode === 'standIn' ? { standIns: [1] } : {}) });
  dest.addPage(pages[0]);
  if (standIns.size) await resolveStandIns(dest, new Map([...standIns.values()].map(r => [r, undefined])));
  return Buffer.from(await dest.save({ useObjectStreams: false })).toString('latin1');
}

describe('every resource owner, every category: nothing only a removed page draws is carried (M1 round 2, R2-S1..S4)', () => {
  it.each(['cut', 'standIn'] as const)('control (%s): a kept page that DRAWS the secret keeps it — the scan can see it', async mode => {
    expect((await copyRoute('control', mode)).includes(ROUTE_SECRET)).toBe(true);
  });

  it.each([
    'roundOneShared', 'formOwnResIsShared', 'annotApSharedRes', 'xobjectSubdictShared', 'extGStateSMask', 'type3Font',
    'parentResPlusOwnPartial', 'patternOwnResIsShared', 'resetFormFields', 'hideActionField',
    'directType3SharedRes', 'directType3InShared', 'inheritedFTActionField', 'inDesignActualText',
    'inlineT3IndirectRes', 'extGStateInlineT3', 'extGStateInlineT3Indirect', 'contentResShadows', 'widgetDR', 'fieldDR',
    'unusedWrapperForm', 'unusedWrapperPattern', 'unusedWrapperGs', 'patternShadow', 'arrayContentsLocalRes', 'inlineOwnerInStreamDict',
    'inlineWidgetDR',
  ].flatMap(shape => (['cut', 'standIn'] as const).map(mode => [shape, mode] as const)))('%s (%s)', async (shape, mode) => {
    const original = Buffer.from(await (await routeShape(shape)).save({ useObjectStreams: false })).toString('latin1');
    expect(original.includes(ROUTE_SECRET), 'control: the source carries the removed page\'s content').toBe(true);
    const out = await copyRoute(shape, mode);
    expect(out.includes(ROUTE_SECRET), 'the removed page\'s content').toBe(false);
    expect(out.includes(ROUTE_PUBLIC), 'the kept page\'s own content').toBe(true);
  });

  it('a kept page that draws through the shared Type3 font and ExtGState keeps both', async () => {
    const out = await copyRoute('keptUsesType3AndGs', 'cut');
    expect(out.includes(ROUTE_PUBLIC)).toBe(true);
    expect(out.includes('/GS1')).toBe(true);
    expect(out.includes('/Courier'), 'the font the glyph procedure draws').toBe(true);
    expect(out.includes('SMASKKEPT'), 'the form the soft-mask group draws').toBe(true);
    expect(out.includes(ROUTE_SECRET)).toBe(false);
  });

  it('a kept FORM that shares the removed page\'s dictionary and cannot be read refuses the export', async () => {
    await expect(copyRoute('brokenFormOwner', 'cut')).rejects.toMatchObject({ name: 'ExportResourcesUnreadableError' });
  });
});

describe('M1 round 2 — correctness lens (R2-3, R2-4, R2-6, R2-7, R2-8)', () => {
  it('a signature value whose /Reference /Data names the catalog does not drag the document in (R2-3)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const font = await d.embedFont(StandardFonts.Helvetica);
    const ctx = d.context;
    const [p0, p1] = [d.addPage([300, 300]), d.addPage([300, 300])];
    p0.drawText(SECRET(0), { x: 20, y: 200, size: 12, font });
    p1.drawText(SECRET(1), { x: 20, y: 200, size: 12, font });
    const ssn = ctx.nextRef();
    const w1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 100, 40], Parent: ssn, P: p1.ref }));
    ctx.assign(ssn, ctx.obj({ FT: 'Tx', T: PDFString.of('ssn'), V: PDFString.of('SIGDATASECRET'), Kids: [w1] }));
    const catalogRef = ctx.trailerInfo.Root as PDFRef;
    // The page-tree root too: it carries inherited /Resources, here a form only page 2 could draw.
    const pagesRoot = d.catalog.get(PDFName.of('Pages')) as PDFRef;
    const rootForm = ctx.register(ctx.stream('BT /F1 9 Tf (PAGESROOTSECRET) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 9, 9] }));
    d.catalog.Pages().set(PDFName.of('Resources'), ctx.obj({ XObject: { Root: rootForm } }));
    const sig = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('sig'), Rect: [10, 60, 100, 90], P: p0.ref, Tree: pagesRoot,
      V: { Type: 'Sig', Reference: [{ Type: 'SigRef', TransformMethod: 'FieldMDP', Data: catalogRef }] },
    }));
    p0.node.set(PDFName.of('Annots'), ctx.obj([sig]));
    p1.node.set(PDFName.of('Annots'), ctx.obj([w1]));
    d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [sig, ssn] }));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    expect(fileHas(await src.save({ useObjectStreams: false }), 'SIGDATASECRET')).toBe(true); // control
    const out = await copyAndSave(src, [0]);
    const bytes = await out.save({ useObjectStreams: false });
    expect(fileHas(bytes, 'SIGDATASECRET')).toBe(false);
    expect(fileHas(bytes, 'PAGESROOTSECRET')).toBe(false);
    expect(secretsIn(out, 2)).toEqual([0]);
    const catalogs = out.context.enumerateIndirectObjects()
      .filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Catalog'));
    expect(catalogs, 'only the export\'s own catalog').toHaveLength(1);
  });

  it('a resource no left-out page reaches is left exactly as it was, drawn or not — the prune is not a cleanup', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const font = await d.embedFont(StandardFonts.Helvetica);
    const ctx = d.context;
    const form = (t: string) => ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${t}) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300] }));
    [0, 1].forEach(i => {
      const p = d.addPage([300, 300]);
      p.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm0 Do')));
      // Each page its own dictionary; page 0's also lists a form nothing draws.
      p.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref }, XObject: i === 0 ? { Fm0: form(SECRET(0)), Unused: form('UNUSEDOWN') } : { Fm0: form(SECRET(1)) } }));
    });
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    const plain = await PDFDocument.create({ updateMetadata: false });
    plain.addPage((await copySourcePages(plain, src, [0])).pages[0]);
    const pruned = await PDFDocument.create({ updateMetadata: false });
    pruned.addPage((await copySourcePages(pruned, src, [0], { pruneSharedResources: true })).pages[0]);
    const prunedBytes = await pruned.save({ useObjectStreams: false });
    expect(fileHas(prunedBytes, 'UNUSEDOWN')).toBe(true);
    expect(Buffer.from(prunedBytes).equals(Buffer.from(await plain.save({ useObjectStreams: false })))).toBe(true);
  });

  it('a kept page drawn on after load (flatten, a typed value) is still read, not refused (R2-4)', async () => {
    const src = await sharedResourcesSource('shared');
    src.getPage(0).drawRectangle({ x: 1, y: 1, width: 5, height: 5 }); // appends a PDFContentStream, as form.flatten() does
    const out = await copyPruned(src, [0]);
    expect(secretsIn(out, 2)).toEqual([0]);
  });

  it('a tiling pattern with resources of its own still draws from the page\'s, as pdf.js merges them (R2-6)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const font = await d.embedFont(StandardFonts.Helvetica);
    const ctx = d.context;
    const text = (i: number) => ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${SECRET(i)}) Tj ET`, {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300],
    }));
    const pattern = ctx.register(ctx.stream('/Fm0 Do', {
      Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 300, 300], XStep: 300, YStep: 300,
      Resources: { ProcSet: ['PDF'] },
    }));
    const resources = ctx.register(ctx.obj({ Font: { F1: font.ref }, XObject: { Fm0: text(0), Fm1: text(1) }, Pattern: { P0: pattern } }));
    [0, 1].forEach(i => {
      const p = d.addPage([300, 300]);
      p.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(i === 0 ? '/Pattern cs /P0 scn 0 0 300 300 re f' : '/Fm1 Do')));
      p.node.set(PDFName.of('Resources'), resources);
    });
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    expect(secretsIn(await copyPruned(src, [0]), 2)).toEqual([0]);
  });

  it('a form whose /Resources is not a dictionary draws from its parent\'s, as pdf.js does (R2-6)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const font = await d.embedFont(StandardFonts.Helvetica);
    const ctx = d.context;
    const text = (i: number) => ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${SECRET(i)}) Tj ET`, {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300],
    }));
    const outer = ctx.register(ctx.stream('/Fm0 Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], Resources: 0 }));
    const resources = ctx.register(ctx.obj({ Font: { F1: font.ref }, XObject: { Outer: outer, Fm0: text(0), Fm1: text(1) } }));
    [0, 1].forEach(i => {
      const p = d.addPage([300, 300]);
      p.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(i === 0 ? '/Outer Do' : '/Fm1 Do')));
      p.node.set(PDFName.of('Resources'), resources);
    });
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    expect(secretsIn(await copyPruned(src, [0]), 2)).toEqual([0]);
  });

  it('with every page kept, a field no widget belongs to is copied as before, value and all (R2-7)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const p0 = d.addPage([300, 300]);
    const parent = ctx.nextRef();
    const w0 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 100, 40], Parent: parent, P: p0.ref }));
    const loose = ctx.register(ctx.obj({ FT: 'Tx', T: PDFString.of('loose'), V: PDFString.of('LOOSEVALUE'), Parent: parent }));
    ctx.assign(parent, ctx.obj({ FT: 'Tx', T: PDFString.of('p'), Kids: [w0, loose] }));
    p0.node.set(PDFName.of('Annots'), ctx.obj([w0]));
    d.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [parent] }));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    // Not a byte comparison: the widget's /P is a page reference, which renumbers objects by design (lazy refs).
    const legacyDoc = await PDFDocument.create({ updateMetadata: false });
    legacyDoc.addPage((await legacyDoc.copyPages(src, [0]))[0]);
    expect(fileHas(await legacyDoc.save({ useObjectStreams: false }), 'LOOSEVALUE')).toBe(true); // control
    const ours = await PDFDocument.create({ updateMetadata: false });
    ours.addPage((await copySourcePages(ours, src, [0])).pages[0]);
    expect(fileHas(await ours.save({ useObjectStreams: false }), 'LOOSEVALUE')).toBe(true);
  });

  it('an indirect /Type /Page and an indirect /Subtype /Link are recognised (R2-8)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const font = await d.embedFont(StandardFonts.Helvetica);
    const ctx = d.context;
    const p0 = d.addPage([300, 300]);
    const pageName = ctx.register(PDFName.of('Page'));
    const linkName = ctx.register(PDFName.of('Link'));
    const orphan = ctx.register(ctx.obj({
      Type: pageName, MediaBox: [0, 0, 300, 300], Resources: { Font: { F1: font.ref } },
      Contents: ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${SECRET(1)}) Tj ET`)),
    }));
    const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: linkName, Rect: [10, 10, 100, 40], Dest: [orphan, PDFName.of('Fit')] }));
    p0.node.set(PDFName.of('Annots'), ctx.obj([link]));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    expect(secretsIn(src, 2)).toEqual([1]); // control
    const out = await copyAndSave(src, [0]);
    expect(secretsIn(out, 2)).toEqual([]);
    const annots = out.getPage(0).node.lookup(PDFName.of('Annots'));
    expect(annots instanceof PDFArray ? annots.size() : 0).toBe(0);
  });
});

describe('M1 round 3 — the remaining review findings', () => {
  it('a shading or Indexed base that names a colour space keeps it — colour spaces are not pruned (round 3, C-F2)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const shading = ctx.register(ctx.obj({ ShadingType: 2, ColorSpace: 'CS0', Coords: [0, 0, 1, 0], Function: { FunctionType: 2, Domain: [0, 1], C0: [0], C1: [1], N: 1 } }));
    const res = ctx.register(ctx.obj({
      ColorSpace: { CS0: ctx.obj(['ICCBased', ctx.register(ctx.stream('ICC', { N: 1 }))]), CS1: ctx.obj(['Indexed', 'CS0', 1, PDFString.of('ab')]) },
      Shading: { Sh0: shading },
    }));
    [0, 1].forEach(i => {
      const p = d.addPage([300, 300]);
      p.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(i === 0 ? '/Sh0 sh /CS1 cs 0 sc' : '/CS0 cs 0.5 sc 0 0 9 9 re f')));
      p.node.set(PDFName.of('Resources'), res);
    });
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    const out = await copyPruned(src, [0]);
    const cs = (out.getPage(0).node.Resources() as PDFDict).lookup(PDFName.of('ColorSpace'), PDFDict);
    expect(cs.keys().map(k => k.decodeText()).sort()).toEqual(['CS0', 'CS1']);
  });

  it('a long chain a left-out page reaches does not overflow the stack (round 3, C-F3)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const [p0, p1] = [d.addPage([300, 300]), d.addPage([300, 300])];
    const shared = ctx.register(ctx.obj({ XObject: {} }));
    p0.node.set(PDFName.of('Resources'), shared); p1.node.set(PDFName.of('Resources'), shared);
    p0.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('0 0 9 9 re f')));
    let next: PDFRef | undefined;
    for (let k = 0; k < 20000; k++) next = ctx.register(ctx.obj(next ? { Next: next } : {}));
    p1.node.set(PDFName.of('Chain'), next as PDFRef);
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    await expect(copyPruned(src, [0])).resolves.toBeDefined();
  });

  it('with every page kept, a reference to the catalog is still cut — a copy never carries the document (round 3, R3-3)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const p0 = d.addPage([300, 300]);
    d.catalog.set(PDFName.of('Lang'), PDFString.of('CATALOGMARK'));
    const sig = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('s'), Rect: [1, 1, 9, 9], P: p0.ref,
      V: { Type: 'Sig', Reference: [{ Type: 'SigRef', Data: ctx.trailerInfo.Root }] } }));
    p0.node.set(PDFName.of('Annots'), ctx.obj([sig]));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    const out = await copyAndSave(src, [0]);
    expect(fileHas(await out.save({ useObjectStreams: false }), 'CATALOGMARK')).toBe(false);
  });

  it('an inline Type3 font whose glyph draws with the font itself refuses instead of looping (round 3)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const S = ctx.nextRef();
    const proc = ctx.register(ctx.stream('0 0 d0 BT /T3 1 Tf (a) Tj ET'));
    ctx.assign(S, ctx.obj({
      Font: { T3: { Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1, 1], FontMatrix: [1, 0, 0, 1, 0, 0], CharProcs: { a: proc },
        Encoding: { Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1], Resources: S } },
      XObject: { Fm2: ctx.register(ctx.stream('0 0 9 9 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 9, 9] })) },
    }));
    [0, 1].forEach(i => {
      const p = d.addPage([300, 300]);
      p.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(i === 0 ? 'BT /T3 12 Tf (a) Tj ET' : '/Fm2 Do')));
      p.node.set(PDFName.of('Resources'), S);
    });
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    await expect(copyPruned(src, [0])).rejects.toMatchObject({ name: 'ExportResourcesUnreadableError' });
  });

  it('an inline widget on a kept page keeps its field value when another page is left out (round 3, R3-6)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const [p0] = [d.addPage([300, 300]), d.addPage([300, 300])];
    const field = ctx.nextRef();
    const inlineWidget = ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 100, 40], Parent: field, P: p0.ref });
    ctx.assign(field, ctx.obj({ FT: 'Tx', T: PDFString.of('name'), V: PDFString.of('KEPTPAGEVALUE') }));
    p0.node.set(PDFName.of('Annots'), ctx.obj([inlineWidget]));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    const out = await copyAndSave(src, [0]);
    expect(fileHas(await out.save({ useObjectStreams: false }), 'KEPTPAGEVALUE')).toBe(true);
  });
});

describe('M1 round 4 — what a kept page draws through, the way pdf.js resolves it', () => {
  const shared = async (build: (ctx: PDFDocument['context'], S: PDFRef, pages: PDFPage[]) => void) => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const pages = [d.addPage([300, 300]), d.addPage([300, 300])];
    const S = d.context.nextRef();
    pages.forEach(p => p.node.set(PDFName.of('Resources'), S)); // addPage gives each page a dictionary of its own
    build(d.context, S, pages);
    return PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
  };
  const form = (ctx: PDFDocument['context'], body: string) => ctx.register(ctx.stream(body, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300] }));
  const saveOf = async (src: PDFDocument) => Buffer.from(await (await copyPruned(src, [0])).save({ useObjectStreams: false })).toString('latin1');

  it('a Type3 font set by an ExtGState /Font draws from the page\'s resources, and what its glyph draws is kept (R4-C-1)', async () => {
    const src = await shared((ctx, S, [p1, p2]) => {
      const proc = ctx.register(ctx.stream('1000 0 d0 /ImK Do'));
      const t3 = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1, 1], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: proc },
        Encoding: { Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1000] }));
      ctx.assign(S, ctx.obj({ Font: { T3: t3 }, XObject: { ImK: form(ctx, '0 0 9 9 re f % GLYPHKEPT'), Fm2: form(ctx, '0 0 9 9 re f % SECRETFORM') },
        ExtGState: { GS1: { Type: 'ExtGState', Font: [t3, 12] } } }));
      p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/GS1 gs BT 10 10 Td (a) Tj ET')));
      p2.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm2 Do /ImK Do')));
    });
    const out = await saveOf(src);
    expect(out.includes('GLYPHKEPT'), 'the form the glyph draws').toBe(true);
    expect(out.includes('SECRETFORM')).toBe(false);
  });

  it('a content stream\'s own /Resources is merged over the page\'s, as pdf.js reads it — what it draws is kept (R4-C-2)', async () => {
    const src = await shared((ctx, S, [p1, p2]) => {
      const im1 = form(ctx, '0 0 9 9 re f % KEPTVIACS');
      ctx.assign(S, ctx.obj({ XObject: { Im1: im1, Fm2: form(ctx, '0 0 9 9 re f % SECRETFORM') } }));
      const fm0 = form(ctx, '/Im1 Do');
      p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm0 Do', { Resources: { XObject: { Fm0: fm0 } } })));
      p2.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Fm2 Do /Im1 Do')));
    });
    const out = await saveOf(src);
    expect(out.includes('KEPTVIACS'), 'the form drawn through the content stream\'s resources').toBe(true);
    expect(out.includes('SECRETFORM')).toBe(false);
  });

  it('a kept widget\'s /DR keeps the font its /DA names and drops what only the removed page draws (R4-S-2)', async () => {
    const src = await routeShape('widgetDR');
    const out = await copyPruned(src, [0]);
    const widget = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
    const dr = widget.lookup(PDFName.of('DR'), PDFDict);
    expect(dr.lookup(PDFName.of('Font'), PDFDict).has(PDFName.of('F1')), 'the font /DA names').toBe(true);
    expect(dr.lookup(PDFName.of('XObject'), PDFDict).has(PDFName.of('Fm2')), 'the removed page\'s form').toBe(false);
  });

  it('a field\'s /DR keeps the font only its widget\'s /DA names — the /DA of every descendant counts', async () => {
    const out = await copyPruned(await routeShape('fieldDRKidDA'), [0]);
    const widget = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
    const dr = widget.lookup(PDFName.of('Parent'), PDFDict).lookup(PDFName.of('DR'), PDFDict);
    expect(dr.lookup(PDFName.of('Font'), PDFDict).has(PDFName.of('F1'))).toBe(true);
    expect(dr.lookup(PDFName.of('XObject'), PDFDict).has(PDFName.of('Fm2'))).toBe(false);
  });
});

describe('M1 round 5 — an owner is pruned only where it is drawn, and a legal font never refuses', () => {
  it('an inline Type3 font listed in its own UNSHARED resources exports and keeps what its glyph draws (R5-C-2)', async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    const ctx = d.context;
    const R = ctx.nextRef();
    const proc = ctx.register(ctx.stream('1000 0 d0 /G Do'));
    ctx.assign(R, ctx.obj({
      Font: { T3: { Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1, 1], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: proc },
        Encoding: { Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1000], Resources: R } },
      XObject: { G: ctx.register(ctx.stream('0 0 9 9 re f % GLYPHFORM', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 9, 9] })) },
    }));
    const [p1, p2] = [d.addPage([300, 300]), d.addPage([300, 300])];
    p1.node.set(PDFName.of('Resources'), R);
    p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('BT /T3 12 Tf 10 10 Td (a) Tj ET')));
    p2.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('0 0 9 9 re f')));
    const src = await PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
    const out = await copyPruned(src, [0]);
    expect(fileHas(await out.save({ useObjectStreams: false }), 'GLYPHFORM')).toBe(true);
  });

  it('a wrapper form the kept page DOES draw keeps the removed page\'s form it draws — the scan can see it (R5-S-1 control)', async () => {
    const src = await routeShape('unusedWrapperForm');
    src.getPage(0).node.set(PDFName.of('Contents'), src.context.register(src.context.stream('/Fm1 Do /FmA Do')));
    const dest = await PDFDocument.create({ updateMetadata: false });
    const { pages } = await copySourcePages(dest, src, [0], { pruneSharedResources: true });
    dest.addPage(pages[0]);
    expect(Buffer.from(await dest.save({ useObjectStreams: false })).toString('latin1').includes(ROUTE_SECRET)).toBe(true);
  });

  it('a pattern with no /XObject of its own draws the parent\'s /Fm2 — kept (R5-S-2 control)', async () => {
    const src = await routeShape('patternShadow');
    const pat = src.getPage(0).node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Pattern'), PDFDict).lookup(PDFName.of('P1')) as unknown as { dict: PDFDict };
    pat.dict.set(PDFName.of('Resources'), src.context.obj({ Font: {} }));
    const dest = await PDFDocument.create({ updateMetadata: false });
    const { pages } = await copySourcePages(dest, src, [0], { pruneSharedResources: true });
    dest.addPage(pages[0]);
    expect(Buffer.from(await dest.save({ useObjectStreams: false })).toString('latin1').includes(ROUTE_SECRET)).toBe(true);
  });
});
