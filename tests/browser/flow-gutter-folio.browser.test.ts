/**
 * Limits row 45 (real Chrome) — a two-column page whose centred PAGE NUMBER sits in the gutter must still reconstruct
 * column by column. Measured on ResNet (`article-resnet-2col.pdf`, gitignored — CI cannot see it): the columns end at
 * 286.4 and start at 308.9 (a 22.5pt gutter), and the folio `2` sits at x 295.1–300.1, y 51. One item of 175 left a clean
 * gap of ~9pt, under the 10pt floor, so no page split and every line interleaved across the columns.
 *
 * Built with pdf-lib and read back through real pdf.js, exactly as the export does. The oracle is what was TYPED: left
 * lines start `LEFT-`, right lines `RIGHT-`, so a paragraph holding both is an interleave, and the left column must be
 * read in full before the right one.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { reconstructPage, type RawTextItem, type FontInfoMap } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function paragraphs(opts: { folio: boolean }): Promise<string[]> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Real columns are JUSTIFIED: every line runs to the column edge (286.4 on the left, 545.1 on the right), so the only
  // gap is the 22.5pt gutter. Lines a third that long would leave a ~100pt gap a page number cannot block — a fixture
  // that mirrors the detector's own assumption and cannot see the defect (found by sabotage: the case stayed green).
  const pool = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu'];
  const fill = (prefix: string, maxW: number, seed: number): string => {
    let t = prefix, k = seed;
    for (;;) {
      const next = `${t} ${pool[k++ % pool.length]}`;
      if (font.widthOfTextAtSize(next, 10) > maxW) return t;
      t = next;
    }
  };
  for (let i = 0; i < 40; i++) {
    const n = String(i + 1).padStart(2, '0');
    page.drawText(fill(`LEFT-${n}`, 228, i), { x: 58.5, y: 700 - i * 12, size: 10, font });
    page.drawText(fill(`RIGHT-${n}`, 236, i + 3), { x: 308.9, y: 700 - i * 12, size: 10, font });
  }
  if (opts.folio) page.drawText('2', { x: 295.1, y: 51, size: 10, font }); // centred in the gutter, bottom edge
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

describe('row 45 — a page number in the gutter does not stop the column split', () => {
  for (const folio of [false, true]) {
    it(`${folio ? 'with' : 'without'} a centred page number: no paragraph mixes the columns, left is read before right`, async () => {
      const paras = await paragraphs({ folio });
      expect(paras.some(t => t.includes('LEFT-') && t.includes('RIGHT-'))).toBe(false);
      const lastLeft = paras.map(t => t.includes('LEFT-')).lastIndexOf(true);
      const firstRight = paras.findIndex(t => t.includes('RIGHT-'));
      expect(lastLeft).toBeGreaterThanOrEqual(0);
      expect(firstRight).toBeGreaterThan(lastLeft);
      // every typed line survives exactly once
      const all = paras.join(' ');
      for (const n of ['01', '20', '40']) {
        expect(all.split(`LEFT-${n} `).length - 1).toBe(1);
        expect(all.split(`RIGHT-${n} `).length - 1).toBe(1);
      }
      if (folio) expect(all.split(/\s2(\s|$)/).length - 1).toBeGreaterThanOrEqual(1);
    });
  }
});
