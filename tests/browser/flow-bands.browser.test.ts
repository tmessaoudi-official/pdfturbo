/**
 * Limits row 44 (real Chrome) — a title or a figure caption spanning both columns must not leave the page one interleaved
 * column. Measured on BERT p1, 3, 5, 6 and ResNet p1, 5, 8, 11 (`article-*-2col.pdf`, gitignored — CI cannot see them):
 * the spanning block covers the gutter, so no vertical cut existed for the whole page.
 *
 * Built with pdf-lib and read back through real pdf.js, exactly as the export does (the item `size` comes from the real
 * transform, which the band cut reads). The oracle is what was TYPED: `T-` title, `A-`/`B-` the left/right column of the
 * upper block, `CAP-` the caption, `C-`/`D-` the left/right column of the lower block. Lines are JUSTIFIED to the column
 * edge — a ragged fixture leaves gaps a short word never blocks and mirrors the detector's own assumption.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { reconstructPage, type RawTextItem, type FontInfoMap } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function paragraphs(opts: { caption: boolean }): Promise<string[]> {
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
  const col = (x: number, w: number, tag: string, y0: number, n: number) => {
    for (let i = 0; i < n; i++) page.drawText(fill(`${tag}-${String(i + 1).padStart(2, '0')}`, w, i), { x, y: y0 - i * 12, size: 10, font });
  };
  page.drawText('T-01 A Centred Title', { x: 230, y: 750, size: 16, font });
  page.drawText('T-02 and its authors', { x: 240, y: 726, size: 12, font });
  col(58.5, 228, 'A', 680, 12); col(308.9, 236, 'B', 680, 12);
  if (opts.caption) { col(58.5, 486, 'CAP', 520, 2); }
  col(58.5, 228, 'C', opts.caption ? 470 : 520, 14); col(308.9, 236, 'D', opts.caption ? 470 : 520, 14);
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

describe('row 44 — a spanning title or caption cuts the page into bands before the columns', () => {
  it('title, then each column in full, then the next column — no paragraph mixes the columns', async () => {
    const paras = await paragraphs({ caption: false });
    const at = (tag: string) => paras.findIndex(t => t.includes(`${tag}-01`));
    for (const t of paras) expect(/A-\d\d/.test(t) && /B-\d\d/.test(t)).toBe(false);
    expect(at('T')).toBe(0);
    // the upper block: all of A is read before any of B; the lower block likewise, and the upper block before the lower
    const last = (tag: string) => paras.map(t => new RegExp(`${tag}-\\d\\d`).test(t)).lastIndexOf(true);
    expect(last('A')).toBeLessThan(at('B'));
    expect(last('B')).toBeLessThan(at('C'));
    expect(last('C')).toBeLessThan(at('D'));
  });

  it('with a full-width caption between two column bands: A, B, the caption, then C, D', async () => {
    const paras = await paragraphs({ caption: true });
    const at = (tag: string) => paras.findIndex(t => t.includes(`${tag}-01`));
    const last = (tag: string) => paras.map(t => new RegExp(`${tag}-\\d\\d`).test(t)).lastIndexOf(true);
    expect(last('A')).toBeLessThan(at('B'));
    expect(last('B')).toBeLessThan(at('CAP'));
    expect(last('CAP')).toBeLessThan(at('C'));
    expect(last('C')).toBeLessThan(at('D'));
    const all = paras.join(' ');
    for (const k of ['A-01', 'A-12', 'B-12', 'CAP-02', 'C-14', 'D-14']) expect(all.split(`${k} `).length - 1).toBe(1);
  });
});
