/**
 * Limits row 19 (D8, real Chrome) — mixed Arabic + English lines reach Word in the order they were typed.
 *
 * The oracle is the text typed into `tests/fixtures/bidi/mixed-bidi.fodt`, not any reading of the PDF: the DOCX
 * stores runs in LOGICAL order and Word lays them out with its own bidi, so each paragraph's `w:t` text, joined in
 * document order, must equal what was typed, and its `w:bidi` must match the paragraph's direction.
 *
 * Two things this pins that were wrong until row 19 (measured on this file, 2026-09-27):
 * - pdf.js already returns every RTL item in logical order (`runBidiTransform` runs UAX#9 L2 per text chunk,
 *   pdf.worker.mjs), and the export reversed it again, so every Arabic word was written backwards;
 * - a line's direction was a majority of ITEMS, so `النص (RTL) هنا` (two Arabic items, three Latin/punctuation
 *   items) was read as left-to-right and its runs came out in visual order.
 *
 * The lam-alef line is a pinned CEILING, not a guarantee: the ligature glyph's ToUnicode is `لا`, and pdf.js's own
 * reversal of the drawn (visual) chunk turns it into `ال`, so `كلام` extracts as `كالم`. pdftotext reads it the same.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { unzipSync, strFromU8 } from 'fflate';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { withPdfjsAssets } from '../../src/utils/pdfjsParams';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { flowDocToDocxBase64, flowDocToMarkdown } from '../../src/utils/flowDocWriters';
import type { DocumentPage } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { FlowDoc } from '../../src/utils/flowDoc';
import url from '../fixtures/bidi/mixed-bidi.pdf?url';
import { drawArabicLine } from '../../src/export/arabicOverlay';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const failLoud = {
  info() {},
  silent(_e?: unknown, msg?: string) { throw new Error(`export reported: ${msg}`); },
  warn(key: string) { throw new Error(`export warned: ${key}`); },
  error(key: string, err?: unknown) { throw new Error(`export errored: ${key} ${String(err)}`); },
} as unknown as IErrorReporter;
const docPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } as DocumentPage;

/** What was typed, per paragraph, and its direction. Matches mixed-bidi.fodt. */
const TYPED: ReadonlyArray<{ text: string; rtl: boolean }> = [
  { text: 'مرحبا بكم في PDFturbo النسخة 2.5 اليوم', rtl: true },
  { text: 'يدعم البرنامج Microsoft Word بالكامل', rtl: true },
  { text: 'The phrase مرحبا بكم means welcome.', rtl: false },
  { text: 'النص (RTL) هنا', rtl: true },
  { text: 'هذا نص عربي خالص', rtl: true },
  { text: 'Plain English control line.', rtl: false },
];
/** Line 7: the lam-alef ceiling, as pdf.js extracts it (typed: 'قال كلام جميل'). */
const LAM_ALEF_AS_EXTRACTED = 'قال كالم جميل';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Codepoint-escaped, so a failure message is readable whatever the terminal's bidi does. */
const esc = (s: string) => [...s].map(c => { const n = c.codePointAt(0) ?? 0; return n < 128 ? c : `<${n.toString(16)}>`; }).join('');

let paras: { text: string; bidi: boolean }[] = [];
let markdown = '';

async function exportedParagraphs(bytes: Uint8Array): Promise<{ paras: { text: string; bidi: boolean }[]; markdown: string }> {
  const doc = await pdfjsLib.getDocument(withPdfjsAssets({ data: bytes.slice(0) })).promise;
  try {
    const svc = new ExportService({
      documentModel: { pages: [docPage], sourcePdfs: new Map([['s1', { doc, bytes }]]) },
      elements: [],
      reportError: failLoud,
    } as unknown as IExportContext) as unknown as { _extractFlowDoc(): Promise<FlowDoc> };
    const flow = await svc._extractFlowDoc();
    const zip = unzipSync(Uint8Array.from(atob(await flowDocToDocxBase64(flow)), c => c.charCodeAt(0)));
    const xml = strFromU8(zip['word/document.xml']);
    return {
      markdown: flowDocToMarkdown(flow),
      paras: (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [])
        .map(p => ({
          text: squash([...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join('')),
          bidi: /<w:bidi\/>/.test(p),
        }))
        .filter(p => p.text),
    };
  } finally {
    await doc.loadingTask.destroy();
  }
}

beforeAll(async () => {
  ({ paras, markdown } = await exportedParagraphs(new Uint8Array(await (await fetch(url)).arrayBuffer())));
});

describe('row 19 — mixed Arabic + English lines reach Word in typed order (D8)', () => {
  it('exports one paragraph per typed line', () => {
    expect(paras.map(p => esc(p.text))).toHaveLength(TYPED.length + 1);
  });

  TYPED.forEach(({ text, rtl }, i) => {
    it(`line ${i + 1}: text in typed (logical) order, ${rtl ? 'right-to-left' : 'left-to-right'} paragraph`, () => {
      expect(esc(paras[i].text)).toBe(esc(squash(text)));
      expect(paras[i].bidi).toBe(rtl);
    });
  });

  it('line 7: the lam-alef ligature extracts reordered — a pinned pdf.js/ToUnicode ceiling, not a guarantee', () => {
    expect(esc(paras[6].text)).toBe(esc(LAM_ALEF_AS_EXTRACTED));
  });

  it('Markdown / text carry the same logical order', () => {
    const plain = markdown.replace(/\*\*/g, ''); // the bold words carry Markdown emphasis
    for (const { text } of TYPED) expect(esc(plain)).toContain(esc(squash(text)));
  });
});

describe('row 19 — a second producer: the app\'s own Arabic bake reads back in typed order', () => {
  it('a pure and a mixed line drawn by drawArabicLine export in logical order', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    const lines = ['هذا نص عربي', 'مرحبا بكم في PDFturbo اليوم'];
    await drawArabicLine(doc, page, { text: lines[0], x: 20, y: 150, right: 380, size: 18, color: { r: 0, g: 0, b: 0 } });
    await drawArabicLine(doc, page, { text: lines[1], x: 20, y: 90, right: 380, size: 18, color: { r: 0, g: 0, b: 0 } });
    const out = await exportedParagraphs(await doc.save());
    expect(out.paras.map(p => esc(p.text))).toEqual(lines.map(l => esc(l)));
    expect(out.paras.map(p => p.bidi)).toEqual([true, true]);
  });
});
