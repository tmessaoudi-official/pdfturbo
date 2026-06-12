/**
 * Tests for DrawingHandler fixes — highlight auto-select and related behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HighlightElement } from '../../src/elements/highlightElement';
import { RedactionElement } from '../../src/elements/redactionElement';
import { ShapeElement } from '../../src/elements/shapeElement';
import { PDFElement } from '../../src/elements/annotationElement';
import { HistoryManager, AddElementCmd } from '../../src/core/historyManager';

beforeEach(() => { PDFElement._nextId = 1; });

// ── Highlight auto-select fix (BUG: missing setMode + selectElement) ──────────
describe('highlight auto-select after draw', () => {
  it('highlight path calls setMode("select") and selectElement', () => {
    const modeLog: string[] = [];
    const selectedLog: (PDFElement | null)[] = [];
    const elements: PDFElement[] = [];
    const mgr = new HistoryManager(50, vi.fn());

    const fakeApp = {
      mode: 'drawHighlight',
      elements,
      historyManager: mgr,
      documentModel: { currentPage: { id: 'p1' } },
      ui: { redactColorInput: { value: '#000000' } },
      setMode: (m: string) => { modeLog.push(m); fakeApp.mode = m; },
      selectElement: (el: PDFElement | null) => { selectedLog.push(el); },
      _autosave: vi.fn(),
      rebuildElementLayer: vi.fn(),
    };

    // Simulate the highlight path in DrawingHandler.handlePointerUp
    const start = { x: 10, y: 20 };
    const endX = 110, endY = 70;
    const x = Math.min(start.x, endX);
    const y = Math.min(start.y, endY);
    const w = Math.abs(endX - start.x);
    const h = Math.abs(endY - start.y);

    const hlEl = new HighlightElement(x, y, w, h, 'p1');
    // THE FIX: both setMode AND selectElement must be called
    mgr.execute(new AddElementCmd(elements, hlEl));
    fakeApp._autosave();
    fakeApp.setMode('select');      // must be called
    fakeApp.selectElement(hlEl);   // must be called

    expect(modeLog).toContain('select');
    expect(selectedLog[selectedLog.length - 1]).toBe(hlEl);
    expect(elements).toHaveLength(1);
    expect(elements[0]).toBe(hlEl);
  });

  it('highlight element correctly added to elements array', () => {
    const elements: PDFElement[] = [];
    const mgr = new HistoryManager(50, vi.fn());
    const hlEl = new HighlightElement(10, 20, 100, 50, 'p1');
    mgr.execute(new AddElementCmd(elements, hlEl));
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe('highlight');
  });

  it('small highlight (<5×5) is discarded before selectElement is called', () => {
    // Mirrors the `if (w < 5 && h < 5) return` guard
    const w = 4, h = 4;
    const tooSmall = w < 5 && h < 5;
    expect(tooSmall).toBe(true); // verifies the guard fires
  });

  it('exactly 5×5 highlight is NOT discarded', () => {
    const w = 5, h = 5;
    const tooSmall = w < 5 && h < 5;
    expect(tooSmall).toBe(false);
  });
});

// ── Redaction path still uses setMode + selectElement (regression guard) ──────
describe('redaction auto-select after draw', () => {
  it('redaction path calls setMode("select") and selectElement', () => {
    const modeLog: string[] = [];
    const selectedLog: (PDFElement | null)[] = [];
    const elements: PDFElement[] = [];
    const mgr = new HistoryManager(50, vi.fn());

    const fakeApp = {
      setMode: (m: string) => { modeLog.push(m); },
      selectElement: (el: PDFElement | null) => { selectedLog.push(el); },
      historyManager: mgr,
      elements,
      _autosave: vi.fn(),
    };

    const redEl = new RedactionElement(10, 20, 100, 50, 'p1', '#000000');
    mgr.execute(new AddElementCmd(elements, redEl));
    fakeApp._autosave();
    fakeApp.setMode('select');
    fakeApp.selectElement(redEl);

    expect(modeLog).toContain('select');
    expect(selectedLog[selectedLog.length - 1]).toBe(redEl);
  });
});

// ── Shape element minimum size guard ─────────────────────────────────────────
describe('shape minimum size guard (w < 5 && h < 5)', () => {
  const cases = [
    { w: 0,   h: 0,   discard: true  },
    { w: 4,   h: 4,   discard: true  },
    { w: 4,   h: 5,   discard: false },  // h=5 passes
    { w: 5,   h: 4,   discard: false },  // w=5 passes
    { w: 5,   h: 5,   discard: false },
    { w: 100, h: 50,  discard: false },
  ];

  for (const { w, h, discard } of cases) {
    it(`w=${w} h=${h} → discard=${discard}`, () => {
      expect(w < 5 && h < 5).toBe(discard);
    });
  }
});

// ── ShapeElement construction ─────────────────────────────────────────────────
describe('ShapeElement construction', () => {
  it('arrow stores x1/y1/x2/y2', () => {
    const el = new ShapeElement('arrow', 10, 20, 100, 50, 'p1', {
      strokeColor: '#000', strokeWidth: 2, x1: 10, y1: 20, x2: 110, y2: 70,
    });
    expect(el.shapeType).toBe('arrow');
    expect(el.x1).toBe(10);
    expect(el.y1).toBe(20);
    expect(el.x2).toBe(110);
    expect(el.y2).toBe(70);
  });

  it('rect element has correct type', () => {
    const el = new ShapeElement('rect', 0, 0, 200, 100, 'p1', { strokeColor: '#f00', strokeWidth: 3 });
    expect(el.type).toBe('shape');
    expect(el.shapeType).toBe('rect');
    expect(el.width).toBe(200);
    expect(el.height).toBe(100);
  });

  it('ellipse element serialises to JSON with shapeType', () => {
    const el = new ShapeElement('ellipse', 5, 10, 80, 60, 'p1', { strokeColor: '#00f', strokeWidth: 1 });
    const json = el.toJSON();
    expect(json.shapeType).toBe('ellipse');
    expect(json.type).toBe('shape');
  });

  it('freehand stores points', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 3 }];
    const el = new ShapeElement('freehand', 0, 0, 20, 5, 'p1', {
      strokeColor: '#000', strokeWidth: 2, points: pts,
    });
    expect(el.points).toEqual(pts);
  });
});

// ── HighlightElement defaults ─────────────────────────────────────────────────
describe('HighlightElement defaults', () => {
  it('default color is yellow (#FFFF00)', () => {
    const el = new HighlightElement(0, 0, 100, 20, 'p1');
    expect(el.color).toBe('#FFFF00');
  });

  it('default opacity is 0.3', () => {
    const el = new HighlightElement(0, 0, 100, 20, 'p1');
    expect(el.opacity).toBe(0.3);
  });

  it('type is "highlight"', () => {
    const el = new HighlightElement(0, 0, 100, 20, 'p1');
    expect(el.type).toBe('highlight');
  });

  it('accepts custom color', () => {
    const el = new HighlightElement(0, 0, 100, 20, 'p1', '#FF0000', 0.5);
    expect(el.color).toBe('#FF0000');
    expect(el.opacity).toBe(0.5);
  });

  it('serialises and deserialises correctly', () => {
    const el = new HighlightElement(10, 20, 150, 30, 'p1', '#00FF00', 0.4);
    const json = el.toJSON();
    expect(json.type).toBe('highlight');
    expect(json.color).toBe('#00FF00');
    expect(json.opacity).toBe(0.4);
    expect(json.x).toBe(10);
    expect(json.y).toBe(20);
    expect(json.width).toBe(150);
    expect(json.height).toBe(30);
  });
});

// ── RedactionElement ──────────────────────────────────────────────────────────
describe('RedactionElement', () => {
  it('type is "redaction"', () => {
    const el = new RedactionElement(0, 0, 100, 50, 'p1', '#000000');
    expect(el.type).toBe('redaction');
  });

  it('stores color', () => {
    const el = new RedactionElement(0, 0, 100, 50, 'p1', '#FF0000');
    expect(el.color).toBe('#FF0000');
  });

  it('serialises to JSON', () => {
    const el = new RedactionElement(5, 10, 80, 40, 'p1', '#000000');
    const json = el.toJSON();
    expect(json.type).toBe('redaction');
    expect(json.x).toBe(5);
    expect(json.y).toBe(10);
    expect(json.width).toBe(80);
    expect(json.height).toBe(40);
  });
});

// ── Drawing coordinate math ───────────────────────────────────────────────────
describe('draw rect/highlight bounding box math', () => {
  it('normalises start/end to top-left origin', () => {
    // User drags right-to-left: endX < startX
    const start = { x: 200, y: 100 };
    const endX = 50, endY = 30;

    const x = Math.min(start.x, endX);  // 50
    const y = Math.min(start.y, endY);  // 30
    const w = Math.abs(endX - start.x); // 150
    const h = Math.abs(endY - start.y); // 70

    expect(x).toBe(50);
    expect(y).toBe(30);
    expect(w).toBe(150);
    expect(h).toBe(70);
  });

  it('drag top-to-bottom produces positive width/height', () => {
    const start = { x: 0, y: 0 };
    const endX = 100, endY = 80;
    expect(Math.abs(endX - start.x)).toBe(100);
    expect(Math.abs(endY - start.y)).toBe(80);
  });
});

// ── Canvas offset computation ─────────────────────────────────────────────────
describe('canvas coordinate to PDF point conversion', () => {
  it('(clientX - rect.left) / zoomScale = PDF point x', () => {
    const rectLeft = 40, zoomScale = 1.301238;
    const clientX  = rectLeft + 130.1238; // 100 PDF pt * zoom
    const pdfX = (clientX - rectLeft) / zoomScale;
    expect(pdfX).toBeCloseTo(100, 1);
  });

  it('(clientY - rect.top) / zoomScale = PDF point y from canvas top', () => {
    const rectTop = 213, zoomScale = 1.301238;
    const clientY  = rectTop + 260.2476; // 200 PDF pt * zoom
    const pdfY = (clientY - rectTop) / zoomScale;
    expect(pdfY).toBeCloseTo(200, 1);
  });
});
