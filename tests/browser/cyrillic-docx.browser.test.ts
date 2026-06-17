/**
 * #2 (2026-06-17) — full-chain Cyrillic source→DOCX (real Chrome). Build a PDF with
 * Cyrillic text in an embedded Cyrillic-capable font (LiberationSans), extract it
 * with REAL pdf.js getTextContent exactly as exportService does, run reconstructPage,
 * emit DOCX, and assert the Cyrillic survives verbatim.
 *
 * jsdom can't run getTextContent on an embedded-font PDF; the jsdom guard
 * (tests/utils/flowDocCjkCyrillic.test.ts) covers the writer/reconstruct side with
 * synthetic items — this proves the EXTRACTION layer carries non-Latin, non-Arabic
 * Unicode through the whole pipeline too. (CJK can't be exercised the same way: no
 * CJK font is vendored to embed; the writer-side CJK guard lives in the jsdom test.)
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import fontkit from '@pdf-lib/fontkit';
import fontUrl from 'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?url';
import { reconstructPage, type RawTextItem, type FontInfoMap } from '../../src/utils/flowDoc';
import { flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const WORDS = ['Привет', 'документа']; // Russian words drawn into the source PDF

async function unpackDocx(b64: string): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

describe('Cyrillic source PDF → DOCX (real Chrome)', () => {
  it('extracts embedded-font Cyrillic via real pdf.js and preserves it in the DOCX', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const ttf = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(ttf, { subset: true });
    const page = doc.addPage([400, 200]);
    page.drawText('Привет мир документа', { x: 40, y: 150, size: 20, font });
    const bytes = await doc.save();

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const p = await pdf.getPage(1);
    const content = await p.getTextContent();
    const items = content.items as unknown as RawTextItem[];

    // Sanity: real pdf.js extraction returned Cyrillic Unicode (not garbage/empty).
    const extracted = items.map((item) => item.str).join('');
    for (const w of WORDS) expect(extracted).toContain(w);

    const flowPage = reconstructPage(items, {} as FontInfoMap, 400, 200);
    const xml = await unpackDocx(await flowDocToDocxBase64({ pages: [flowPage] }));
    for (const w of WORDS) expect(xml).toContain(w);
  });
});
