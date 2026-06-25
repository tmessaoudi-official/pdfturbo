/**
 * B1 — tagged-PDF struct-tree exact-replace, end-to-end in real Chrome.
 *
 * jsdom can't run pdf.js `getStructTree()` / `getTextContent({includeMarkedContent})`
 * on a real PDF, so this proves the correlation the sub-spike confirmed actually
 * holds through the production extraction path: fetch a genuine TAGGED PDF, pull
 * the struct tree + the marked-content item stream exactly as exportService does,
 * feed reconstructPage the `struct` argument, and assert the DOCX gets its heading
 * and a real Word table straight from the tags. A second case proves an UNTAGGED
 * PDF (no struct tree) is byte-identical whether or not the struct arg is passed —
 * the regression guard for the ~85% of files that aren't tagged.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import taggedPdfUrl from '../fixtures/corpus-public/w3c-accessible-table.pdf?url';
import {
  reconstructPage, assignHeadings,
  type RawTextItem, type FontInfoMap, type MarkedContentMarker, type StructTreeNodeLike,
} from '../../src/utils/flowDoc';
import { flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function unpackDocxXml(b64: string): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

describe('Tagged PDF → DOCX via struct tree (real Chrome)', () => {
  it('derives heading + table structure from the tags', async () => {
    const data = new Uint8Array(await (await fetch(taggedPdfUrl)).arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const [content, marked, tree] = await Promise.all([
      page.getTextContent(),
      page.getTextContent({ includeMarkedContent: true }),
      page.getStructTree(),
    ]);
    const items = content.items as unknown as RawTextItem[];
    const markedItems = marked.items as unknown as Array<RawTextItem | MarkedContentMarker>;
    const vp = page.getViewport({ scale: 1 });

    const flowPage = reconstructPage(
      items, {} as FontInfoMap, vp.width, vp.height,
      undefined, undefined, undefined, undefined, 0, undefined,
      { tree: tree as unknown as StructTreeNodeLike, markedItems },
    );

    // The struct path engaged.
    expect(flowPage.tagged).toBe(true);
    // The H1 tag became a heading-1 paragraph carrying the document title.
    const h1s = flowPage.paragraphs.filter(p => p.heading === 1).map(p => p.runs.map(r => r.text).join(''));
    expect(h1s.some(h => /Example table/i.test(h))).toBe(true);
    // The Table tag produced at least one FlowTable with real cell text.
    expect((flowPage.tables ?? []).length).toBeGreaterThan(0);
    const grid = (flowPage.tables ?? [])[0].grid;
    expect(grid.rows).toBeGreaterThanOrEqual(2);
    expect(grid.cols).toBeGreaterThanOrEqual(2);

    // assignHeadings must NOT clobber the tag-derived levels on a tagged page.
    const doc = { pages: [flowPage] };
    assignHeadings(doc);
    expect(flowPage.paragraphs.filter(p => p.heading === 1).length).toBe(h1s.length);

    // The DOCX carries the title and a real Word table element.
    const xml = await unpackDocxXml(await flowDocToDocxBase64(doc));
    expect(xml).toContain('Example table');
    expect(xml).toMatch(/<w:tbl>/);
  });

  it('is byte-identical for an UNTAGGED PDF whether or not the struct arg is passed', async () => {
    const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
    const src = await PDFDocument.create();
    const font = await src.embedFont(StandardFonts.Helvetica);
    const p = src.addPage([400, 200]);
    p.drawText('Plain untagged paragraph one.', { x: 40, y: 150, size: 12, font });
    p.drawText('Second line of body text here.', { x: 40, y: 120, size: 12, font });
    const bytes = await src.save();

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const [content, marked, tree] = await Promise.all([
      page.getTextContent(),
      page.getTextContent({ includeMarkedContent: true }),
      page.getStructTree(),
    ]);
    const items = content.items as unknown as RawTextItem[];
    const markedItems = marked.items as unknown as Array<RawTextItem | MarkedContentMarker>;
    const vp = page.getViewport({ scale: 1 });

    const withoutStruct = reconstructPage(items, {} as FontInfoMap, vp.width, vp.height);
    const withStruct = reconstructPage(
      items, {} as FontInfoMap, vp.width, vp.height,
      undefined, undefined, undefined, undefined, 0, undefined,
      { tree: tree as unknown as StructTreeNodeLike, markedItems },
    );

    expect(withStruct.tagged).toBeUndefined(); // untagged → struct path did not engage
    expect(withStruct).toEqual(withoutStruct); // byte-identical fallback
  });
});
