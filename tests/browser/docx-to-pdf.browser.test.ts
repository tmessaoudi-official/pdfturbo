/**
 * DOCX→PDF (#1d) end-to-end, real Chrome. The renderer runs in jsdom too, but only a
 * real browser + pdf.js can confirm the produced PDF carries SELECTABLE text in reading
 * order (StandardFonts WinAnsi). Asserts run text order and accented-French fidelity.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { docModelToPdfBytes } from '../../src/docx/docxToPdf';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function textOf(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  try {
    let out = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const c = await page.getTextContent();
      out += (c.items as Array<{ str?: string }>).map(item => item.str ?? '').join(' ');
    }
    return out;
  } finally {
    await doc.loadingTask?.destroy?.();
  }
}

describe('docModelToPdfBytes (real Chrome, #1d)', () => {
  it('renders run text in reading order, selectable via pdf.js', async () => {
    const paras = [
      { runs: [{ text: 'Alpha ' }, { text: 'Bravo', bold: true }] },
      { runs: [{ text: 'Charlie Delta' }] },
    ];
    const { bytes } = await docModelToPdfBytes({
      blocks: paras,
      paragraphs: paras,
    });
    const text = await textOf(bytes);
    expect(text).toContain('Alpha');
    expect(text).toContain('Bravo');
    expect(text).toContain('Charlie');
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Charlie'));
  });

  it('keeps accented French intact (WinAnsi)', async () => {
    const paras = [{ runs: [{ text: 'éàçùê — déjà vu' }] }];
    const { bytes, hadUnsupportedChars } = await docModelToPdfBytes({
      blocks: paras,
      paragraphs: paras,
    });
    expect(hadUnsupportedChars).toBe(false);
    expect(await textOf(bytes)).toContain('déjà');
  });

  it('renders heading text and list markers (Workstream A fidelity)', async () => {
    const blocks = [
      { heading: 1 as const, runs: [{ text: 'BigTitle' }] },
      { list: { ordered: true, level: 0 }, runs: [{ text: 'alpha' }] },
      { list: { ordered: true, level: 0 }, runs: [{ text: 'beta' }] },
      { list: { ordered: false, level: 0 }, runs: [{ text: 'gamma' }] },
    ];
    const { bytes } = await docModelToPdfBytes({ blocks, paragraphs: blocks });
    const text = await textOf(bytes);
    expect(text).toContain('BigTitle');
    // Ordered markers count up; the unordered item gets a bullet.
    expect(text).toContain('1.');
    expect(text).toContain('2.');
    expect(text).toContain('•');
    // Reading order: title before list items.
    expect(text.indexOf('BigTitle')).toBeLessThan(text.indexOf('alpha'));
  });

  it('renders TABLE cell text (not silently dropped — #1d table fix)', async () => {
    // Regression: tables used to be omitted from the PDF export entirely. Now the
    // grid renders and every cell's text must be selectable, in row-major order.
    const c = (text: string) => ({ blocks: [{ runs: [{ text }] }] });
    const cap = { runs: [{ text: 'After table' }] };
    const t = {
      kind: 'table' as const,
      rows: [
        { cells: [c('Item'), c('Qty')] },
        { cells: [c('Widget'), c('42')] },
      ],
    };
    const { bytes } = await docModelToPdfBytes({ blocks: [t, cap], paragraphs: [cap] });
    const text = await textOf(bytes);
    for (const cell of ['Item', 'Qty', 'Widget', '42', 'After table']) {
      expect(text).toContain(cell);
    }
    // header cell precedes data cell precedes the trailing paragraph (reading order)
    expect(text.indexOf('Item')).toBeLessThan(text.indexOf('Widget'));
    expect(text.indexOf('Widget')).toBeLessThan(text.indexOf('After table'));
  });
});
