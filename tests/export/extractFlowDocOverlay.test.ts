/**
 * #4 wiring guard (2026-06-17): `_extractFlowDoc` must carry typed overlay text
 * into the flow model — including on BLANK pages (no source), which were skipped
 * entirely, so "type Arabic on a blank page → export DOCX" produced an empty file.
 * Blank pages need no pdf.js, so this runs in jsdom (mirrors the makeExtractor
 * pattern from tests/browser/issue3-docx-images.browser.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { FlowDoc } from '../../src/utils/flowDoc';

type Extractor = { _extractFlowDoc(): Promise<FlowDoc> };

function makeService(pages: unknown[], elements: unknown[]): Extractor {
  const ctx = {
    documentModel: { pages, sourcePdfs: new Map() },
    elements,
  } as unknown as IExportContext;
  return new ExportService(ctx) as unknown as Extractor;
}

const blankPage = { id: 'p1', sourcePdfId: 'blank', sourcePageNum: 0, blankWidth: 600, blankHeight: 400 };
const textEl = (text: string, over: Record<string, unknown> = {}) => ({
  id: 'e1', type: 'text', pageId: 'p1', text, x: 40, y: 50, fontSize: 24,
  color: '#000000', fontFamily: 'Arial', bold: false, italic: false, ...over,
});

describe('_extractFlowDoc — typed overlay text (#4)', () => {
  it('emits a blank page carrying typed Arabic (was dropped → empty DOCX)', async () => {
    const fd = await makeService([blankPage], [textEl('مرحبا بالعالم')])._extractFlowDoc();
    expect(fd.pages).toHaveLength(1);
    expect(fd.pages[0].paragraphs).toHaveLength(1);
    expect(fd.pages[0].paragraphs[0].runs[0].text).toBe('مرحبا بالعالم');
    expect(fd.pages[0].paragraphs[0].rtl).toBe(true);
    expect(fd.pages[0].width).toBe(600);
  });

  it('emits typed Latin on a blank page too', async () => {
    const fd = await makeService([blankPage], [textEl('Hello world')])._extractFlowDoc();
    expect(fd.pages).toHaveLength(1);
    expect(fd.pages[0].paragraphs[0].runs[0].text).toBe('Hello world');
    expect(fd.pages[0].paragraphs[0].rtl).toBe(false);
  });

  it('drops a blank page with no typed text (no empty pages emitted)', async () => {
    const fd = await makeService([blankPage], [])._extractFlowDoc();
    expect(fd.pages).toHaveLength(0);
  });
});
