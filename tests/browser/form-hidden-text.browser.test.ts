/**
 * A2 (real Chrome) — text a Form XObject draws past its own `/BBox` is invisible, and must not export.
 *
 * pdf.js clips a form to its `/BBox` when it paints, but `getTextContent` reports the form's text with
 * no clip and no form identity, so such text used to land in DOCX / Markdown / TXT and in the CSV / XLSX
 * tables. `formHiddenText.ts` attributes each item to its form exactly (marker injection on a throwaway
 * copy) and drops the ones wholly outside that placement's clip.
 *
 * The fixture carries every shape the filter has to tell apart, on a NON-square page:
 *   - `HIDDENTEXT`  — wholly past the outer form's box: must go.
 *   - `INSIDE`      — inside it: must stay.
 *   - `STRADDLEWORD` — crosses the box edge: ONE item, partly visible, so it stays whole (the bound).
 *   - `PAIRWORD`    — drawn by an inner form placed TWICE: first nested in the outer form, where the outer
 *                     box hides it, then directly on the page, where it is visible. Exactly one copy must
 *                     survive. This is the occurrence-pairing case: matching every placement to the first
 *                     one's clip would drop the visible copy too.
 *   - `PAGETEXT`    — ordinary page text, never inside a form.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { FormHiddenTextFinder } from '../../src/export/formHiddenText';
import type { FlowDoc } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type Ext = {
  _extractFlowDoc(): Promise<FlowDoc>;
  _extractPageTableData(p: unknown): Promise<{ items: Array<{ text: string }> } | null>;
};

const W = 612, H = 792;
const OUTER_AT = { x: 50, y: 600 }; // outer /BBox [0 0 100 60] → page x 50..150, y 600..660

async function buildPdf(opts: { crop?: boolean; allInside?: boolean; indirectSubtype?: boolean } = {}): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFNumber, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  if (opts.crop) page.setCropBox(20, 15, W - 40, H - 30);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const ctx = doc.context;
  const inner = ctx.register(ctx.flateStream('BT /F1 8 Tf 1 0 0 1 100 5 Tm (PAIRWORD) Tj ET', {
    Type: PDFName.of('XObject'), Subtype: PDFName.of('Form'), FormType: PDFNumber.of(1),
    BBox: ctx.obj([0, 0, 200, 20]), Resources: ctx.obj({ Font: ctx.obj({ F1: helv.ref }) }),
  }));
  const outerLines = opts.allInside
    ? ['BT /F1 10 Tf 1 0 0 1 5 20 Tm (INSIDE) Tj ET']
    : [
      'BT /F1 10 Tf 1 0 0 1 5 20 Tm (INSIDE) Tj ET',
      'BT /F1 10 Tf 1 0 0 1 300 20 Tm (HIDDENTEXT) Tj ET',
      'BT /F1 10 Tf 1 0 0 1 70 40 Tm (STRADDLEWORD) Tj ET',
      'q 1 0 0 1 10 0 cm /Fi Do Q',
    ];
  // Legal but unusual: `/Subtype` as an indirect object. Read with `get` it is a PDFRef, not the name.
  const subtype = opts.indirectSubtype ? ctx.register(PDFName.of('Form')) : PDFName.of('Form');
  const outer = ctx.register(ctx.flateStream(outerLines.join('\n'), {
    Type: PDFName.of('XObject'), Subtype: subtype, FormType: PDFNumber.of(1),
    Matrix: ctx.obj([1, 0, 0, 1, OUTER_AT.x, OUTER_AT.y]), BBox: ctx.obj([0, 0, 100, 60]),
    Resources: ctx.obj({ Font: ctx.obj({ F1: helv.ref }), XObject: ctx.obj({ Fi: inner }) }),
  }));
  const content = ctx.stream([
    'BT /F1 11 Tf 1 0 0 1 60 700 Tm (PAGETEXT) Tj ET',
    '/Fo Do',
    ...(opts.allInside ? [] : ['q 1 0 0 1 300 400 cm /Fi Do Q']),
  ].join('\n'));
  page.node.set(PDFName.of('Contents'), ctx.register(content));
  page.node.set(PDFName.of('Resources'), ctx.obj({
    XObject: ctx.obj({ Fo: outer, Fi: inner }), Font: ctx.obj({ F1: helv.ref }),
  }));
  return doc.save({ useObjectStreams: false });
}

const silent: unknown[] = [];
function makeSvc(doc: pdfjsLib.PDFDocumentProxy, bytes: Uint8Array): Ext {
  const ctx = {
    documentModel: {
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { doc, bytes }]]),
    },
    elements: [],
    reportError: { info() {}, warn() {}, error() {}, silent(e: unknown) { silent.push(e); } },
  } as unknown as IExportContext;
  return new ExportService(ctx) as unknown as Ext;
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

async function flowText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const flow = await makeSvc(doc, bytes)._extractFlowDoc();
  return JSON.stringify(flow.pages[0].paragraphs);
}

async function tableText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const data = await makeSvc(doc, bytes)._extractPageTableData(
    { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 },
  );
  return (data?.items ?? []).map(i => i.text).join('|');
}

afterEach(() => { vi.restoreAllMocks(); silent.length = 0; });

describe('A2 — text past a Form XObject\'s /BBox does not export', () => {
  it('the fixture is what it claims: the hidden words draw no ink, the visible ones do', async () => {
    const bytes = await buildPdf();
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const pg = await doc.getPage(1);
    const vp = pg.getViewport({ scale: 1 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    const cx = c.getContext('2d') as CanvasRenderingContext2D;
    await pg.render({ canvas: c, viewport: vp }).promise;
    const ink = (x: number, yUp: number, w: number, h: number) => {
      const d = cx.getImageData(x, vp.height - yUp - h, w, h).data; let k = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 128) k++;
      return k;
    };
    expect(ink(350, 618, 70, 12)).toBe(0); // HIDDENTEXT
    expect(ink(210, 603, 40, 10)).toBe(0); // PAIRWORD, nested — past the outer box
    expect(ink(55, 618, 35, 12)).toBeGreaterThan(20); // INSIDE
    expect(ink(400, 403, 40, 10)).toBeGreaterThan(20); // PAIRWORD, page-level
    expect(ink(120, 638, 28, 12)).toBeGreaterThan(20); // STRADDLEWORD's visible half
    // And pdf.js's text extraction reports every one of them — the defect.
    const all = (await pg.getTextContent()).items.map(i => ('str' in i ? i.str : '')).join('|');
    expect(all).toContain('HIDDENTEXT');
    expect(count(all, 'PAIRWORD')).toBe(2);
  });

  for (const crop of [false, true]) {
    const label = crop ? 'CropBox origin (20,15)' : 'zero CropBox origin';

    it(`flow export (DOCX/MD/TXT) — ${label}`, async () => {
      const spy = vi.spyOn(FormHiddenTextFinder.prototype, 'hiddenItemIndices');
      const text = await flowText(await buildPdf({ crop }));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(silent).toEqual([]);
      expect(text).not.toContain('HIDDENTEXT');
      expect(count(text, 'PAIRWORD')).toBe(1);
      for (const kept of ['PAGETEXT', 'INSIDE', 'STRADDLEWORD']) expect(text).toContain(kept);
    });

    it(`table export (CSV/XLSX) — ${label}`, async () => {
      const text = await tableText(await buildPdf({ crop }));
      expect(silent).toEqual([]);
      expect(text).not.toContain('HIDDENTEXT');
      expect(count(text, 'PAIRWORD')).toBe(1);
      for (const kept of ['PAGETEXT', 'INSIDE', 'STRADDLEWORD']) expect(text).toContain(kept);
    });
  }

  it('a form whose /Subtype is an indirect object is still attributed', async () => {
    const text = await flowText(await buildPdf({ indirectSubtype: true }));
    expect(silent).toEqual([]);
    expect(text).not.toContain('HIDDENTEXT');
    expect(text).toContain('INSIDE');
  });

  it('CONTROL: a page whose form text is all inside never pays for attribution, and exports everything', async () => {
    const spy = vi.spyOn(FormHiddenTextFinder.prototype, 'hiddenItemIndices');
    const bytes = await buildPdf({ allInside: true });
    const text = await flowText(bytes);
    const table = await tableText(bytes);
    expect(spy).not.toHaveBeenCalled();
    for (const kept of ['PAGETEXT', 'INSIDE']) { expect(text).toContain(kept); expect(table).toContain(kept); }
  });

  it('fail-open: when attribution throws, the page exports exactly as it did before the filter', async () => {
    vi.spyOn(FormHiddenTextFinder.prototype, 'hiddenItemIndices').mockRejectedValue(new Error('boom'));
    const text = await flowText(await buildPdf());
    expect(silent.length).toBe(1);
    expect(text).toContain('HIDDENTEXT');
    expect(count(text, 'PAIRWORD')).toBe(2);
  });
});
