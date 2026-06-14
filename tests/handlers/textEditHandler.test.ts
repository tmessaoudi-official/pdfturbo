import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TextEditHandler } from '../../src/handlers/textEditHandler';

// ── Module mocks ──────────────────────────────────────────────────────────────

const { mockFindTextOpAt, mockReplaceTextAt, mockDeleteTextAt } = vi.hoisted(() => ({
  mockFindTextOpAt: vi.fn(),
  mockReplaceTextAt: vi.fn(),
  mockDeleteTextAt: vi.fn(),
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
  fillColorToHex:   vi.fn(() => null),
  getPageFontBaseName: vi.fn(() => ''),
}));

vi.mock('../../src/utils/flowDoc', () => ({
  extractPsName: vi.fn((name: string) => name),
}));

vi.mock('../../src/utils/i18n', () => ({
  t: (key: string) => key,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

type FakeItem = { str: string; transform: number[]; width: number; height: number; fontName: string };

function makeItem(str: string, tx: number, ty: number, w = 30, h = 14, fontName = 'Helvetica'): FakeItem {
  return { str, transform: [0, 0, 0, 0, tx, ty], width: w, height: h, fontName };
}

function makeFakePage(items: FakeItem[], pageHeight = 841) {
  return {
    rotate: 0,
    getViewport: vi.fn(() => ({ height: pageHeight })),
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
    _autosave: vi.fn(),
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
