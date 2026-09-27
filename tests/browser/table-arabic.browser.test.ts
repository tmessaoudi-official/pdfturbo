/**
 * Limits row 42 (real Chrome) — an Arabic table's cells export in the order they were typed, through the CSV/XLSX grid
 * (`_resolveTableGrid`) and the Word/Markdown/text tables (`_extractFlowDoc`), on two producers.
 *
 * Until row 42 a cell was its items sorted left to right and joined with spaces. Chrome draws Arabic one glyph per
 * item, so `الطول` came out as `ل و ط ل ا` in presentation forms, and LibreOffice's `(RTL)` as `هنا ) RTL ( النص`.
 * Cells on a page holding right-to-left items are now built like paragraphs (flowDoc's line ordering, the near-even
 * line settled against the cell, spaces from the gaps).
 *
 * Oracles: the typed text — `scripts/gen-arabic-fixture.mjs` for Chrome's table, `tests/fixtures/bidi/arabic-table.fodt`
 * for LibreOffice's. Column ORDER is not the subject here: the lattice grid lists columns as drawn (left to right), the
 * tagged path (LibreOffice's struct tree) in tag order, and the two differ for a right-to-left table — row 53.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { withPdfjsAssets } from '../../src/utils/pdfjsParams';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { FlowDoc } from '../../src/utils/flowDoc';
import type { TableGrid } from '../../src/utils/tableExtract';
import chromeUrl from '../fixtures/corpus-public/arabic-allcases.pdf?url';
import loUrl from '../fixtures/bidi/arabic-table.pdf?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type Svc = { _extractFlowDoc(): Promise<FlowDoc>; _resolveTableGrid(p: unknown): Promise<TableGrid | null> };
type Result = { csv: (string[][] | null)[]; flow: string[][][][] };

async function extract(u: string): Promise<Result> {
  const bytes = new Uint8Array(await (await fetch(u)).arrayBuffer());
  const doc = await pdfjsLib.getDocument(withPdfjsAssets({ data: bytes.slice(0) })).promise;
  try {
    const pages = Array.from({ length: doc.numPages }, (_, i) => ({ id: `p${i + 1}`, sourcePdfId: 's1', sourcePageNum: i + 1, rotation: 0 }));
    const svc = new ExportService({
      documentModel: { pages, sourcePdfs: new Map([['s1', { doc, bytes }]]) },
      elements: [],
      reportError: { info() {}, warn() {}, error() {}, silent() {} },
    } as unknown as IExportContext) as unknown as Svc;
    const csv: (string[][] | null)[] = [];
    for (const p of pages) csv.push((await svc._resolveTableGrid(p))?.cells ?? null);
    const flow = (await svc._extractFlowDoc()).pages.map(pg => (pg.tables ?? []).map(t => t.grid.cells));
    return { csv, flow };
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Codepoint-escaped, so a failure message is readable whatever the terminal's bidi does. */
const esc = (v: unknown) => JSON.stringify(v).replace(/[^\x20-\x7e]/g, c => `<${c.codePointAt(0)?.toString(16)}>`);

describe('row 42 — Chrome print-to-PDF (per-glyph Arabic), a lattice table split over two pages', () => {
  let r: Result;
  beforeAll(async () => { r = await extract(chromeUrl); });
  const P1 = [['Note', 'القيمة', 'الاسم'], ['A4', '٢١٠ مم', 'الطول']];
  const P2 = [['Note', 'القيمة', 'الاسم'], ['portrait', '٢٩٧ مم', 'العرض'], ['single', '1', 'الصفحات']];
  it('CSV/XLSX grid, page 1', () => expect(esc(r.csv[0])).toBe(esc(P1)));
  it('CSV/XLSX grid, page 2 (the header repeats)', () => expect(esc(r.csv[1])).toBe(esc(P2)));
  it('Word/Markdown/text tables, one per page', () => expect(esc(r.flow)).toBe(esc([[P1], [P2]])));
});

describe('row 42 — LibreOffice (whole-word items, tagged), a right-to-left table with wrapped mixed cells', () => {
  let r: Result;
  beforeAll(async () => { r = await extract(loUrl); });
  // Typed, per row (arabic-table.fodt): الرقم | القيمة | Note; الطول | 210 مم | A4 paper;
  // النسخة | برنامج PDFturbo الجديد | The phrase مرحبا بكم here; النص (RTL) هنا | هذا نص عربي خالص | plain.
  const LOGICAL = [
    ['الرقم', 'القيمة', 'Note'],
    ['الطول', '210 مم', 'A4 paper'],
    ['النسخة', 'برنامج PDFturbo الجديد', 'The phrase مرحبا بكم here'],
    ['النص (RTL) هنا', 'هذا نص عربي خالص', 'plain'],
  ];
  it('CSV/XLSX grid (lattice: columns as drawn, left to right)', () =>
    expect(esc(r.csv)).toBe(esc([LOGICAL.map(row => [...row].reverse())])));
  it('Word/Markdown/text table (tagged: columns in tag order)', () => expect(esc(r.flow)).toBe(esc([[LOGICAL]])));
});
