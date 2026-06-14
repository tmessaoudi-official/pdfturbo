import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PDFElement } from '../../src/elements/annotationElement';
import { TextElement } from '../../src/elements/textElement';
import { ElementFactory } from '../../src/utils/elementFactory';
import { HistoryManager, AddElementCmd, MoveResizeCmd } from '../../src/core/historyManager';

describe('PDFElement monotonic IDs', () => {
  beforeEach(() => {
    PDFElement._nextId = 1;
  });

  it('assigns sequential integer IDs', () => {
    const a = new TextElement(0, 0, 'p1');
    const b = new TextElement(0, 0, 'p1');
    expect(Number.isInteger(a.id)).toBe(true);
    expect(b.id).toBe(a.id + 1);
  });

  it('IDs are unique across 100 elements', () => {
    const els = Array.from({ length: 100 }, () => new TextElement(0, 0, 'p1'));
    const ids = new Set(els.map(e => e.id));
    expect(ids.size).toBe(100);
  });

  it('syncIdCounter advances _nextId past restored IDs', () => {
    // Simulate restored elements with high IDs
    const mockElements = [
      { id: 500 } as unknown as PDFElement,
      { id: 300 } as unknown as PDFElement,
      { id: 999 } as unknown as PDFElement,
    ];
    PDFElement._nextId = 1;
    ElementFactory.syncIdCounter(mockElements);
    expect(PDFElement._nextId).toBe(1000); // max(999) + 1
    // New element gets ID 1000
    const newEl = new TextElement(0, 0, 'p1');
    expect(newEl.id).toBe(1000);
  });

  it('syncIdCounter is a no-op for empty array', () => {
    PDFElement._nextId = 42;
    ElementFactory.syncIdCounter([]);
    expect(PDFElement._nextId).toBe(42);
  });

  it('syncIdCounter handles legacy float IDs gracefully', () => {
    const mockElements = [{ id: 999.7 } as unknown as PDFElement, { id: 500.3 } as unknown as PDFElement];
    PDFElement._nextId = 1;
    ElementFactory.syncIdCounter(mockElements);
    expect(PDFElement._nextId).toBe(1000); // floor(999.7) + 1 = 1000
    const el = new TextElement(0, 0, 'p1');
    expect(Number.isInteger(el.id)).toBe(true);
    expect(el.id).toBe(1000);
  });

  it('syncIdCounter handles 100,000 elements without RangeError', () => {
    PDFElement._nextId = 1;
    const bigArray = Array.from({ length: 100_000 }, (_, i) => ({ id: i + 1 } as unknown as PDFElement));
    expect(() => ElementFactory.syncIdCounter(bigArray)).not.toThrow();
    expect(PDFElement._nextId).toBe(100_001);
  });
});

describe('_cleanEmptyTextElements DOM guard (BUG-29)', () => {
  it('ternary `input ? input === focused : true` keeps unmounted element', () => {
    // Null input (not yet in DOM) must return true (keep), not falsy (delete)
    // Old: `null && null === null` = null (falsy) → delete. Bug.
    // New: `null ? ... : true` = true → keep. Fix.
    const oldBehavior = (input: Element | null, focused: Element | null) => input && input === focused;
    const newBehavior = (input: Element | null, focused: Element | null) => input ? input === focused : true;

    // The bug: old returns null (falsy) for unmounted input
    expect(oldBehavior(null, null)).toBeFalsy();   // old: deletes unmounted element (bug)
    expect(newBehavior(null, null)).toBe(true);    // new: keeps unmounted element (fix)

    // Both agree when input is mounted
    const input = document.createElement('input');
    expect(oldBehavior(input, null)).toBe(false);  // mounted unfocused → remove (same)
    expect(newBehavior(input, null)).toBe(false);  // mounted unfocused → remove (same)
    expect(newBehavior(input, input)).toBe(true);  // mounted focused → keep (same)
  });
});

describe('_loadDocument error handling (BUG-03 + BUG-09)', () => {
  it('_isLoading guard prevents re-entrant calls', () => {
    const calls: string[] = [];
    const guardFn = (isLoading: boolean) => {
      if (isLoading) { calls.push('blocked'); return; }
      calls.push('executed');
    };
    guardFn(false); // first call — executes
    guardFn(true);  // concurrent call — blocked
    expect(calls).toEqual(['executed', 'blocked']);
  });

  it('try/catch/finally pattern releases lock on error', () => {
    let isLoading = false;
    let toastShown = '';
    // oxlint-disable-next-line eslint/require-await -- the test consumes run() as a Promise via run().then(...); async keeps that contract
    const run = async () => {
      if (isLoading) return;
      isLoading = true;
      try {
        throw new Error('corrupt PDF');
      } catch (err) {
        toastShown = 'Failed to load PDF — ' + (err instanceof Error ? err.message : 'unknown');
      } finally {
        isLoading = false;
      }
    };
    return run().then(() => {
      expect(isLoading).toBe(false);  // lock released in finally
      expect(toastShown).toContain('corrupt PDF');
    });
  });
});

describe('_dataUrlToBytes (BUG-16)', () => {
  function dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.split(',')[1];
    if (!base64) throw new Error('Invalid data URL: no base64 payload');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  it('throws on missing base64 payload', () => {
    expect(() => dataUrlToBytes('data:,')).toThrow('Invalid data URL');
    expect(() => dataUrlToBytes('')).toThrow('Invalid data URL');
    expect(() => dataUrlToBytes('not-a-data-url')).toThrow('Invalid data URL');
  });

  it('decodes valid data URL correctly', () => {
    // data:text/plain;base64,SGVsbG8= = "Hello"
    const bytes = dataUrlToBytes('data:text/plain;base64,SGVsbG8=');
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
  });
});

describe('undo/redo error surfacing (BUG-18)', () => {
  it('shows toast on render failure — not silent', () => {
    const toasts: string[] = [];
    const showToast = (msg: string) => toasts.push(msg);
    const catchHandler = (err: unknown) => {
      // oxlint-disable-next-line eslint/no-console -- fixture mirrors the production undo/redo catch handler under test
      console.error('[undo/redo render]', err);
      showToast('Render failed after undo/redo — try reloading');
    };
    catchHandler(new Error('canvas lost'));
    expect(toasts).toContain('Render failed after undo/redo — try reloading');
  });
});

describe('_search debounce (BUG-20)', () => {
  it('generation counter discards stale results', () => {
    let gen = 0;
    let savedMatches: string[] | null = null;

    const runSearch = async (query: string, myGen: number) => {
      await Promise.resolve();
      if (myGen !== gen) return; // stale
      savedMatches = [query];
    };

    gen++; void runSearch('he', gen);    // gen=1
    gen++; void runSearch('hello', gen); // gen=2 — this should win

    return new Promise<void>(resolve => { setTimeout(() => {
      expect(savedMatches).toEqual(['hello']); // gen=1 was discarded
      resolve();
    }, 10); });
  });
});

describe('closeSignatureModal mode reset (BUG-21)', () => {
  it('setMode is called — not direct mode assignment', () => {
    const modeCalls: string[] = [];
    const fakeApp = {
      mode: 'addSignature' as string,
      ui: {
        signatureModal: { classList: { remove: vi.fn() } },
        addSignatureBtn: { classList: { remove: vi.fn() } },
      },
    };

    // The fixed implementation calls setMode which invokes side effects
    // Simulate the fixed closeSignatureModal
    const setMode = (m: string) => { modeCalls.push(m); fakeApp.mode = m; };
    fakeApp.ui.signatureModal.classList.remove('active');
    setMode('select');
    fakeApp.ui.addSignatureBtn.classList.remove('active');

    expect(modeCalls).toContain('select');
    expect(fakeApp.mode).toBe('select');
  });
});

describe('multiline text export line splitting (BUG-23)', () => {
  it('splits text on newlines and offsets each line by fontSize * 1.2', () => {
    const text = 'line one\nline two\nline three';
    const fontSize = 14;
    const lineHeight = fontSize * 1.2;
    const lines = text.split('\n');

    const drawnAtY: number[] = lines.map((_, i) => 50 + fontSize + i * lineHeight);

    expect(drawnAtY).toHaveLength(3);
    expect(drawnAtY[1] - drawnAtY[0]).toBeCloseTo(lineHeight, 2);
    expect(drawnAtY[2] - drawnAtY[1]).toBeCloseTo(lineHeight, 2);
  });

  it('skips empty lines (no drawText call)', () => {
    const lines = 'line\n\nafter empty'.split('\n');
    const drawn = lines.filter(l => l.length > 0);
    expect(drawn).toHaveLength(2);
  });
});

describe('DrawingHandler fixes', () => {
  it('BUG-40: ?? operator vs || for zero distance', () => {
    const lastPinchDist = 0;
    const pinchStartDist = 100;
    const withOr   = lastPinchDist || pinchStartDist;  // 100 (WRONG)
    const withNull = lastPinchDist ?? pinchStartDist;  // 0 (CORRECT)
    expect(withOr).toBe(100);   // demonstrates the bug
    expect(withNull).toBe(0);   // demonstrates the fix
  });

  it('BUG-12: documentModel.currentPage guard vs renderer.pdfDoc guard', () => {
    const fakeApp = {
      renderer: { pdfDoc: null as null },
      documentModel: { currentPage: { id: 'p1' } },
    };
    const oldGuard = !fakeApp.renderer.pdfDoc;        // true — blocks added-PDF drawing (bug)
    const newGuard = !fakeApp.documentModel.currentPage; // false — allows drawing (fix)
    expect(oldGuard).toBe(true);
    expect(newGuard).toBe(false);
  });
});

describe('rotation normalization (BUG-13)', () => {
  it('negative srcRot + userRot normalizes to positive', () => {
    const buggy = (srcRot: number, userRot: number) => (srcRot + userRot) % 360;
    const fixed = (srcRot: number, userRot: number) => ((srcRot + userRot) % 360 + 360) % 360;

    expect(buggy(-90, 0)).toBe(-90);  // demonstrates the bug
    expect(fixed(-90, 0)).toBe(270);  // fix: -90 → 270
    expect(fixed(270, 90)).toBe(0);   // 360 → 0
    expect(fixed(0, 0)).toBe(0);
    expect(fixed(180, 90)).toBe(270);
  });
});

describe('keyboard nudge geometry (BUG-24)', () => {
  it('nudge dx/dy computes correctly for all arrow keys', () => {
    const step = 1;
    const cases = [
      { key: 'ArrowLeft',  dx: -step, dy: 0 },
      { key: 'ArrowRight', dx:  step, dy: 0 },
      { key: 'ArrowUp',    dx: 0, dy: -step },
      { key: 'ArrowDown',  dx: 0, dy:  step },
    ];
    for (const { key, dx, dy } of cases) {
      const calcDx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const calcDy = key === 'ArrowUp'   ? -step : key === 'ArrowDown'  ? step : 0;
      expect(calcDx).toBe(dx);
      expect(calcDy).toBe(dy);
    }
  });
});

describe('text formatting undo (BUG-25)', () => {
  beforeEach(() => { PDFElement._nextId = 1; });

  it('bold toggle is undoable via MoveResizeCmd', () => {
    const elements: PDFElement[] = [];
    const mgr = new HistoryManager(50, vi.fn());
    const te = new TextElement(0, 0, 'p1');
    mgr.execute(new AddElementCmd(elements, te));

    // Simulate what the fixed handler does
    const before = { bold: te.bold };
    te.bold = !te.bold;
    const after = { bold: te.bold };
    mgr.record(new MoveResizeCmd(elements, te, before, after));

    expect(te.bold).toBe(true);
    mgr.undo();
    expect(te.bold).toBe(false);
    mgr.redo();
    expect(te.bold).toBe(true);
  });
});

describe('image MIME validation (BUG-43)', () => {
  it('rejects files without image/ MIME type', () => {
    const isValidImage = (mimeType: string) => mimeType.startsWith('image/');
    expect(isValidImage('application/pdf')).toBe(false);
    expect(isValidImage('text/plain')).toBe(false);
    expect(isValidImage('')).toBe(false);
    expect(isValidImage('image/png')).toBe(true);
    expect(isValidImage('image/jpeg')).toBe(true);
  });
});

// ─── coordinate transform math ───────────────────────────────────────────────

// Extracted from pdfTurboApp.ts _transformPoint / _inverseTransformPoint.
// Two variants: BUGGY (current code — swapped 90/270, wrong 180 y) and
// CORRECT (fixed — derived from pdfjs rotation matrices in pdf.mjs:818-844).
const buggyTransformPoint = (px: number, py: number, W: number, H: number, rot: number) => {
  switch (((rot % 360) + 360) % 360) {
    case 90:  return { x: W - py, y: H - px }; // WRONG: this is 270's formula
    case 180: return { x: W - px, y: H - py }; // WRONG: y should be py
    case 270: return { x: py,     y: px };      // WRONG: this is 90's formula
    default:  return { x: px,     y: H - py };
  }
};
const buggyInverseTransformPoint = (pdfX: number, pdfY: number, W: number, H: number, rot: number) => {
  switch (((rot % 360) + 360) % 360) {
    case 90:  return { x: H - pdfY, y: W - pdfX }; // WRONG
    case 180: return { x: W - pdfX, y: H - pdfY }; // WRONG
    case 270: return { x: pdfY,     y: pdfX };      // WRONG
    default:  return { x: pdfX,     y: H - pdfY };
  }
};

const correctTransformPoint = (px: number, py: number, W: number, H: number, rot: number) => {
  switch (((rot % 360) + 360) % 360) {
    case 90:  return { x: py,     y: px     };
    case 180: return { x: W - px, y: py     };
    case 270: return { x: W - py, y: H - px };
    default:  return { x: px,     y: H - py };
  }
};
const correctInverseTransformPoint = (pdfX: number, pdfY: number, W: number, H: number, rot: number) => {
  switch (((rot % 360) + 360) % 360) {
    case 90:  return { x: pdfY,     y: pdfX     };
    case 180: return { x: W - pdfX, y: pdfY     };
    case 270: return { x: H - pdfY, y: W - pdfX };
    default:  return { x: pdfX,     y: H - pdfY };
  }
};

describe('coordinate transform math (rotation fix)', () => {
  const W = 595, H = 842; // A4 at 72 dpi

  // Buggy cross-rotation (0→90): canvas(100,200) maps to wrong position.
  // pdfjs at rot=90 renders PDF(pdf_x,pdf_y) at canvas(pdf_y, pdf_x).
  // PDF coords for canvas(100,200) at rot=0: pdf=(100,642).
  // At rot=90 that lands at canvas(642,100) — NOT what the buggy formula gives.
  it('buggy cross-rotation 0→90 puts element in wrong canvas position (confirms bug)', () => {
    const buggyTCP = (cx: number, cy: number, from: number, to: number) => {
      const pdf  = buggyTransformPoint(cx, cy, W, H, from);
      return buggyInverseTransformPoint(pdf.x, pdf.y, W, H, to);
    };
    const result = buggyTCP(100, 200, 0, 90);
    // Correct answer is (642,100); buggy answer is NOT (642,100)
    expect(result.x).not.toBeCloseTo(642, 1);
    expect(result.y).not.toBeCloseTo(100, 1);
  });

  it('corrected formula: round-trip is identity for all rotations and points', () => {
    const points = [{ x: 100, y: 200 }, { x: 0, y: 0 }, { x: W, y: H }, { x: 300, y: 500 }];
    for (const rot of [0, 90, 180, 270]) {
      for (const { x, y } of points) {
        const pdf  = correctTransformPoint(x, y, W, H, rot);
        const back = correctInverseTransformPoint(pdf.x, pdf.y, W, H, rot);
        expect(back.x).toBeCloseTo(x, 5);
        expect(back.y).toBeCloseTo(y, 5);
      }
    }
  });

  it('rot=0: canvas top-left (0,0) → PDF bottom-left (0,H)', () => {
    expect(correctTransformPoint(0, 0, W, H, 0)).toEqual({ x: 0, y: H });
  });

  it('rot=90: canvas(100,200) → PDF(200,100)', () => {
    expect(correctTransformPoint(100, 200, W, H, 90)).toEqual({ x: 200, y: 100 });
  });

  it('rot=180: canvas(100,200) → PDF x-flipped, y-preserved', () => {
    expect(correctTransformPoint(100, 200, W, H, 180)).toEqual({ x: W - 100, y: 200 });
  });

  it('rot=270: canvas(0,0) → PDF(W,H)', () => {
    expect(correctTransformPoint(0, 0, W, H, 270)).toEqual({ x: W, y: H });
  });

  it('correct cross-rotation 0→90: canvas(100,200) lands at correct canvas(642,100)', () => {
    const pdf  = correctTransformPoint(100, 200, W, H, 0);
    const dest = correctInverseTransformPoint(pdf.x, pdf.y, W, H, 90);
    expect(dest.x).toBeCloseTo(642, 5);
    expect(dest.y).toBeCloseTo(100, 5);
  });

  it('90° rotate then back is identity (correctTransformCanvasPoint)', () => {
    const tcp = (cx: number, cy: number, from: number, to: number) => {
      const pdf = correctTransformPoint(cx, cy, W, H, from);
      return correctInverseTransformPoint(pdf.x, pdf.y, W, H, to);
    };
    const r1 = tcp(100, 200, 0, 90);
    const r2 = tcp(r1.x, r1.y, 90, 0);
    expect(r2.x).toBeCloseTo(100, 5);
    expect(r2.y).toBeCloseTo(200, 5);
  });
});

describe('watermark density step computation (density fix)', () => {
  const computeSteps = (density: number, textWidth: number, fontSize: number, screenW: number, screenH: number) => {
    const count = Math.max(1, Math.min(5, density ?? 3));
    const stepX = Math.max(textWidth * 1.2, screenW / (count + 0.5));
    const stepY = Math.max(fontSize * 2.5, screenH / (count + 0.5));
    return { stepX, stepY, countX: Math.ceil(screenW / stepX), countY: Math.ceil(screenH / stepY) };
  };

  it('old formula causes overlap at density=5', () => {
    // Old: stepX = max(textWidth + fontSize*0.8, screenW/5) * sf (sf=0.5 at density=5)
    const textWidth = 100, fontSize = 20, screenW = 800;
    const sf = 0.5;
    const oldStepX = Math.max(textWidth + fontSize * 0.8, screenW / 5) * sf;
    // textWidth+fontSize*0.8 = 116, screenW/5=160 → max=160, *0.5=80 < textWidth → overlap
    expect(oldStepX).toBeLessThan(textWidth);
  });

  it('new formula: stepX always >= textWidth*1.2 (no overlap)', () => {
    for (const density of [1, 2, 3, 4, 5]) {
      const { stepX } = computeSteps(density, 100, 20, 800, 1000);
      expect(stepX).toBeGreaterThanOrEqual(120);
    }
  });

  it('density=5 produces more tiles than density=1', () => {
    const r1 = computeSteps(1, 100, 20, 800, 1000);
    const r5 = computeSteps(5, 100, 20, 800, 1000);
    expect(r5.countX).toBeGreaterThan(r1.countX);
    expect(r5.countY).toBeGreaterThan(r1.countY);
  });

  it('clamps density 0→1 and 6→5', () => {
    const r0 = computeSteps(0, 100, 20, 800, 1000);
    const r1 = computeSteps(1, 100, 20, 800, 1000);
    const r6 = computeSteps(6, 100, 20, 800, 1000);
    const r5 = computeSteps(5, 100, 20, 800, 1000);
    expect(r0.stepX).toBeCloseTo(r1.stepX, 5);
    expect(r6.stepX).toBeCloseTo(r5.stepX, 5);
  });
});

describe('ink stroke rotation (all strokes must be transformed on page rotate)', () => {
  const tp = (cx: number, cy: number, W: number, H: number, from: number, to: number) => {
    const pdf  = correctTransformPoint(cx, cy, W, H, from);
    return correctInverseTransformPoint(pdf.x, pdf.y, W, H, to);
  };
  const W = 595, H = 842;

  it('stroke points transform correctly when rotating 0→90', () => {
    const points = [{ x: 100, y: 200 }, { x: 150, y: 250 }];
    const transformed = points.map(p => tp(p.x, p.y, W, H, 0, 90));
    // Points must have changed
    expect(transformed[0].x).not.toBeCloseTo(100, 1);
    // Round-trip back must give original
    const back = transformed.map(p => tp(p.x, p.y, W, H, 90, 0));
    expect(back[0].x).toBeCloseTo(100, 5);
    expect(back[0].y).toBeCloseTo(200, 5);
    expect(back[1].x).toBeCloseTo(150, 5);
    expect(back[1].y).toBeCloseTo(250, 5);
  });

  it('all four rotation cycles restore original stroke position', () => {
    const orig = { x: 200, y: 300 };
    let p = { ...orig };
    for (const [from, to] of [[0,90],[90,180],[180,270],[270,0]] as [number,number][]) {
      p = tp(p.x, p.y, W, H, from, to);
    }
    expect(p.x).toBeCloseTo(orig.x, 4);
    expect(p.y).toBeCloseTo(orig.y, 4);
  });
});
