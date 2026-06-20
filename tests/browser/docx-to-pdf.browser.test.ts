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
});
