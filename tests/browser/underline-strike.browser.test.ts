/**
 * Underline/strikethrough end-to-end (real Chrome, Gap b): build a PDF with an
 * underlined word and a struck word via pdf-lib, extract the REAL pdf.js v6
 * op-list (rules) + text items exactly as exportService does, run reconstructPage,
 * and assert the produced FlowRuns carry underline/strikethrough — then that the
 * DOCX XML emits <w:u>/<w:strike>. jsdom can't run getOperatorList/getTextContent.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { reconstructPage, type RawTextItem, type RuleRect, type FontInfoMap } from '../../src/utils/flowDoc';
import { flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function unpackDocx(b64: string): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

describe('underline/strike extraction (real Chrome)', () => {
  it('detects an underline and a strikethrough from real pdf.js path ops', async () => {
    const { PDFDocument, rgb, StandardFonts } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // Underlined word near the top, struck word lower down (well separated so a
    // rule can only match its own word vertically).
    page.drawText('Under', { x: 50, y: 150, size: 20, font, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: 50, y: 146, width: 52, height: 1.2, color: rgb(0, 0, 0) }); // underline
    page.drawText('Struck', { x: 50, y: 100, size: 20, font, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: 50, y: 106, width: 60, height: 1.2, color: rgb(0, 0, 0) }); // strike (mid x-height)
    const bytes = await doc.save();

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const p = await pdf.getPage(1);
    const opList = await p.getOperatorList();
    const OPS = pdfjsLib.OPS as unknown as Record<string, number>;

    // Replicate exportService's CTM-tracking rule extraction.
    type Ctm = [number, number, number, number, number, number];
    const stack: Ctm[] = [];
    let ctm: Ctm = [1, 0, 0, 1, 0, 0];
    const rules: RuleRect[] = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i] as unknown[];
      if (fn === OPS['save']) stack.push([...ctm] as Ctm);
      else if (fn === OPS['restore']) { const prev = stack.pop(); if (prev) ctm = prev; }
      else if (fn === OPS['transform']) {
        const [a, b, c, d, e, f] = args as number[];
        ctm = [ctm[0]*a+ctm[2]*b, ctm[1]*a+ctm[3]*b, ctm[0]*c+ctm[2]*d, ctm[1]*c+ctm[3]*d, ctm[0]*e+ctm[2]*f+ctm[4], ctm[1]*e+ctm[3]*f+ctm[5]];
      } else if (fn === OPS['constructPath']) {
        const paintOp = Number(args[0]);
        const isFill = paintOp === OPS['fill'] || paintOp === OPS['eoFill'];
        const mm = args[2] as Record<number, number> | undefined;
        if (mm && isFill) {
          const corners: Array<[number, number]> = [[mm[0], mm[1]], [mm[2], mm[1]], [mm[2], mm[3]], [mm[0], mm[3]]];
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const [lx, ly] of corners) {
            const dx = ctm[0]*lx + ctm[2]*ly + ctm[4];
            const dy = ctm[1]*lx + ctm[3]*ly + ctm[5];
            if (dx < minX) minX = dx; if (dx > maxX) maxX = dx;
            if (dy < minY) minY = dy; if (dy > maxY) maxY = dy;
          }
          const rw = maxX - minX, rh = maxY - minY;
          if (rw > 2 && rh < 8 && rw > rh * 3) rules.push({ x: minX, y: minY, width: rw, height: rh });
        }
      }
    }
    expect(rules.length).toBe(2);

    const content = await p.getTextContent();
    const items = content.items as unknown as RawTextItem[];
    const flowPage = reconstructPage(items, {} as FontInfoMap, 300, 200, undefined, undefined, undefined, rules);

    const allRuns = flowPage.paragraphs.flatMap((pp) => pp.runs);
    const under = allRuns.find((r) => r.text.includes('Under'));
    const struck = allRuns.find((r) => r.text.includes('Struck'));
    expect(under?.underline).toBe(true);
    expect(struck?.strikethrough).toBe(true);

    const xml = await unpackDocx(await flowDocToDocxBase64({ pages: [flowPage] }));
    expect(xml).toContain('<w:u ');
    expect(xml).toContain('<w:strike');
  });
});
