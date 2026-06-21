import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TextEditHandler, clusterBaselineRun } from '../../src/handlers/textEditHandler';

// ── Module mocks ──────────────────────────────────────────────────────────────

const { mockFindTextOpAt, mockReplaceTextAt, mockDeleteTextAt, mockGetEditableTextAt, mockAddDecorationAt } = vi.hoisted(() => ({
  mockFindTextOpAt: vi.fn(),
  mockReplaceTextAt: vi.fn(),
  mockDeleteTextAt: vi.fn(),
  mockGetEditableTextAt: vi.fn(),
  mockAddDecorationAt: vi.fn(),
}));

vi.mock('@cantoo/pdf-lib', () => ({
  PDFDocument: { load: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../src/utils/contentStreamEditor', () => ({
  findTextOpAt:     mockFindTextOpAt,
  deleteTextAt:     mockDeleteTextAt,
  replaceTextAt:    mockReplaceTextAt,
  changeSizeAt:     vi.fn(),
  changeColorAt:    vi.fn(),
  addDecorationAt:  mockAddDecorationAt,
  fillColorToHex:   vi.fn(() => null),
  getPageFontBaseName: vi.fn(() => ''),
  // G8: prefill comes from the matched content-stream op's decoded text. Default
  // null → handler keeps best.str (the pre-G8 behaviour the other tests assume).
  getEditableTextAt: mockGetEditableTextAt,
}));

vi.mock('../../src/utils/flowDoc', () => ({
  extractPsName: vi.fn((name: string) => name),
  // Real Arabic-script test (mirrors the source regex) so the handler's
  // Arabic pre-route is exercised faithfully without importing the heavy module.
  isArabicText: vi.fn((s: string) => /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(s)),
}));

vi.mock('../../src/utils/i18n', () => ({
  t: (key: string) => key,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

type FakeItem = { str: string; transform: number[]; width: number; height: number; fontName: string };

function makeItem(str: string, tx: number, ty: number, w = 30, h = 14, fontName = 'Helvetica'): FakeItem {
  return { str, transform: [0, 0, 0, 0, tx, ty], width: w, height: h, fontName };
}

function makeFakePage(items: FakeItem[], pageHeight = 841, rotation = 0, pageWidth = 600) {
  // Mirror pdf.js PageViewport.convertToPdfPoint (scale 1) per rotation so the
  // handler's rotation-aware click mapping can be unit-tested. Rotation 0 ==
  // the legacy [x, H - y] flip, so the pre-existing cases keep passing.
  const norm = ((rotation % 360) + 360) % 360;
  const convertToPdfPoint = (x: number, y: number): [number, number] => {
    switch (norm) {
      case 90:  return [y, x];
      case 180: return [pageWidth - x, y];
      case 270: return [pageWidth - y, pageHeight - x];
      default:  return [x, pageHeight - y];
    }
  };
  const vpW = norm % 180 === 0 ? pageWidth : pageHeight;
  const vpH = norm % 180 === 0 ? pageHeight : pageWidth;
  return {
    rotate: 0,
    getViewport: vi.fn(() => ({ width: vpW, height: vpH, convertToPdfPoint })),
    getTextContent: vi.fn(() => Promise.resolve({ items, styles: {} })),
  };
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
    { left: 0, top: 0, right: 600, bottom: 842, width: 600, height: 842, x: 0, y: 0 } as DOMRect,
  );
  canvas.getContext = vi.fn(() => null) as typeof canvas.getContext;
  return canvas;
}

function makeApp(canvas: HTMLCanvasElement, fakePage: ReturnType<typeof makeFakePage>) {
  const src = {
    bytes: new Uint8Array(10),
    doc: { getPage: vi.fn().mockResolvedValue(fakePage) },
  };
  const ui = {
    canvas,
    boldBtn:       Object.assign(document.createElement('button'), { disabled: false }),
    italicBtn:     Object.assign(document.createElement('button'), { disabled: false }),
    underlineBtn:  Object.assign(document.createElement('button'), { disabled: false }),
    strikeBtn:     Object.assign(document.createElement('button'), { disabled: false }),
    fontSizeInput: Object.assign(document.createElement('input'),  { disabled: false }),
    fontFamily:    Object.assign(document.createElement('select'), { disabled: false }),
    colorInput:    Object.assign(document.createElement('input'),  { value: '#000000' }),
    container:     document.createElement('div'),
  };
  return {
    documentModel: {
      currentPage: { id: 'page-1', sourcePdfId: 'src-1', sourcePageNum: 1, rotation: 0 },
      sourcePdfs: new Map([['src-1', src]]),
    },
    ui,
    zoomScale: 1,
    historyManager: { execute: vi.fn() },
    autosave: vi.fn(),
    setMode: vi.fn(),
    selectElement: vi.fn(),
    addTextAtPosition: vi.fn(),
    _applySourcePdfEdit: vi.fn().mockResolvedValue(undefined),
    reportError: { info: vi.fn(), warn: vi.fn(), silent: vi.fn() },
  };
}

function click(x: number, y: number) {
  return new MouseEvent('click', { clientX: x, clientY: y, bubbles: true });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TextEditHandler — multi-candidate true-edit fallback', () => {
  let handler: TextEditHandler;

  beforeEach(() => {
    handler = new TextEditHandler();
    mockFindTextOpAt.mockReset();
    mockReplaceTextAt.mockReset();
    mockDeleteTextAt.mockReset();
    // Default: no decoded op text → handler keeps best.str (pre-G8 behaviour).
    mockGetEditableTextAt.mockReset();
    mockGetEditableTextAt.mockReturnValue(null);
  });

  afterEach(() => {
    // Remove any inline editor appended to body
    document.body.querySelectorAll('.true-edit-input').forEach(el => el.remove());
  });

  it('activates true-edit using a nearby fallback item when the best item has no content-stream match', async () => {
    // Layout (PDF coords, pageH=841):
    //   click at canvas (160, 384) → pdfY = 841 - 384 = 457
    //   itemA "de"          at (157, 453) — closer to click center, no CS match
    //   itemB "Attestation" at (161, 457) — slightly farther,       HAS CS match
    const pageH = 841;
    const itemA = makeItem('de',          157, 453);
    const itemB = makeItem('Attestation', 161, 457);

    mockFindTextOpAt.mockImplementation((_doc: unknown, _idx: unknown, origin: { x: number; y: number }) => {
      if (Math.abs(origin.x - 161) < 1 && Math.abs(origin.y - 457) < 1) {
        return { fontKey: 'F1', fontSize: 14, fillColor: undefined };
      }
      return null;
    });

    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([itemA, itemB], pageH));
    await handler.handleCanvasClick(click(160, 384), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

    // True-edit input must have been appended
    expect(document.body.querySelector('.true-edit-input')).not.toBeNull();
    // Overlay path must NOT have fired
    expect((app.historyManager.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('uses the best item origin directly when it matches the content stream on the first try', async () => {
    const pageH = 841;
    const item = makeItem('Hello', 100, 600);

    mockFindTextOpAt.mockImplementation((_doc: unknown, _idx: unknown, origin: { x: number; y: number }) => {
      if (Math.abs(origin.x - 100) < 1 && Math.abs(origin.y - 600) < 1) {
        return { fontKey: 'F1', fontSize: 12, fillColor: undefined };
      }
      return null;
    });

    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([item], pageH));
    // click near item: pdfY = 841 - (841-600) = 600
    await handler.handleCanvasClick(click(115, 241), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

    expect(document.body.querySelector('.true-edit-input')).not.toBeNull();
    // findTextOpAt called at most twice (best succeeds on first try)
    const calls = (mockFindTextOpAt as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][2]).toMatchObject({ x: 100, y: 600 });
  });

  // G8: pdf.js splits a glyph-positioned word into one item per glyph, so
  // `best.str` is a single character while the matched content-stream op holds
  // the whole word. The inline editor must prefill from getEditableTextAt (the
  // matched op's own decoded text) — exactly what replaceTextAt will replace — so
  // editing the prefilled value can't corrupt the whole word down to one glyph.
  it('prefills the inline editor from getEditableTextAt (matched op text), not best.str (G8)', async () => {
    const pageH = 841;
    // `best` is a single mid-word glyph ('l') — the historic prefill source.
    const item = makeItem('l', 100, 600);

    mockFindTextOpAt.mockImplementation((_doc: unknown, _idx: unknown, origin: { x: number; y: number }) => {
      if (Math.abs(origin.x - 100) < 1 && Math.abs(origin.y - 600) < 1) {
        return { fontKey: 'F1', fontSize: 12, fillColor: undefined };
      }
      return null;
    });
    // The matched content-stream op decodes to the WHOLE word.
    mockGetEditableTextAt.mockReturnValue('Hello');

    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([item], pageH));
    await handler.handleCanvasClick(click(115, 241), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

    const input = document.body.querySelector('.true-edit-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    // Prefill is the whole-word op text, NOT the single clicked glyph.
    expect(input.value).toBe('Hello');
    expect(input.value).not.toBe('l');
    // getEditableTextAt was queried at the matched origin with the true-edit tolerance.
    const geCalls = (mockGetEditableTextAt as ReturnType<typeof vi.fn>).mock.calls;
    expect(geCalls.length).toBe(1);
    expect(geCalls[0][2]).toMatchObject({ x: 100, y: 600 });
  });

  // G8 safety: when getEditableTextAt can't decode the matched op (returns null),
  // the handler must fall back to best.str — never an empty / lost prefill.
  it('falls back to best.str when getEditableTextAt returns null (G8 safe fallback)', async () => {
    const pageH = 841;
    const item = makeItem('Hello', 100, 600);
    mockFindTextOpAt.mockImplementation((_doc: unknown, _idx: unknown, origin: { x: number; y: number }) => {
      if (Math.abs(origin.x - 100) < 1 && Math.abs(origin.y - 600) < 1) {
        return { fontKey: 'F1', fontSize: 12, fillColor: undefined };
      }
      return null;
    });
    mockGetEditableTextAt.mockReturnValue(null);

    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([item], pageH));
    await handler.handleCanvasClick(click(115, 241), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

    const input = document.body.querySelector('.true-edit-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('Hello'); // best.str, since decode gave null
  });

  // R2 (2026-06-15 QA sweep): on a ROTATED page the click→content mapping must
  // go through viewport.convertToPdfPoint, not the naive `pdfY = pageH - canvasY`
  // (only valid at rotation 0). With the bug, a click on text on a 90° page never
  // matched any text-item transform → no editor opened.
  it('maps the click through the rotated viewport so edit-text works on a 90° page', async () => {
    // Unrotated page 500×800; item "Rotated" at content (100, 600).
    // At rotation 90 the test viewport maps convertToPdfPoint(x,y) = [y, x],
    // so a click at viewport (600, 100) → content (100, 600) = the item.
    const item = makeItem('Rotated', 100, 600);
    mockFindTextOpAt.mockImplementation((_doc: unknown, _idx: unknown, origin: { x: number; y: number }) => {
      if (Math.abs(origin.x - 100) < 1 && Math.abs(origin.y - 600) < 1) {
        return { fontKey: 'F1', fontSize: 12, fillColor: undefined };
      }
      return null;
    });

    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([item], 800, 90, 500));
    app.documentModel.currentPage.rotation = 90;

    await handler.handleCanvasClick(click(600, 100), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

    // The rotation-aware mapping found the text and opened the true-edit input.
    expect(document.body.querySelector('.true-edit-input')).not.toBeNull();
    const calls = (mockFindTextOpAt as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][2]).toMatchObject({ x: 100, y: 600 });
  });

  it('falls back to overlay when no nearby item matches the content stream', async () => {
    mockFindTextOpAt.mockResolvedValue(null);

    const item = makeItem('hello', 100, 400);
    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([item]));
    // pdfY = 841 - (841-400) = 400
    await handler.handleCanvasClick(click(115, 441), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

    // Overlay added two elements (redaction + text) via MacroCmd
    expect((app.historyManager.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    expect(document.body.querySelector('.true-edit-input')).toBeNull();
    // Honest UX (#1): the user is told it became an editable overlay, not a silent
    // in-place edit — the fallback must never be a silent surprise.
    expect((app.reportError.info as ReturnType<typeof vi.fn>).mock.calls.flat()).toContain('toast.trueEditOverlay');
  });

  // BUG A1 (commit-time): the editor opens for a non-XObject target, but the
  // true edit fails at commit time (replaceTextAt returns false — e.g. a Type3 /
  // invisible / vertical font that only A5 detects at commit). The handler used
  // to silently `return`, discarding the user's typed change. It must instead
  // fall back to the overlay (redaction cover + text) built from context captured
  // when the inline editor opened — never a silent no-op.
  it('falls back to overlay when replaceTextAt fails at commit time (A1 commit-time)', async () => {
    const pageH = 841;
    const item = makeItem('Heading', 100, 600);

    // Click-time: target found, NOT an XObject → editor opens.
    mockFindTextOpAt.mockImplementation((_doc: unknown, _idx: unknown, origin: { x: number; y: number }) => {
      if (Math.abs(origin.x - 100) < 1 && Math.abs(origin.y - 600) < 1) {
        return { fontKey: 'F1', fontSize: 12, fillColor: undefined };
      }
      return null;
    });
    // Commit-time: the true edit refuses.
    mockReplaceTextAt.mockResolvedValue(false);

    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([item], pageH));
    await handler.handleCanvasClick(
      click(115, 241),
      app as unknown as Parameters<typeof handler.handleCanvasClick>[1],
    );

    const input = document.body.querySelector('.true-edit-input') as HTMLInputElement;
    expect(input).not.toBeNull();

    // User edits the text and commits (Enter).
    input.value = 'Changed Heading';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Allow the async commit() to settle.
    await new Promise<void>(r => { setTimeout(r, 0); });

    // Overlay MacroCmd (redaction + text) must have fired — not a silent no-op.
    expect((app.historyManager.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    // The true edit must NOT have been persisted.
    expect((app._applySourcePdfEdit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  // Slice B: when replaceTextAt reports 'substituted' (the embedded font was
  // redrawn in a base-14 substitute), the commit must tell the user honestly via
  // toast.trueEditFontSubstituted — NOT the plain trueTextEdited.
  it('fires the font-substituted toast when replaceTextAt substitutes the font (Path 3)', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    (PDFDocument.load as ReturnType<typeof vi.fn>).mockResolvedValue({
      save: vi.fn().mockResolvedValue(new Uint8Array([1])),
    });
    const item = makeItem('Heading', 100, 600);
    mockFindTextOpAt.mockImplementation((_d: unknown, _i: unknown, o: { x: number; y: number }) =>
      Math.abs(o.x - 100) < 1 && Math.abs(o.y - 600) < 1 ? { fontKey: 'F1', fontSize: 12, fillColor: undefined } : null);
    mockReplaceTextAt.mockResolvedValue('substituted');

    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([item], 841));
    (app._applySourcePdfEdit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await handler.handleCanvasClick(click(115, 241), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

    const input = document.body.querySelector('.true-edit-input') as HTMLInputElement;
    input.value = 'Changed';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise<void>(r => { setTimeout(r, 0); });

    const infos = (app.reportError.info as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(infos).toContain('toast.trueEditFontSubstituted');
    expect(infos).not.toContain('toast.trueTextEdited');
  });

  it('fires the plain edited toast (not substituted) when the font is kept', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    (PDFDocument.load as ReturnType<typeof vi.fn>).mockResolvedValue({
      save: vi.fn().mockResolvedValue(new Uint8Array([1])),
    });
    const item = makeItem('Heading', 100, 600);
    mockFindTextOpAt.mockImplementation((_d: unknown, _i: unknown, o: { x: number; y: number }) =>
      Math.abs(o.x - 100) < 1 && Math.abs(o.y - 600) < 1 ? { fontKey: 'F1', fontSize: 12, fillColor: undefined } : null);
    mockReplaceTextAt.mockResolvedValue(true);

    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([item], 841));
    (app._applySourcePdfEdit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await handler.handleCanvasClick(click(115, 241), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

    const input = document.body.querySelector('.true-edit-input') as HTMLInputElement;
    input.value = 'Changed';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise<void>(r => { setTimeout(r, 0); });

    const infos = (app.reportError.info as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(infos).toContain('toast.trueTextEdited');
    expect(infos).not.toContain('toast.trueEditFontSubstituted');
  });

  // B2: toggling Underline during a true edit (no text change) must APPEND a
  // standalone decoration via addDecorationAt — keeping the original font — and
  // still save, even though nothing else changed.
  it('adds an underline decoration on a decoration-only true edit', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    (PDFDocument.load as ReturnType<typeof vi.fn>).mockResolvedValue({
      save: vi.fn().mockResolvedValue(new Uint8Array([1])),
    });
    const item = makeItem('Hello', 100, 600);
    mockFindTextOpAt.mockImplementation((_d: unknown, _i: unknown, o: { x: number; y: number }) =>
      Math.abs(o.x - 100) < 1 && Math.abs(o.y - 600) < 1 ? { fontKey: 'F1', fontSize: 12, fillColor: undefined } : null);
    mockAddDecorationAt.mockReset();
    mockAddDecorationAt.mockResolvedValue(true);

    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([item], 841));
    (app._applySourcePdfEdit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await handler.handleCanvasClick(click(115, 241), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

    // Toggle Underline ON (session-local listener flips btn-active-fmt), keep text.
    app.ui.underlineBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = document.body.querySelector('.true-edit-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise<void>(r => { setTimeout(r, 0); });

    const decoCalls = (mockAddDecorationAt as ReturnType<typeof vi.fn>).mock.calls;
    expect(decoCalls.length).toBe(1);
    expect(decoCalls[0][3]).toBe('underline');
    expect((app.reportError.info as ReturnType<typeof vi.fn>).mock.calls.flat()).toContain('toast.trueTextEdited');
  });

  // B2: with no decoration toggled and no text/style change, addDecorationAt must
  // NOT be called and no revision is written (no silent no-op edit).
  it('does not add a decoration when neither underline nor strike is toggled', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const save = vi.fn().mockResolvedValue(new Uint8Array([1]));
    (PDFDocument.load as ReturnType<typeof vi.fn>).mockResolvedValue({ save });
    const item = makeItem('Hello', 100, 600);
    mockFindTextOpAt.mockImplementation((_d: unknown, _i: unknown, o: { x: number; y: number }) =>
      Math.abs(o.x - 100) < 1 && Math.abs(o.y - 600) < 1 ? { fontKey: 'F1', fontSize: 12, fillColor: undefined } : null);
    mockAddDecorationAt.mockReset();

    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([item], 841));
    await handler.handleCanvasClick(click(115, 241), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

    const input = document.body.querySelector('.true-edit-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise<void>(r => { setTimeout(r, 0); });

    expect((mockAddDecorationAt as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });

  // UX (Sprint 3): editText must edit EXISTING source text ONLY. A blank-area
  // click must NOT drop a new text box (the ISSUE-5 unification did, which trapped
  // the user in a non-interactive mode — elements are pointer-events:none outside
  // 'select' — so the box was unselectable and every further click spawned another
  // box). New text is created with the dedicated draw-to-place "Add Text" tool.
  it('does NOT create a box on a blank-area click (editText edits existing text only)', async () => {
    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([])); // no text items → best stays null
    await handler.handleCanvasClick(
      click(300, 300),
      app as unknown as Parameters<typeof handler.handleCanvasClick>[1],
    );

    // No blank-drop: addTextAtPosition must NOT be called and no element created.
    expect((app.addTextAtPosition as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect((app.historyManager.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(document.body.querySelector('.true-edit-input')).toBeNull();
    // Feedback: the editText hint is (re)shown so the user knows to click a word.
    expect((app.reportError.info as ReturnType<typeof vi.fn>).mock.calls.flat())
      .toContain('toast.modeHint.editText');
  });

  // BUG A1: when the only content-stream match lives inside a Form XObject, the
  // true editor opened but replaceTextAt refused → click+type did NOTHING. The
  // handler must treat an inXObject target as a MISS and fall back to the overlay
  // path, exactly like the no-match case (never a silent no-op).
  it('falls back to overlay when the only match is inside a Form XObject (A1)', async () => {
    mockFindTextOpAt.mockImplementation((_doc: unknown, _idx: unknown, origin: { x: number; y: number }) => {
      if (Math.abs(origin.x - 100) < 1 && Math.abs(origin.y - 400) < 1) {
        return { fontKey: 'F1', fontSize: 12, fillColor: undefined, inXObject: true };
      }
      return null;
    });

    const item = makeItem('hello', 100, 400);
    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage([item]));
    // pdfY = 841 - (841-400) = 400
    await handler.handleCanvasClick(click(115, 441), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

    // Overlay (redaction + text) must fire — not a silent no-op.
    expect((app.historyManager.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    // The true-edit inline input must NOT have opened.
    expect(document.body.querySelector('.true-edit-input')).toBeNull();
  });
});

// ── G7: clustered baseline run for the overlay text + bbox ──────────────────────
// pdf.js emits ONE ITEM PER GLYPH on glyph-positioned PDFs (all Arabic, kerned /
// justified Latin), so the historic overlay (best.str + Math.max(best.width,40))
// covered ~a word but carried a single character. clusterBaselineRun re-assembles
// the contiguous same-baseline, same-font run around the clicked glyph so the
// overlay text + cover span the WHOLE clicked word.

describe('clusterBaselineRun', () => {
  // fontSize derives from hypot(transform[0],transform[1]); makeItem uses a zero
  // scale matrix, so the helper falls back to item height (14) — thresholds are
  // 0.3*14=4.2 (baseline band) and 1.0*14=14 (inter-item gap break).
  const item = (str: string, tx: number, ty: number, w = 10, h = 14, fontName = 'F1'): FakeItem =>
    ({ str, transform: [0, 0, 0, 0, tx, ty], width: w, height: h, fontName });

  it('clusters a row of single-glyph Latin items into the full word with a spanning bbox', () => {
    // "Hello" — five 1-char glyphs abutting on baseline 600, x = 100,110,…,140.
    const items = [
      item('H', 100, 600), item('e', 110, 600), item('l', 120, 600),
      item('l', 130, 600), item('o', 140, 600),
    ];
    const run = clusterBaselineRun(items, items[2]); // clicked the middle 'l'
    expect(run.text).toBe('Hello');
    expect(run.x).toBe(100);
    // bbox spans first glyph left (100) → last glyph right (140+10) = width 50.
    expect(run.width).toBe(50);
    expect(run.y).toBe(600);
    expect(run.height).toBe(14);
    // NOT the single-glyph width (10) and NOT the 40pt floor.
    expect(run.width).not.toBe(10);
    expect(run.width).not.toBe(40);
  });

  it('clusters a row of single-glyph Arabic items into the full word (no reversal)', () => {
    // "مرحبا" — five 1-char glyphs in visual order on baseline 500.
    const items = [
      item('م', 100, 500), item('ر', 110, 500), item('ح', 120, 500),
      item('ب', 130, 500), item('ا', 140, 500),
    ];
    const run = clusterBaselineRun(items, items[0]);
    // Concatenated by ascending x (visual order) — the Arabic overlay renderer
    // re-shapes RTL, so the helper must NOT reverse here.
    expect(run.text).toBe('مرحبا');
    expect(run.width).toBe(50);
  });

  it('returns only the clicked word when two words are separated by a real space', () => {
    // "foo bar": foo at x=100,110,120 then a wide gap (space ≥ 1*fontSize) then
    // bar at x=140,150,160. Clicking 'b' must return only "bar".
    const items = [
      item('f', 100, 600), item('o', 110, 600), item('o', 120, 600),
      item('b', 140, 600), item('a', 150, 600), item('r', 160, 600),
    ];
    // gap foo→bar = 140 - (120+10) = 10 < 14 would NOT break; widen the gap so it
    // exceeds 1*fontSize: move 'b' to x=145 → gap = 145 - 130 = 15 > 14.
    items[3].transform[4] = 145; items[4].transform[4] = 155; items[5].transform[4] = 165;
    const run = clusterBaselineRun(items, items[3]); // clicked 'b'
    expect(run.text).toBe('bar');
    expect(run.x).toBe(145);
  });

  it('breaks the run at a whitespace-only item between two words', () => {
    // "ab cd" where the space is its own pdf.js item (str === ' ').
    const items = [
      item('a', 100, 600), item('b', 110, 600),
      item(' ', 120, 600, 6), item('c', 128, 600), item('d', 138, 600),
    ];
    const run = clusterBaselineRun(items, items[0]); // clicked 'a'
    expect(run.text).toBe('ab');
    expect(run.width).toBe(20); // 100 → 110+10
  });

  it('excludes items on a different baseline (different line)', () => {
    const items = [
      item('a', 100, 600), item('b', 110, 600),
      item('X', 120, 560), // 40pt below baseline → outside 4.2 band
    ];
    const run = clusterBaselineRun(items, items[0]);
    expect(run.text).toBe('ab');
  });

  it('excludes items in a different font even on the same baseline', () => {
    const items = [
      item('a', 100, 600, 10, 14, 'F1'), item('b', 110, 600, 10, 14, 'F1'),
      item('c', 120, 600, 10, 14, 'F2'),
    ];
    const run = clusterBaselineRun(items, items[0]);
    expect(run.text).toBe('ab');
  });
});

// ── G7: Arabic click drops a whole-word overlay (the user's #1 pain) ─────────────
// Clicking Arabic source text used to open the inline editor pre-filled with ONE
// glyph, refuse Arabic at commit (replaceTextAt → overlay), and leave a 40pt
// redaction cover with a one-glyph text box. The Arabic pre-route now skips the
// inline editor and drops the clustered overlay directly: a redaction cover + an
// editable text box BOTH spanning the whole clicked word.
describe('TextEditHandler — G7 Arabic clustered overlay', () => {
  let handler: TextEditHandler;

  beforeEach(() => {
    handler = new TextEditHandler();
    mockFindTextOpAt.mockReset();
    mockReplaceTextAt.mockReset();
    mockDeleteTextAt.mockReset();
  });

  afterEach(() => {
    document.body.querySelectorAll('.true-edit-input').forEach(el => el.remove());
  });

  it('drops a whole-word overlay (full text + word-width cover) on an Arabic click, no inline editor', async () => {
    // "مرحبا" as five single-glyph items on baseline 500, x = 100..140, width 10.
    // pageH=841 → click at canvas (120, 341) maps to pdfY = 500.
    const pageH = 841;
    const mk = (str: string, tx: number): FakeItem =>
      ({ str, transform: [0, 0, 0, 0, tx, 500], width: 10, height: 14, fontName: 'F1' });
    const items = [mk('م', 100), mk('ر', 110), mk('ح', 120), mk('ب', 130), mk('ا', 140)];

    // Capture the elements added via the MacroCmd to assert text + width.
    const added: { text?: string; width?: number; type: string }[] = [];

    const canvas = makeCanvas();
    const app = makeApp(canvas, makeFakePage(items, pageH));
    (app.historyManager.execute as ReturnType<typeof vi.fn>).mockImplementation((cmd: unknown) => {
      // MacroCmd holds `cmds: Command[]`; each AddElementCmd holds `el: PDFElement`
      // (TS `private` keeps the runtime field name — see core/commands/*).
      const macro = cmd as { cmds?: { el?: { text?: string; width?: number; constructor: { name: string } } }[] };
      for (const c of macro.cmds ?? []) {
        if (c.el) added.push({ text: c.el.text, width: c.el.width, type: c.el.constructor.name });
      }
    });

    await handler.handleCanvasClick(
      click(120, 341),
      app as unknown as Parameters<typeof handler.handleCanvasClick>[1],
    );

    // No inline editor — the Arabic pre-route bypasses it entirely.
    expect(document.body.querySelector('.true-edit-input')).toBeNull();
    // The overlay MacroCmd fired (redaction + text).
    expect((app.historyManager.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    // replaceTextAt (the in-place path) must NOT have been called.
    expect((mockReplaceTextAt as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    const textEl = added.find(a => a.type === 'TextElement');
    const cover = added.find(a => a.type === 'RedactionElement');
    expect(textEl?.text).toBe('مرحبا');             // whole run, not one glyph
    // Cover width ≈ run width (50) + 4 inset = 54 — NOT the 40pt floor (+4 = 44).
    expect(cover?.width).toBeGreaterThan(50);
    expect(cover?.width).not.toBe(44);
  });
});
