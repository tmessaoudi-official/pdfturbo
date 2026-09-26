/**
 * Limits row 18 (D6 + D7, real Chrome) — the font name pdf.js reads out of a real PDF reaches the DOCX.
 *
 * The unit cases in `tests/utils/flowDocFidelity.test.ts` feed `wordFontFor` hand-written names. This drives the
 * real `_extractFlowDoc` and the real writer on two tracked CJK files, so the name is whatever pdf.js resolves from
 * the font dictionary (it resolves only after `getOperatorList`, which `_extractFlowDoc` awaits; before that the
 * run would carry pdf.js's internal id `g_d0_f1`, which the writer rejects as generated).
 *
 * - `pdfjs-vertical.pdf` names its font `KXRNCQ+AokinMincho` (pdf.js's own test file, CMap-encoded).
 * - `libreoffice-tb-rl.pdf` names it `BAAAAA+NotoSerifCJKjp-Regular`, for which pdf.js GUESSES `monospace`
 *   (the FixedPitch flag) — the fontTable hint must still say roman / variable, because the name says serif.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { unzipSync, strFromU8 } from 'fflate';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { withPdfjsAssets } from '../../src/utils/pdfjsParams';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';
import type { DocumentPage } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { FlowDoc } from '../../src/utils/flowDoc';
import verticalUrl from '../fixtures/vertical/pdfjs-vertical.pdf?url';
import libreUrl from '../fixtures/vertical/libreoffice-tb-rl.pdf?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const failLoud = {
  info() {},
  silent(_e?: unknown, msg?: string) { throw new Error(`export reported: ${msg}`); },
  warn(key: string) { throw new Error(`export warned: ${key}`); },
  error(key: string, err?: unknown) { throw new Error(`export errored: ${key} ${String(err)}`); },
} as unknown as IErrorReporter;
const docPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } as DocumentPage;

async function docxOf(url: string): Promise<{ flow: FlowDoc; documentXml: string; fontTable: string }> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const doc = await pdfjsLib.getDocument(withPdfjsAssets({ data: bytes.slice(0) })).promise;
  try {
    const svc = new ExportService({
      documentModel: { pages: [docPage], sourcePdfs: new Map([['s1', { doc, bytes }]]) },
      elements: [],
      reportError: failLoud,
    } as unknown as IExportContext) as unknown as { _extractFlowDoc(): Promise<FlowDoc> };
    const flow = await svc._extractFlowDoc();
    const zip = unzipSync(Uint8Array.from(atob(await flowDocToDocxBase64(flow)), c => c.charCodeAt(0)));
    return { flow, documentXml: strFromU8(zip['word/document.xml']), fontTable: strFromU8(zip['word/fontTable.xml']) };
  } finally {
    await doc.loadingTask.destroy();
  }
}

function eastAsiaNames(documentXml: string): string[] {
  return [...documentXml.matchAll(/<w:rFonts[^>]*w:eastAsia="([^"]*)"/g)].map(m => m[1]);
}

describe('row 18 — the real font name reaches the DOCX (D6 + D7)', () => {
  it("pdf.js's vertical.pdf: AokinMincho is written as 'Aokin Mincho', and declared roman", async () => {
    const { flow, documentXml, fontTable } = await docxOf(verticalUrl);
    // Non-vacuity: the extractor really resolved the font's own name, not pdf.js's internal id.
    expect(flow.pages[0].paragraphs[0].runs[0].psName).toBe('AokinMincho');
    const names = eastAsiaNames(documentXml);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set(['Aokin Mincho']));
    expect(fontTable).toContain('<w:font w:name="Aokin Mincho"><w:family w:val="roman"/><w:pitch w:val="variable"/>');
  });

  it("LibreOffice's vertical layout: NotoSerifCJKjp is 'Noto Serif CJK JP', roman although pdf.js guessed monospace", async () => {
    const { flow, documentXml, fontTable } = await docxOf(libreUrl);
    const run = flow.pages[0].paragraphs[0].runs[0];
    expect(run.psName).toBe('NotoSerifCJKjp-Regular');
    // The measured premise: pdf.js's own guess is wrong for this face. If it ever turns serif, the name-first hint
    // below stops being the thing under test and this line says so.
    expect(run.fontFamily).toBe('monospace');
    expect(new Set(eastAsiaNames(documentXml))).toEqual(new Set(['Noto Serif CJK JP']));
    expect(fontTable).toContain('<w:font w:name="Noto Serif CJK JP"><w:family w:val="roman"/><w:pitch w:val="variable"/>');
  });
});
