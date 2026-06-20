/**
 * Slice B — true-PDF restyle font-substitution, real-Chrome guard. jsdom covers the
 * return-value contract with constructed fixtures and the handler's toast wiring;
 * this proves the contract against a REAL pdf.js render: an embedded (subset, no
 * ToUnicode) font redrawn in a base-14 substitute reports 'substituted' AND the
 * redrawn text is real, extractable PDF text — while a plain standard-font edit
 * keeps the font and reports plain `true` (no false substitution alarm).
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, StandardFonts } from '@cantoo/pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { replaceTextAt } from '../../src/utils/contentStreamEditor';

// Real pdf.js worker (the text-extraction assertions read the redrawn text back).
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

/** A page drawing a literal glyph-code string with a SUBSET TrueType font (BaseFont
 *  `ABCDEF+…`) and NO ToUnicode at origin (50,300) — byte-swap-unsafe, no glyph
 *  reuse → an edit must take the Path-3 base-14 redraw (a genuine substitution). */
async function makeSubsetNoToUnicodePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;

  const fontDict = PDFDict.fromMapWithContext(new Map(), ctx);
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of('ABCDEF+Custom'));
  const fontRef = ctx.register(fontDict);

  const resFont = PDFDict.fromMapWithContext(new Map(), ctx);
  resFont.set(PDFName.of('F1'), fontRef);
  const res = PDFDict.fromMapWithContext(new Map(), ctx);
  res.set(PDFName.of('Font'), resFont);
  page.node.set(PDFName.of('Resources'), res);

  const content = 'BT /F1 12 Tf 1 0 0 1 50 300 Tm (\x01\x02) Tj ET';
  const pcb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) pcb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(pcb)));
  return doc.save();
}

/** A plain standard-font (Helvetica) page with a literal `(Hello) Tj` at (50,300). */
async function makeStandardFontPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Hello', { x: 50, y: 300, size: 12, font });
  return doc.save();
}

async function extractText(bytes: Uint8Array): Promise<string> {
  const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  const joined = (content.items as { str: string }[]).map(i => i.str).join('');
  await task.destroy();
  return joined;
}

describe('true-edit restyle — real Chrome', () => {
  it("reports 'substituted' and keeps the text extractable when an embedded subset font is redrawn", async () => {
    const doc = await PDFDocument.load(await makeSubsetNoToUnicodePdf());
    const result = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'Hi');
    expect(result).toBe('substituted');

    // The base-14 redraw is real, extractable PDF text (pdf.js reads it back).
    const text = await extractText(await doc.save());
    expect(text).toContain('Hi');
  });

  it('returns true (no substitution) for a plain standard-font edit', async () => {
    const doc = await PDFDocument.load(await makeStandardFontPdf());
    const result = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'World');
    expect(result).toBe(true);
    const text = await extractText(await doc.save());
    expect(text).toContain('World');
  });

  it('returns true for a bold RESTYLE of a standard font (redrawn in the same family — not flagged)', async () => {
    const doc = await PDFDocument.load(await makeStandardFontPdf());
    // A restyle forces Path 3 even on Helvetica, but the substitute IS Helvetica →
    // no real font loss → plain true (guards against a naive "Path 3 = substituted").
    const result = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'Hello', 5, { bold: true });
    expect(result).toBe(true);
  });
});
