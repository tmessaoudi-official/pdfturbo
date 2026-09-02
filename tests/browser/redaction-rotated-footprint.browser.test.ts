/**
 * WS4-B — a ROTATED redaction burned a rotated box while every filter tested the upright one.
 *
 * A redaction element renders a rotation handle like any other (`redactionElement.render` appends
 * `createRotationHandle()`), the editor shows it rotated (`elementLayerRenderer` sets
 * `transform: rotate(Ndeg)`), and the export burns it rotated (`renderRedaction` passes
 * `rotate: pdfRotVal`). But the redaction rects handed to the filters — `isItemRedacted`,
 * `imagePlacementRedacted`, `annotationRectRedacted`, `dropElementsUnderRedactions` — were the
 * element's STORED, upright box.
 *
 * The two shapes are not nested: a rotated rectangle sticks out of its own upright box on the long
 * axis. So content under those protruding parts was painted over by an opaque burn and left fully
 * extractable in the DOCX / Markdown / TXT / CSV exports — visually convincing, textually intact,
 * which is the exact failure mode the 2026-08-05 round existed to close, reached through a door
 * nobody had tried.
 *
 * The plan scoped B as "the rotated ELEMENT's true footprint"; a rotated REDACTION is the same
 * geometry with the bigger blast radius, because it reaches the SOURCE-text channels rather than
 * only the blank-page overlay drop.
 *
 * DIRECTION RULE (from the plan, and it is why the fix takes a UNION rather than a replacement):
 * for a leak filter the tested footprint may only GROW. A bare rotated-corner AABB is NARROWER on
 * one axis at 90° — a 120x20 box becomes 20x120 — so swapping one for the other would stop
 * dropping things that are dropped today. Union keeps every existing drop and adds the missing
 * ones, which also makes the change additive by construction.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext, dropElementsUnderRedactions } from '../../src/export/exportService';
import type { FlowDoc } from '../../src/utils/flowDoc';
import { buildAnnotatedPdfBytes, countColours } from './_redactedAnnotationFixture';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type Ext = {
  _extractFlowDoc(): Promise<FlowDoc>;
  _extractPageTableData(p: unknown): Promise<{ items: Array<{ text: string }> } | null>;
};

const PW = 300, PH = 260;
const SECRET = 'SECRETWORD', PUBLIC = 'PUBLICWORD';

/**
 * Stored box 120x20 at (100,120) in DISPLAY space, rotated 90 degrees about its centre (160,130):
 * the burn actually covers x 150..170, y 70..190.
 *
 * The secret sits at display y 82..90 — inside the rotated burn, well OUTSIDE the stored box's
 * y 120..140. That gap is the whole defect; a fixture whose secret is inside both boxes proves
 * nothing, which is the same trap as the too-wide image target recorded for C22.
 */
const RED = { x: 100, y: 120, width: 120, height: 20, rotation: 90 };

async function buildPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([PW, PH]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // display (155, 82..90) → PDF y-up baseline 170.
  page.drawText(SECRET, { x: 152, y: 170, size: 8, font, color: rgb(0, 0, 0) });
  // Far from both boxes, so it must survive whatever the filter does.
  page.drawText(PUBLIC, { x: 20, y: 230, size: 8, font, color: rgb(0, 0, 0) });
  return doc.save();
}

async function svcFor(rotation: number): Promise<Ext> {
  const doc = await pdfjsLib.getDocument({ data: (await buildPdf()).slice(0) }).promise;
  return new ExportService({
    documentModel: {
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { doc, bytes: new Uint8Array() }]]),
    },
    elements: [{ pageId: 'p1', type: 'redaction', ...RED, rotation }],
  } as unknown as IExportContext) as unknown as Ext;
}

async function flowText(rotation: number): Promise<string> {
  const flow = await (await svcFor(rotation))._extractFlowDoc();
  return JSON.stringify(flow.pages[0].paragraphs);
}

/**
 * The CSV/XLSX path builds its OWN redaction rects, so it is a SEPARATE site from the flow path
 * and needs its own case. That is not a theoretical worry: the first version of this fix
 * normalised inside `redactionRectToContent`, which both paths reach, and the table path STILL
 * leaked — it rebuilt a stripped `{x, y, width, height}` literal and dropped `rotation` on the
 * floor before the call. Four sites did that.
 */
async function tableText(rotation: number): Promise<string> {
  const data = await (await svcFor(rotation))._extractPageTableData(
    { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 },
  );
  return (data?.items ?? []).map(i => i.text).join('|');
}

describe('WS4-B — a rotated redaction filters what it actually covers', () => {
  it('source text under the ROTATED burn is dropped from the flow export', async () => {
    const text = await flowText(90);
    // Pre-fix: the filter tests y 120..140 and the secret is at y 82..90, so it sails through
    // while the exported PDF shows an opaque box over it.
    expect(text).not.toContain(SECRET);
  }, 60_000);

  it('text clear of the burn survives (over-reach control)', async () => {
    const text = await flowText(90);
    // The union footprint is bigger than either box; it must still not swallow the whole page.
    expect(text).toContain(PUBLIC);
  }, 60_000);

  it('the table (CSV/XLSX) path drops it too — a separate rect-building site', async () => {
    const text = await tableText(90);
    expect(text).not.toContain(SECRET);
    expect(text).toContain(PUBLIC);
  }, 60_000);

  it('an UNROTATED redaction behaves exactly as before (the regression control)', async () => {
    const text = await flowText(0);
    // The stored box covers y 120..140 and the secret is at y 82..90, so with no rotation the
    // secret is legitimately NOT under the redaction and must be exported. This is what makes the
    // first case a rotation finding rather than a filter-strength one.
    expect(text).toContain(SECRET);
    expect(text).toContain(PUBLIC);
  }, 60_000);
});

describe('WS4-B — the same rule on the blank-page element drop', () => {
  const at = (x: number, y: number) => ({ id: 1, pageId: 'p1', type: 'text', x, y, width: 10, height: 10 });

  it('an element under the rotated part of a redaction is dropped', () => {
    const els = [{ id: 9, pageId: 'p1', type: 'redaction', ...RED }, at(155, 80)] as never[];
    // Only the redaction survives.
    expect(dropElementsUnderRedactions(els)).toHaveLength(1);
  });

  it('a ROTATED element protruding into an upright redaction is dropped', () => {
    // The plan's original B: the element's own stored box misses the redaction, but rotated about
    // its centre (60,130) it reaches x 55..65, y 80..180 and meets the box at y 120..140.
    const el = { id: 8, pageId: 'p1', type: 'text', x: 10, y: 125, width: 100, height: 10, rotation: 90 };
    const els = [{ id: 9, pageId: 'p1', type: 'redaction', x: 55, y: 80, width: 20, height: 20 }, el] as never[];
    expect(dropElementsUnderRedactions(els)).toHaveLength(1);
  });

  it('an unrotated element clear of the box is kept (regression control)', () => {
    const els = [{ id: 9, pageId: 'p1', type: 'redaction', x: 0, y: 0, width: 20, height: 20 }, at(200, 200)] as never[];
    expect(dropElementsUnderRedactions(els)).toHaveLength(2);
  });
});

/**
 * The RASTERIZER path builds its own redaction rects too (`exportPipeline`), and it feeds
 * `stripRedactedAnnotations` — the filter that stops a source annotation being repainted over the
 * burn. Sabotage found this site unpinned: re-stripping `rotation` there left every existing guard
 * green, because they all place UNROTATED redactions.
 *
 * The redaction here is a tall thin bar to the LEFT of the covered annotation. Upright it misses it
 * entirely; rotated 90° about its own centre it becomes a wide flat bar that crosses it. So the
 * case can only pass if the element's own rotation survives all the way to the strip.
 */
describe('WS4-B — the rasterizer/annotation-strip path honours the element rotation', () => {
  it('a rotated redaction strips the annotation its upright box would miss', async () => {
    const bytes = await buildAnnotatedPdfBytes();
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
    const svc = new ExportService({
      documentModel: {
        pageCount: 1, currentPageIndex: 0,
        pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
        sourcePdfs: new Map([['s1', { bytes, doc }]]),
        watermark: { enabled: false }, bates: { enabled: false },
      },
      // Upright: x 20..40, nowhere near COVERED at x 120..220. Rotated 90° about (30,230):
      // x −100..160, y 220..240 — straight through it.
      elements: [{ id: 1, pageId: 'p1', type: 'redaction', color: '#000000', x: 20, y: 100, width: 20, height: 260, rotation: 90 }],
      formValues: {}, currentFilename: 'x.pdf', exportPassword: null,
      inkLayer: { getStrokes: () => [] },
      reportError: { info() {}, warn() {}, error() {} },
      progress: { begin: () => handle },
      cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
    } as unknown as IExportContext);
    const { red, green } = await countColours(
      (await svc.renderThumbnailWithOverlays(0, 2)) as string,
    );
    expect(red).toBe(0);
    // CONTROL sits at y 400..460, clear of the footprint, so it must still be there — otherwise
    // this would pass for a fix that simply strips every annotation.
    expect(green).toBeGreaterThan(500);
  }, 60_000);
});
