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
import { describe, it, expect } from 'vitest';
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

describe('the assembled export — SEC-1 through _assemblePdfDoc', () => {
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
