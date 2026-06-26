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

// Feature 5 — fonts + merged cells + images.
describe('docModelToPdfBytes fidelity (Feature 5, real Chrome)', () => {
  // 2×2 opaque red PNG (base64).
  const dataB64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD8GO2jAAAAD0lEQVR42mP8z8BQz0AEAAUDAQGc8sJEAAAAAElFTkSuQmCC';

  async function page1Ops(bytes: Uint8Array): Promise<number[]> {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const p = await doc.getPage(1);
    const list = await p.getOperatorList();
    return Array.from(list.fnArray as number[]);
  }

  function isPaintImage(fn: number): boolean {
    return fn === pdfjsLib.OPS.paintImageXObject
      || fn === pdfjsLib.OPS.paintImageXObjectRepeat
      || fn === pdfjsLib.OPS.paintInlineImageXObject;
  }
  async function countPaintImage(bytes: Uint8Array): Promise<number> {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    let n = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const list = await (await doc.getPage(i)).getOperatorList();
      n += Array.from(list.fnArray as number[]).filter(isPaintImage).length;
    }
    return n;
  }
  // On-page image width = the |a| component of the `transform` (cm) op pdf-lib emits before Do.
  async function paintedImageWidth(bytes: Uint8Array): Promise<number> {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const p = await doc.getPage(1);
    const list = await p.getOperatorList();
    const fns = list.fnArray as number[];
    const args = list.argsArray as Array<unknown[]>;
    let w = 0;
    for (let i = 0; i < fns.length; i++) {
      if (fns[i] === pdfjsLib.OPS.transform) {
        const a = Math.abs(Number((args[i] as number[])[0]));
        if (Number.isFinite(a)) w = Math.max(w, a);
      }
    }
    return w;
  }

  // A DocImageBlock carrying the image data is now the source of truth (no { images } channel).
  const imageBlock = (widthPt: number): { kind: 'image'; image: { dataB64: string; mime: 'image/png'; widthPt: number; heightPt: number }; anchorId: number } =>
    ({ kind: 'image', image: { dataB64, mime: 'image/png', widthPt, heightPt: widthPt }, anchorId: 0 });

  it('renders an image from a DocImageBlock (live model, no { images } channel)', async () => {
    const para = { runs: [{ text: 'Figure below:' }] };
    const { bytes } = await docModelToPdfBytes({ blocks: [para, imageBlock(80)], paragraphs: [para] });
    const ops = await page1Ops(bytes);
    expect(ops.some(isPaintImage)).toBe(true);
  });

  it('omits a deleted image (block absent → no paintImageXObject)', async () => {
    const para = { runs: [{ text: 'Figure below:' }] };
    const { bytes } = await docModelToPdfBytes({ blocks: [para], paragraphs: [para] });
    expect(await countPaintImage(bytes)).toBe(0);
  });

  it('reflects a resized image block (larger widthPt → wider painted image)', async () => {
    const para = { runs: [{ text: 'Figure below:' }] };
    const small = await docModelToPdfBytes({ blocks: [para, imageBlock(60)], paragraphs: [para] });
    const large = await docModelToPdfBytes({ blocks: [para, imageBlock(200)], paragraphs: [para] });
    expect(await paintedImageWidth(large.bytes)).toBeGreaterThan(await paintedImageWidth(small.bytes));
  });

  it('renders a colspan=2 header spanning both columns (reading order preserved)', async () => {
    const headerCell = { blocks: [{ runs: [{ text: 'Merged Header' }] }], colspan: 2 };
    const t = {
      kind: 'table' as const,
      rows: [
        { cells: [headerCell] },
        { cells: [{ blocks: [{ runs: [{ text: 'Left' }] }] }, { blocks: [{ runs: [{ text: 'Right' }] }] }] },
      ],
    };
    const { bytes } = await docModelToPdfBytes({ blocks: [t], paragraphs: [] });
    const text = await textOf(bytes);
    expect(text).toContain('Merged Header');
    expect(text).toContain('Left');
    expect(text).toContain('Right');
    expect(text.indexOf('Merged Header')).toBeLessThan(text.indexOf('Left'));
  });

  it('renders a serif run without error and stays selectable', async () => {
    const para = { runs: [{ text: 'Serif sample', fontFamily: 'Times New Roman' }] };
    const { bytes } = await docModelToPdfBytes({ blocks: [para], paragraphs: [para] });
    expect(await textOf(bytes)).toContain('Serif sample');
  });
});
