/**
 * A5 (real Chrome) — typed text that spills out of its box and under a redaction.
 *
 * A text box has a fixed height (nothing grows it as you type; the editor's textarea scrolls), and
 * the export bake draws EVERY line at `y + 0.9·size + i·lineHeight`, never wraps and never clips. So
 * the drawn text can extend below the box and past its right edge. `dropElementsUnderRedactions`
 * tested the STORED box, so a redaction the box does not touch, but its overflow does, kept the
 * element: on a blank page the overflow line was baked as live text under the burn, and the
 * DOCX/Markdown/TXT and XFDF exports carried the whole text.
 *
 * Ruling (limits-walkthrough A5): reproduce first, then test the DRAWN extent, not the stored box.
 * Each case has a CONTROL with the redaction moved clear, so "the text is gone" cannot pass because
 * the export dropped everything.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { TextElement } from '../../src/elements/textElement';
import { RedactionElement } from '../../src/elements/redactionElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W = 400, H = 400;
const SECRET = 'SECRETOVERFLOW';

type Box = { x: number; y: number; width: number; height: number };

function ctxFor(text: TextElement, red: Box): { ctx: IExportContext; downloads: Blob[] } {
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const downloads: Blob[] = [];
  const ctx = {
    documentModel: {
      pageCount: 1, currentPageIndex: 0,
      pages: [{ id: 'p1', sourcePdfId: 'blank', sourcePageNum: 0, rotation: 0, blankWidth: W, blankHeight: H }],
      sourcePdfs: new Map(), watermark: { enabled: false }, bates: { enabled: false },
    },
    elements: [text, new RedactionElement(red.x, red.y, red.width, red.height, 'p1', '#000000')],
    formValues: {}, currentFilename: 'case.pdf', exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info() {}, warn() {}, error() {}, silent() {} },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
  } as unknown as IExportContext;
  return { ctx, downloads };
}

async function pdfText(text: TextElement, red: Box): Promise<string> {
  const { ctx } = ctxFor(text, red);
  const bytes = await new ExportService(ctx).assemblePdfBytes();
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const tc = await (await pdf.getPage(1)).getTextContent();
  return tc.items.map(i => ('str' in i ? i.str : '')).join(' ');
}

async function markdown(text: TextElement, red: Box): Promise<string> {
  const { ctx, downloads } = ctxFor(text, red);
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob) => void })._downloadBlob = b => downloads.push(b);
  await svc.exportAsMarkdown();
  return downloads.length ? downloads[0].text() : '';
}

/** A 200×20 box at (40,40) holding two lines at 12pt: the second baseline sits at y≈65, BELOW the box. */
const below = () => Object.assign(new TextElement(40, 40, 'p1', { width: 200, height: 20, fontSize: 12 }), { text: `PUBLIC\n${SECRET}` });
/** Clear of the stored box (y 40..60) but across the second line's glyphs (y≈56..68). */
const RED_BELOW: Box = { x: 30, y: 61, width: 220, height: 20 };

/** A 60×20 box holding one line far wider than the box — the bake never wraps. */
const right = () => Object.assign(new TextElement(40, 40, 'p1', { width: 60, height: 20, fontSize: 12 }), { text: `PUBLIC ${SECRET}` });
/** Clear of the stored box (x 40..100) but across the line's tail. */
const RED_RIGHT: Box = { x: 105, y: 35, width: 200, height: 30 };

const FAR: Box = { x: 300, y: 300, width: 40, height: 40 };

describe('A5 — overflowing text under a redaction on a blank page', () => {
  it('reproduction precondition: neither redaction touches its text box\'s stored box', () => {
    for (const [t, r] of [[below(), RED_BELOW], [right(), RED_RIGHT]] as const) {
      const hit = t.x < r.x + r.width && t.x + t.width > r.x && t.y < r.y + r.height && t.y + t.height > r.y;
      expect(hit).toBe(false);
    }
  });

  it('PDF export: a line overflowing BELOW the box into a redaction is not exported as live text', async () => {
    expect(await pdfText(below(), RED_BELOW)).not.toContain(SECRET);
  }, 60_000);

  it('PDF export: a line overflowing RIGHT of the box into a redaction is not exported as live text', async () => {
    expect(await pdfText(right(), RED_RIGHT)).not.toContain(SECRET);
  }, 60_000);

  it('Markdown export: the overflowing text is not carried either', async () => {
    expect(await markdown(below(), RED_BELOW)).not.toContain(SECRET);
    expect(await markdown(right(), RED_RIGHT)).not.toContain(SECRET);
  }, 60_000);

  it('CONTROL: the same text with the redaction far away is exported whole', async () => {
    expect(await pdfText(below(), FAR)).toContain(SECRET);
    expect(await pdfText(right(), FAR)).toContain(SECRET);
    expect(await markdown(below(), FAR)).toContain(SECRET);
  }, 60_000);
});
