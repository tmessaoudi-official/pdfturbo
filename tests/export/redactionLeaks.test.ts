/**
 * Redaction must not leak through the NON-PDF exports.
 *
 * Two paths were found handing redacted source text straight back, while the DOCX/MD/TXT path had
 * carried a filter (and a comment explaining it) all along:
 *
 *   1. Table → CSV / XLSX — `_extractPageTableData` read the raw `getTextContent()`.
 *   2. OCR → "Copy text" / "Export to Word" — the page was rasterised for recognition with no burn,
 *      so tesseract read the text under the box.
 *
 * Both are guarded here at the WIRING level, which is where they broke: the underlying geometry
 * (`isItemRedacted`, `redactionRectToContent`) was already correct and already tested — the defect was
 * that two of four extractors never called it. Sibling code paths that must share a safety filter are
 * exactly where a green suite gives false assurance, so each test below fails if the call is removed.
 */
import { describe, it, expect, vi, onTestFinished } from 'vitest';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { TextElement } from '../../src/elements/textElement';
import { RedactionElement } from '../../src/elements/redactionElement';

const SECRET = 'Wolgast';
const W = 300, H = 400;

// `'download'` is the real sentinel for "no native picker" — returning null instead sends
// `_saveOrDownload` into the write-to-handle branch with a null handle.
vi.mock('../../src/utils/fileSystemAccess', () => ({
  canUseFsSave: () => false,
  pickSaveTarget: () => Promise.resolve('download'),
  writeToHandle: () => Promise.resolve(),
}));

/** A 4-row x 3-col borderless grid; row 2 col 2 carries the secret. */
function tableItems(): unknown[] {
  const rows = [
    ['Ref', 'Client', 'Total'],
    ['A-1', SECRET, '19.98'],
    ['A-2', 'Mainz', '24.50'],
    ['A-3', 'Trier', '35.00'],
  ];
  const xs = [40, 140, 240];
  const out: unknown[] = [];
  rows.forEach((r, ri) => {
    const y = 300 - ri * 30;                    // PDF space, y-up
    r.forEach((text, ci) => {
      out.push({ str: text, transform: [11, 0, 0, 11, xs[ci], y], width: text.length * 6, height: 11 });
    });
  });
  return out;
}

/** Editor DISPLAY-space rect (top-left) covering the secret cell: PDF y=270 → display y = 400-270-11. */
const COVER = { x: 135, y: H - 270 - 14, width: 90, height: 20 };

function buildCtx(
  elements: unknown[], src: unknown, userRot = 0,
): { ctx: IExportContext; warns: string[] } {
  const warns: string[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: 1,
      currentPageIndex: 0,
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: userRot }],
      sourcePdfs: new Map([['s1', src]]),
      watermark: { enabled: false },
      bates: { enabled: false },
    },
    elements,
    formValues: {},
    currentFilename: 'report.pdf',
    exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info() {}, warn: (k: string) => warns.push(k), error() {} },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  return { ctx, warns };
}

/**
 * A fake pdf.js page carrying `tableItems()` and no vector rules (so the borderless path runs).
 *
 * `getViewport` MIMICS pdf.js faithfully on the two behaviours the filter depends on:
 *   1. `rotation` defaults to the page's own `/Rotate`, and a 90/270 rotation SWAPS width and height.
 *      A stub that always returned WxH would make the rotation tests below pass while the production
 *      bug remained.
 *   2. `viewBox` — the page's CropBox — is present and, unlike width/height, is NOT affected by
 *      rotation. Omitting it (as this fake did until 2026-08-28) makes the fake diverge from pdf.js
 *      in a way that only shows up once production reads the field, which is what the CropBox-origin
 *      fix does. `[0, 0, W, H]` is the origin-zero case these tests are about; the non-zero origin is
 *      covered end-to-end against REAL pdf.js in tests/browser/redaction-crop-origin.browser.test.ts.
 */
function fakeSource(pageRot = 0): unknown {
  return {
    bytes: new Uint8Array(0),
    doc: {
      getPage: () => Promise.resolve({
        rotate: pageRot,
        getViewport: ({ rotation }: { scale: number; rotation?: number } = { scale: 1 }) => {
          const r = ((rotation ?? pageRot) % 360 + 360) % 360;
          const viewBox = [0, 0, W, H];   // CropBox: rotation-invariant, exactly as pdf.js reports it
          return r % 180 === 90 ? { width: H, height: W, viewBox } : { width: W, height: H, viewBox };
        },
        getTextContent: () => Promise.resolve({ items: tableItems() }),
        getOperatorList: () => Promise.resolve({ fnArray: [], argsArray: [] }),
      }),
    },
  };
}

/**
 * Where the secret cell APPEARS on screen at `totalRot`, i.e. where the user would draw the box.
 * Derived by rotating the unrotated content rect, which is the inverse of what the production code does
 * — so agreement between the two is a real check rather than the same arithmetic twice.
 */
function coverInDisplaySpace(
  totalRot: number, dispW: number, dispH: number,
): { x: number; y: number; width: number; height: number } {
  const c = { x: COVER.x, y: COVER.y, width: COVER.width, height: COVER.height };
  const corners: [number, number][] = [
    [c.x, c.y], [c.x + c.width, c.y], [c.x, c.y + c.height], [c.x + c.width, c.y + c.height],
  ];
  const mapped = corners.map(([x, y]): [number, number] => {
    switch (totalRot) {
      case 90:  return [dispW - y, x];
      case 180: return [dispW - x, dispH - y];
      case 270: return [y, dispH - x];
      default:  return [x, y];
    }
  });
  const xs = mapped.map(m => m[0]);
  const ys = mapped.map(m => m[1]);
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
  };
}

describe('redaction does not leak into the table exports (CSV / XLSX)', () => {
  it('a redacted cell is absent from the CSV', async () => {
    const redaction = { pageId: 'p1', type: 'redaction', ...COVER, color: '#000000' };
    const { ctx } = buildCtx([redaction], fakeSource());
    const svc = new ExportService(ctx);
    const downloads: { blob: Blob; filename: string }[] = [];
    (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob =
      (blob, filename) => downloads.push({ blob, filename });

    await svc.exportTableCsv();

    expect(downloads).toHaveLength(1);
    const csv = await downloads[0].blob.text();
    expect(csv, 'redacted text must not reach the CSV').not.toContain(SECRET);
    // Non-vacuous: the rest of the table still exports, so the filter is surgical rather than a
    // wholesale failure that would also satisfy the assertion above.
    expect(csv).toContain('Mainz');
    expect(csv).toContain('Total');
  });

  it('without a redaction the same cell DOES export (proves the fixture reaches the grid)', async () => {
    const { ctx } = buildCtx([], fakeSource());
    const svc = new ExportService(ctx);
    const downloads: { blob: Blob; filename: string }[] = [];
    (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob =
      (blob, filename) => downloads.push({ blob, filename });

    await svc.exportTableCsv();

    const csv = await downloads[0].blob.text();
    expect(csv, 'control: the secret is genuinely detected as a cell').toContain(SECRET);
  });
});

/**
 * ROTATION is where the first version of this fix silently failed: `getViewport({scale:1})` defaults
 * `rotation` to `page.rotate`, so on /Rotate 90|270 it returns SWAPPED dims and the filter no-ops. Every
 * test above is at rotation 0, which is exactly why that shipped. These cover all four cardinal
 * rotations, on both axes (the page's own /Rotate and a user-applied rotation).
 */
describe('the table filter holds at every rotation', () => {
  for (const [pageRot, userRot] of [[90, 0], [180, 0], [270, 0], [0, 90], [90, 90], [270, 180]]) {
    it(`/Rotate ${pageRot} + user ${userRot}: the redacted cell is still absent`, async () => {
      // The redaction is expressed in DISPLAY space, i.e. where the user actually drew it over the
      // secret on screen — so it must be re-derived per rotation rather than reused verbatim.
      const totalRot = ((pageRot + userRot) % 360 + 360) % 360;
      const swap = totalRot % 180 === 90;
      const dispW = swap ? H : W;
      const dispH = swap ? W : H;
      const cover = coverInDisplaySpace(totalRot, dispW, dispH);

      const redaction = { pageId: 'p1', type: 'redaction', ...cover, color: '#000000' };
      const { ctx } = buildCtx([redaction], fakeSource(pageRot), userRot);
      const svc = new ExportService(ctx);
      const downloads: { blob: Blob; filename: string }[] = [];
      (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob =
        (blob, filename) => downloads.push({ blob, filename });

      await svc.exportTableCsv();
      expect(downloads).toHaveLength(1);
      const csv = await downloads[0].blob.text();
      expect(csv, `leaked at pageRot=${pageRot} userRot=${userRot}`).not.toContain(SECRET);
      // …and the innocent cells survive. Without this, "dropped everything" would pass the line above —
      // and at some rotations the buggy version really did drop the wrong region.
      expect(csv, `over-filtered at pageRot=${pageRot} userRot=${userRot}`).toContain('Mainz');
    });
  }
});

/**
 * OVERLAY text (a box the user typed) under a redaction. The PDF export removes it; three other exports
 * emitted it. Reviewed as "wired in exactly one of the three places", which was true — the filter had
 * been added to the assembler and to these two paths WITHOUT a test, so nothing held it there.
 */
describe('redaction removes overlay text from the non-PDF exports', () => {
  const OVERLAY = 'OVERLAY-CONFIDENTIAL-4417';

  /** A blank page with a typed text box, optionally covered by a redaction. */
  function overlayCtx(withRedaction: boolean): { ctx: IExportContext; downloads: { blob: Blob; filename: string }[] } {
    const text = Object.assign(
      new TextElement(20, 40, 'p1', { width: 300, height: 20, fontSize: 12 }),
      { text: OVERLAY },
    );
    const els: unknown[] = [text];
    if (withRedaction) els.push(new RedactionElement(15, 35, 320, 30, 'p1', '#000000'));
    const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
    const downloads: { blob: Blob; filename: string }[] = [];
    const ctx = {
      documentModel: {
        pageCount: 1,
        currentPageIndex: 0,
        pages: [{ id: 'p1', sourcePdfId: 'blank', sourcePageNum: 0, rotation: 0, blankWidth: W, blankHeight: H }],
        sourcePdfs: new Map(),
        watermark: { enabled: false },
        bates: { enabled: false },
      },
      elements: els,
      formValues: {},
      currentFilename: 'case.pdf',
      exportPassword: null,
      inkLayer: { getStrokes: () => [] },
      reportError: { info() {}, warn() {}, error() {} },
      progress: { begin: () => handle },
      cleanEmptyTextElements() {},
      renderCurrentPage: () => Promise.resolve(),
      rebuildElementLayer() {},
    } as unknown as IExportContext;
    return { ctx, downloads };
  }

  function attach(svc: ExportService, downloads: { blob: Blob; filename: string }[]): void {
    (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob =
      (blob, filename) => downloads.push({ blob, filename });
  }

  it('Markdown: covered overlay text is absent, uncovered text is present', async () => {
    const a = overlayCtx(true);
    const svcA = new ExportService(a.ctx);
    attach(svcA, a.downloads);
    await svcA.exportAsMarkdown();
    const covered = a.downloads.length ? await a.downloads[0].blob.text() : '';
    expect(covered, 'redacted overlay text must not reach the Markdown export').not.toContain(OVERLAY);

    // Control — without the redaction the SAME text does export, so the assertion above is not passing
    // simply because the overlay never reached the writer.
    const b = overlayCtx(false);
    const svcB = new ExportService(b.ctx);
    attach(svcB, b.downloads);
    await svcB.exportAsMarkdown();
    expect(await b.downloads[0].blob.text()).toContain(OVERLAY);
  });

  it('XFDF: a covered annotation is not exported, an uncovered one is', async () => {
    const a = overlayCtx(true);
    const svcA = new ExportService(a.ctx);
    attach(svcA, a.downloads);
    await svcA.exportXfdf();
    const covered = a.downloads.length ? await a.downloads[0].blob.text() : '';
    expect(covered, 'an XFDF carries the annotation TEXT — a covered one must not ship').not.toContain(OVERLAY);

    const b = overlayCtx(false);
    const svcB = new ExportService(b.ctx);
    attach(svcB, b.downloads);
    await svcB.exportXfdf();
    expect(await b.downloads[0].blob.text()).toContain(OVERLAY);
  });
});

describe('redaction is burned onto the OCR canvas before recognition', () => {
  /**
   * A fake pdf.js page whose viewport mimics the two behaviours the burn depends on: the transform is
   * relative to the VIEW BOX CORNER (so a non-zero CropBox origin shifts it), and `viewBox` is exposed so
   * the production code can add that origin back. A fixture hardcoding origin 0 cannot detect a dropped
   * origin term, which is why `ox`/`oy` are parameters.
   */
  function ocrSource(ox: number, oy: number): unknown {
    return {
      bytes: new Uint8Array(0),
      doc: {
        getPage: () => Promise.resolve({
          rotate: 0,
          getViewport: ({ scale = 1 }: { scale?: number; rotation?: number } = {}) => ({
            width: W * scale,
            height: H * scale,
            viewBox: [ox, oy, ox + W, oy + H],
            convertToViewportPoint: (x: number, y: number) => [(x - ox) * scale, (oy + H - y) * scale],
          }),
          render: () => ({ promise: Promise.resolve() }),
        }),
      },
    };
  }

  /** Run `_recognize` against `src`, collecting every fillRect the burn performs. */
  async function burnFills(src: unknown): Promise<number[][]> {
    const { OcrHandler } = await import('../../src/handlers/ocrHandler');
    const fills: number[][] = [];
    const ctx2d = {
      fillRect: (x: number, y: number, w: number, h: number) => { fills.push([x, y, w, h]); },
      set fillStyle(_v: string) {},
      get fillStyle() { return '#000000'; },
    };
    // Restored explicitly: vitest.config.ts sets no `restoreMocks`, so a stubbed getContext would leak
    // into every later test in this file and silently break anything that draws.
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx2d as unknown as CanvasRenderingContext2D);
    onTestFinished(() => spy.mockRestore());

    const redaction = new RedactionElement(10, 20, 30, 40, 'p1', '#000000');
    const app = {
      reportError: { info() {}, warn() {}, error() {} },
      documentModel: {
        pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
        sourcePdfs: new Map(),
      },
      historyManager: { execute: vi.fn() },
      elements: [redaction],
      rebuildElementLayer() {},
      autosave() {},
      _applySourcePdfEdit: () => Promise.resolve(true),
    };
    const handler = new OcrHandler(app as never);
    const page = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 };
    await (handler as unknown as {
      _recognize: (p: unknown, s: unknown, l: string) => Promise<unknown>;
    })._recognize(page, src, 'eng').catch(() => null);   // recognition itself bails in jsdom
    return fills;
  }

  it('fills each redaction rect at render scale, so the engine cannot read the text', async () => {
    // RENDER_SCALE is 2, so a 10,20,30x40 box must be filled at 20,40,60x80. Asserting the SCALED values
    // matters: an unscaled fill would cover a quarter of the intended area and leave the bottom-right of
    // the secret legible — a partial burn reads as "it works" in a screenshot.
    expect(await burnFills(ocrSource(0, 0)), 'the redaction must be burned before recognition')
      .toContainEqual([20, 40, 60, 80]);
  });

  it('honours a non-zero CropBox origin', async () => {
    // Element coords are relative to the rendered page box; `convertToViewportPoint` consumes ABSOLUTE
    // user space. Dropping the origin term burns 20pt off in both axes on a /CropBox [20 20 ...] page,
    // clipping the wrong strip and leaving part of the secret legible.
    expect(await burnFills(ocrSource(20, 20)), 'the burn must not shift with the CropBox origin')
      .toContainEqual([20, 40, 60, 80]);
  });
});

/**
 * Pure geometry of the blank-page filter. Lives in the JSDOM suite (it needs no browser) so it runs in the
 * fast gate — it was briefly in the browser file, which only slowed the same coverage down.
 */
describe('dropElementsUnderRedactions', () => {
  const mkText = (x: number, y: number, w: number, h: number) =>
    Object.assign(new TextElement(x, y, 'p1', { width: w, height: h }), { text: 'x' });

  it('drops a covered element, keeps the redaction and untouched content', async () => {
    const { dropElementsUnderRedactions } = await import('../../src/export/exportService');
    const covered = mkText(20, 30, 200, 20);
    const clear = mkText(20, 200, 200, 20);
    const red = new RedactionElement(15, 25, 220, 30, 'p1', '#000000');
    const kept = dropElementsUnderRedactions([covered, clear, red]);
    expect(kept).toContain(red);
    expect(kept).toContain(clear);
    expect(kept).not.toContain(covered);
  });

  it('returns the same array when the page carries no redaction', async () => {
    const { dropElementsUnderRedactions } = await import('../../src/export/exportService');
    const input = [mkText(10, 10, 10, 10), mkText(50, 50, 10, 10)];
    expect(dropElementsUnderRedactions(input)).toBe(input);
  });

  it('drops an element only PARTLY under the box', async () => {
    const { dropElementsUnderRedactions } = await import('../../src/export/exportService');
    const straddling = mkText(0, 0, 100, 100);
    const red = new RedactionElement(90, 90, 50, 50, 'p1', '#000000');
    expect(dropElementsUnderRedactions([straddling, red])).not.toContain(straddling);
  });

  it('keeps an element that merely TOUCHES an edge (no overlap is not a cover)', async () => {
    const { dropElementsUnderRedactions } = await import('../../src/export/exportService');
    const touching = mkText(150, 120, 10, 10);        // starts exactly at the redaction's right edge
    const red = new RedactionElement(100, 100, 50, 50, 'p1', '#000000');
    expect(dropElementsUnderRedactions([touching, red])).toContain(touching);
  });

  it('drops an element whose box is expressed with NEGATIVE dimensions', async () => {
    const { dropElementsUnderRedactions } = await import('../../src/export/exportService');
    // A negative width is reachable from resize maths; without normalisation the raw comparisons fail
    // OPEN and this element — which genuinely overlaps — would be kept and drawn as live text.
    const negative = Object.assign(mkText(160, 120, -30, 10), {});
    const red = new RedactionElement(100, 100, 50, 50, 'p1', '#000000');
    expect(dropElementsUnderRedactions([negative, red])).not.toContain(negative);
  });
});
