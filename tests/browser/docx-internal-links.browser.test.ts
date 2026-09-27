/**
 * Limits row 22 (D11, real pdf.js) — a PDF's internal links reach Word and Markdown as links to bookmarks.
 *
 * The document is built with pdf-lib: page 1 carries three GoTo links (an explicit `/XYZ` destination, a NAMED one
 * and a reference to no object), page 2 is the named target and page 3 the explicit one — on a CropBox with an
 * origin, so a view top left in absolute user space would land on the paragraph above. Everything goes through the
 * export's own `_extractFlowDoc` and the real writers.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { type FlowDoc } from '../../src/utils/flowDoc';
import { flowDocToDocxBase64, flowDocToMarkdown } from '../../src/utils/flowDocWriters';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { DocumentPage } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const CROP_Y = 100; // page 3's CropBox starts 100pt up

async function build(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, PDFName, PDFRef, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const [p1, p2, p3] = [doc.addPage([612, 792]), doc.addPage([612, 792]), doc.addPage([612, 792])];
  const line = (pg: typeof p1, text: string, y: number) => pg.drawText(text, { x: 72, y, size: 12, font });
  const x0 = 72 + font.widthOfTextAtSize('See ', 12);

  // The linked word is its own text item, as hyperref and Word draw a link: word tagging goes by item centre, the
  // same for external links (a link covering part of a single item tags the whole item or none of it).
  const linkedLine = (word: string, rest: string, y: number) => {
    p1.drawText('See ', { x: 72, y, size: 12, font });
    p1.drawText(word, { x: x0, y, size: 12, font, color: rgb(0, 0, 0.8) });
    p1.drawText(rest, { x: x0 + font.widthOfTextAtSize(word, 12), y, size: 12, font });
  };
  line(p1, 'Contents', 740);
  linkedLine('Methods', ' for the setup.', 700);
  linkedLine('Results', ' for the numbers.', 660);
  linkedLine('Nowhere', ' for nothing.', 620);
  line(p2, 'Filler paragraph on page two.', 700);
  line(p2, 'Results', 520);
  line(p2, 'The numbers were good.', 500);
  p3.setCropBox(0, CROP_Y, 612, 792 - CROP_Y);
  line(p3, 'Before the section.', 760);
  line(p3, 'Methods', 700);
  line(p3, 'We measured things.', 680);

  const ctx = doc.context;
  const rect = (word: string, y: number) => [x0 - 1, y - 3, x0 + font.widthOfTextAtSize(word, 12) + 1, y + 11];
  const link = (word: string, y: number, dest: unknown) =>
    ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect(word, y), Border: [0, 0, 0], Dest: dest } as never));
  p1.node.set(PDFName.of('Annots'), ctx.obj([
    // Explicit: page 3, view top on the Methods line's top edge (absolute user space).
    link('Methods', 700, [p3.ref, 'XYZ', null, 712, null]),
    // Named, through the catalog's /Dests dictionary.
    link('Results', 660, 'Results'),
    // A reference to an object that does not exist.
    link('Nowhere', 620, [PDFRef.of(999), 'Fit']),
  ] as never));
  doc.catalog.set(PDFName.of('Dests'), ctx.obj({ Results: [p2.ref, 'XYZ', null, 534, null] } as never));
  return doc.save();
}

const loud = {
  info() {}, silent(_e?: unknown, msg?: string) { throw new Error(`export reported: ${msg}`); },
  warn(k: string) { throw new Error(`export warned: ${k}`); },
  error(k: string, e?: unknown) { throw new Error(`export errored: ${k} ${String(e)}`); },
} as unknown as IErrorReporter;

async function exported(pageNums: number[]): Promise<FlowDoc> {
  const bytes = await build();
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  try {
    const pages = pageNums.map(n => ({ id: `p${n}`, sourcePdfId: 's1', sourcePageNum: n, rotation: 0 }) as DocumentPage);
    const svc = new ExportService({
      documentModel: { pages, sourcePdfs: new Map([['s1', { doc, bytes }]]) }, elements: [], reportError: loud,
    } as unknown as IExportContext) as unknown as { _extractFlowDoc(): Promise<FlowDoc> };
    return await svc._extractFlowDoc();
  } finally {
    await doc.loadingTask.destroy();
  }
}

const textOf = (p: FlowDoc['pages'][number]['paragraphs'][number]) => p.runs.map(r => r.text).join('').trim();

async function docxXml(doc: FlowDoc): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const b64 = await flowDocToDocxBase64(doc);
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return strFromU8(unzipSync(u8)['word/document.xml']);
}

describe('internal links → bookmarks (limits row 22)', () => {
  it('each link names the bookmark on its target paragraph — explicit /XYZ on a cropped page, and a named destination', async () => {
    const flow = await exported([1, 2, 3]);
    const bookmarked = flow.pages.flatMap(p => p.paragraphs).filter(p => p.bookmark).map(p => [textOf(p), p.bookmark]);
    const anchorOf = (word: string) => flow.pages[0].paragraphs.flatMap(p => p.runs).find(r => r.text.includes(word))?.linkAnchor;
    // Methods is page 3's second line: a view top left in absolute space (712) would pick "Before the section." above it.
    expect(new Map(bookmarked as [string, string][]).get('Methods')).toBe(anchorOf('Methods'));
    expect(new Map(bookmarked as [string, string][]).get('Results')).toBe(anchorOf('Results'));
    expect(bookmarked).toHaveLength(2);
    // The dangling reference is dropped as a link and kept as text.
    expect(anchorOf('Nowhere')).toBeUndefined();
    expect(flow.pages[0].paragraphs.map(textOf).join(' ')).toContain('See Nowhere for nothing.');
  });

  it('Word gets hyperlinks to bookmarks; Markdown gets (#…) links to anchors', async () => {
    const flow = await exported([1, 2, 3]);
    const methods = flow.pages.flatMap(p => p.paragraphs).find(p => textOf(p) === 'Methods')?.bookmark as string;
    expect(methods).toBeDefined();
    const xml = await docxXml(flow);
    expect(xml).toMatch(new RegExp(`<w:hyperlink [^>]*w:anchor="${methods}"`));
    expect(xml).toMatch(new RegExp(`<w:bookmarkStart [^>]*w:name="${methods}"`));
    const md = flowDocToMarkdown(flow);
    expect(md).toContain(`[Methods](#${methods})`);
    expect(md).toContain(`<a id="${methods}"></a>Methods`);
  });

  it('a link whose target page is not in the export stays plain text', async () => {
    const flow = await exported([1, 2]); // page 3 deleted
    const runs = flow.pages[0].paragraphs.flatMap(p => p.runs);
    expect(runs.find(r => r.text.includes('Methods'))?.linkAnchor).toBeUndefined();
    expect(runs.find(r => r.text.includes('Results'))?.linkAnchor).toBeDefined();
    const md = flowDocToMarkdown(flow);
    expect(md).toContain('See Methods for the setup.');
    expect(md).toContain('[Results](#');
  });
});
