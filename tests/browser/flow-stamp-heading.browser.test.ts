/**
 * Limits row 56 (real Chrome) — a rotated margin stamp must not take a heading rank. Built with pdf-lib and read back through
 * real pdf.js, exactly as the export does, so the stamp reaches `reconstructPage` in pdf.js's OWN rotated-item shape (not the
 * hand-built matrix of the jsdom suite). Measured on BERT/ResNet/Attention (`var/corpus`, gitignored): before, the 20pt
 * `arXiv:…` line was Heading 1 and the real title Heading 2; the oracle here is what was TYPED.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { reconstructPage, assignHeadings, type RawTextItem, type FontInfoMap, type FlowDoc } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function headings(opts: { stamp: boolean; allRotated?: boolean }): Promise<{ t: string; h: number }[]> {
  const { PDFDocument, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const rot = opts.allRotated ? { rotate: degrees(90) } : {};
  if (opts.allRotated) {
    page.drawText('A Real Paper Title', { x: 500, y: 100, size: 16, font, ...rot });
    for (let i = 0; i < 6; i++) page.drawText(`Language model pre-training has been shown to be effective, line ${i}`, { x: 470 - i * 14, y: 100, size: 10, font, ...rot });
  } else {
    page.drawText('A Real Paper Title', { x: 72, y: 740, size: 16, font });
    for (let i = 0; i < 6; i++) page.drawText(`Language model pre-training has been shown to be effective, line ${i}`, { x: 72, y: 700 - i * 14, size: 10, font });
    if (opts.stamp) page.drawText('arXiv:1810.04805v2 [cs.CL] 24 May 2019', { x: 32, y: 242, size: 20, font, rotate: degrees(90) });
  }
  const bytes = await doc.save();
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  try {
    const p = await pdf.getPage(1);
    const raw = ((await p.getTextContent()).items as unknown as RawTextItem[]).filter(i => typeof i.str === 'string');
    const vp = p.getViewport({ scale: 1, rotation: 0 });
    const flow: FlowDoc = { pages: [reconstructPage(raw, {} as FontInfoMap, vp.width, vp.height)] };
    assignHeadings(flow);
    return flow.pages[0].paragraphs.map(pp => ({ t: pp.runs.map(r => r.text).join(''), h: pp.heading }));
  } finally {
    await pdf.loadingTask.destroy();
  }
}

describe('row 56 — a rotated stamp takes no heading rank (real pdf.js items)', () => {
  it('the typed title is Heading 1 and the arXiv stamp is body text', async () => {
    const out = await headings({ stamp: true });
    expect(out.find(p => p.t.startsWith('A Real Paper'))?.h).toBe(1);
    expect(out.find(p => p.t.startsWith('arXiv:'))?.h).toBe(0);
  });

  it('control: without a stamp the title is Heading 1 as before', async () => {
    expect((await headings({ stamp: false })).find(p => p.t.startsWith('A Real Paper'))?.h).toBe(1);
  });

  it('control: a page whose text is ALL rotated keeps its heading', async () => {
    expect((await headings({ stamp: false, allRotated: true })).find(p => p.t.startsWith('A Real Paper'))?.h).toBe(1);
  });
});
