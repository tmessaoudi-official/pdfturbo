/**
 * Limits row 46 (real Chrome) — a three-column body with ~9pt gutters (Publication 17's layout) must reconstruct column by
 * column, while a short label column beside its content (GPT-3's prompt examples) must not be split off.
 *
 * Built with pdf-lib and read back through real pdf.js, as the export does. Columns are JUSTIFIED — every line runs to the
 * column edge — so the only gap is the gutter; lines a third that long would leave a wide gap that splits under any floor
 * and could not see the narrow-gutter rule (the fixture-mirrors-detector trap, rows 21 and 45). The oracle is what was
 * TYPED: each line starts `A-`, `B-` or `C-`, so a paragraph holding two letters is an interleave.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { reconstructPage, type RawTextItem, type FontInfoMap } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type Col = { x: number; w: number; tag: string; lines: number; justified: boolean };

async function paragraphs(cols: Col[]): Promise<string[]> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pool = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu'];
  const fill = (prefix: string, maxW: number, seed: number): string => {
    let t = prefix, k = seed;
    for (;;) {
      const next = `${t} ${pool[k++ % pool.length]}`;
      if (font.widthOfTextAtSize(next, 10) > maxW) return t;
      t = next;
    }
  };
  cols.forEach((c, ci) => {
    for (let i = 0; i < c.lines; i++) {
      const text = c.justified ? fill(`${c.tag}-${String(i + 1).padStart(2, '0')}`, c.w, i + ci * 3) : `${c.tag}-${String(i + 1).padStart(2, '0')}`;
      page.drawText(text, { x: c.x, y: 700 - i * 12, size: 10, font });
    }
  });
  const bytes = await doc.save();
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  try {
    const p = await pdf.getPage(1);
    const raw = ((await p.getTextContent()).items as unknown as RawTextItem[]).filter(i => typeof i.str === 'string');
    const vp = p.getViewport({ scale: 1, rotation: 0 });
    return reconstructPage(raw, {} as FontInfoMap, vp.width, vp.height).paragraphs.map(pp => pp.runs.map(r => r.text).join(''));
  } finally {
    await pdf.loadingTask.destroy();
  }
}

describe('row 46 — a narrow gutter splits between body blocks only', () => {
  it('three justified body columns 9pt apart: no paragraph mixes two columns, A then B then C', async () => {
    const paras = await paragraphs([
      { x: 36, w: 168, tag: 'A', lines: 40, justified: true },
      { x: 213, w: 168, tag: 'B', lines: 40, justified: true },
      { x: 390, w: 168, tag: 'C', lines: 40, justified: true },
    ]);
    const tags = paras.map(t => ['A-', 'B-', 'C-'].filter(k => t.includes(k)));
    expect(tags.every(k => k.length <= 1)).toBe(true);
    const last = (k: string) => paras.map(t => t.includes(k)).lastIndexOf(true);
    const first = (k: string) => paras.findIndex(t => t.includes(k));
    expect(last('A-')).toBeGreaterThanOrEqual(0);
    expect(first('B-')).toBeGreaterThan(last('A-'));
    expect(first('C-')).toBeGreaterThan(last('B-'));
  });

  it('control: a short label column beside justified content is NOT split off (rows read across)', async () => {
    const paras = await paragraphs([
      // The label lines must RUN to their column edge, like GPT-3's: a bare `A-01` leaves an ~80pt gap that splits under any floor.
      { x: 36, w: 94, tag: 'A', lines: 12, justified: true },
      { x: 138, w: 400, tag: 'B', lines: 40, justified: true },
    ]);
    expect(paras.some(t => t.includes('A-01') && t.includes('B-01'))).toBe(true);
  });
});
