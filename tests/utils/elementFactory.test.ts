/**
 * ElementFactory.fromJSON — all element types, id sync, unknown type.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ElementFactory } from '../../src/utils/elementFactory';
import { PDFElement } from '../../src/elements/annotationElement';
import { TextElement } from '../../src/elements/textElement';
import { SignatureElement } from '../../src/elements/signatureElement';
import { ShapeElement } from '../../src/elements/shapeElement';
import { ImageElement } from '../../src/elements/imageElement';
import { HighlightElement } from '../../src/elements/highlightElement';
import { CommentElement } from '../../src/elements/commentElement';
import { RedactionElement } from '../../src/elements/redactionElement';

beforeEach(() => { PDFElement._nextId = 1; });

// ── TextElement ────────────────────────────────────────────────────────────────
describe('fromJSON — text', () => {
  it('creates a TextElement with all fields', () => {
    const el = ElementFactory.fromJSON({
      id: 42, type: 'text', x: 10, y: 20, width: 200, height: 30, pageId: 'p1',
      text: 'Hello', fontSize: 16, color: '#ff0000', fontFamily: 'Helvetica',
      bold: true, italic: false, multiline: true,
    });
    expect(el).toBeInstanceOf(TextElement);
    const t = el as TextElement;
    expect(t.id).toBe(42);
    expect(t.x).toBe(10);
    expect(t.y).toBe(20);
    expect(t.text).toBe('Hello');
    expect(t.fontSize).toBe(16);
    expect(t.color).toBe('#ff0000');
    expect(t.fontFamily).toBe('Helvetica');
    expect(t.bold).toBe(true);
    expect(t.italic).toBe(false);
    expect(t.pageId).toBe('p1');
  });

  it('defaults fontFamily to Arial when missing', () => {
    const el = ElementFactory.fromJSON({
      id: 1, type: 'text', x: 0, y: 0, width: 100, height: 30, pageId: 'p1',
      text: '', fontSize: 14, color: '#000',
    }) as TextElement;
    expect(el.fontFamily).toBe('Arial');
  });

  it('defaults bold/italic to false', () => {
    const el = ElementFactory.fromJSON({
      id: 1, type: 'text', x: 0, y: 0, width: 100, height: 30, pageId: 'p1',
      text: '', fontSize: 14, color: '#000',
    }) as TextElement;
    expect(el.bold).toBe(false);
    expect(el.italic).toBe(false);
  });

  it('applies rotation from JSON', () => {
    const el = ElementFactory.fromJSON({
      id: 5, type: 'text', x: 0, y: 0, width: 100, height: 30, pageId: 'p1',
      text: '', fontSize: 14, color: '#000', rotation: 45,
    });
    expect((el as PDFElement).rotation).toBe(45);
  });

  it('uses page field as fallback for pageId', () => {
    const el = ElementFactory.fromJSON({
      id: 1, type: 'text', x: 0, y: 0, width: 100, height: 30, page: 3,
      text: '', fontSize: 14, color: '#000',
    });
    expect((el as PDFElement).pageId).toBe('3');
  });
});

// ── SignatureElement ───────────────────────────────────────────────────────────
describe('fromJSON — signature', () => {
  it('creates a SignatureElement with data', () => {
    const el = ElementFactory.fromJSON({
      id: 7, type: 'signature', x: 50, y: 100, width: 200, height: 80, pageId: 'p2',
      data: 'data:image/png;base64,abc123',
    }) as SignatureElement;
    expect(el).toBeInstanceOf(SignatureElement);
    expect(el.data).toBe('data:image/png;base64,abc123');
    expect(el.width).toBe(200);
    expect(el.height).toBe(80);
  });
});

// ── ShapeElement ───────────────────────────────────────────────────────────────
describe('fromJSON — shape', () => {
  it('creates an arrow ShapeElement', () => {
    const el = ElementFactory.fromJSON({
      id: 3, type: 'shape', shapeType: 'arrow', x: 10, y: 20, width: 100, height: 50,
      pageId: 'p1', strokeColor: '#f00', strokeWidth: 2, x1: 10, y1: 20, x2: 110, y2: 70,
    }) as ShapeElement;
    expect(el).toBeInstanceOf(ShapeElement);
    expect(el.shapeType).toBe('arrow');
    expect(el.x1).toBe(10);
    expect(el.y1).toBe(20);
    expect(el.x2).toBe(110);
    expect(el.y2).toBe(70);
    expect(el.strokeColor).toBe('#f00');
  });

  it('creates a rect ShapeElement', () => {
    const el = ElementFactory.fromJSON({
      id: 4, type: 'shape', shapeType: 'rect', x: 0, y: 0, width: 200, height: 100,
      pageId: 'p1', strokeColor: '#00f', strokeWidth: 3,
    }) as ShapeElement;
    expect(el.shapeType).toBe('rect');
  });

  it('creates a freehand ShapeElement with points', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 15, y: 8 }];
    const el = ElementFactory.fromJSON({
      id: 9, type: 'shape', shapeType: 'freehand', x: 0, y: 0, width: 15, height: 10,
      pageId: 'p1', strokeColor: '#000', strokeWidth: 2, points: pts,
    }) as ShapeElement;
    expect(el.points).toEqual(pts);
  });

  it('defaults points to [] when missing', () => {
    const el = ElementFactory.fromJSON({
      id: 10, type: 'shape', shapeType: 'rect', x: 0, y: 0, width: 100, height: 50,
      pageId: 'p1', strokeColor: '#000', strokeWidth: 1,
    }) as ShapeElement;
    expect(el.points).toEqual([]);
  });

  it('deserializes fillColor', () => {
    const el = ElementFactory.fromJSON({
      id: 11, type: 'shape', shapeType: 'rect', x: 0, y: 0, width: 100, height: 50,
      pageId: 'p1', strokeColor: '#f00', strokeWidth: 2, fillColor: '#00ff00',
    }) as ShapeElement;
    expect(el.fillColor).toBe('#00ff00');
  });

  it('fillColor defaults to undefined when absent in JSON', () => {
    const el = ElementFactory.fromJSON({
      id: 12, type: 'shape', shapeType: 'ellipse', x: 0, y: 0, width: 60, height: 40,
      pageId: 'p1', strokeColor: '#000', strokeWidth: 1,
    }) as ShapeElement;
    expect(el.fillColor).toBeUndefined();
  });
});

// ── ImageElement ───────────────────────────────────────────────────────────────
describe('fromJSON — image', () => {
  it('creates an ImageElement with src', () => {
    const el = ElementFactory.fromJSON({
      id: 11, type: 'image', x: 30, y: 40, width: 300, height: 200, pageId: 'p3',
      src: 'data:image/jpeg;base64,xyz',
    }) as ImageElement;
    expect(el).toBeInstanceOf(ImageElement);
    expect(el.src).toBe('data:image/jpeg;base64,xyz');
    expect(el.width).toBe(300);
    expect(el.height).toBe(200);
  });

  it('defaults src to empty string when missing', () => {
    const el = ElementFactory.fromJSON({
      id: 12, type: 'image', x: 0, y: 0, width: 100, height: 100, pageId: 'p1',
    }) as ImageElement;
    expect(el.src).toBe('');
  });
});

// ── HighlightElement ───────────────────────────────────────────────────────────
describe('fromJSON — highlight', () => {
  it('creates a HighlightElement', () => {
    const el = ElementFactory.fromJSON({
      id: 13, type: 'highlight', x: 5, y: 10, width: 150, height: 20, pageId: 'p1',
      color: '#00FF00', opacity: 0.5,
    }) as HighlightElement;
    expect(el).toBeInstanceOf(HighlightElement);
    expect(el.color).toBe('#00FF00');
    expect(el.opacity).toBe(0.5);
  });

  it('defaults color to #FFFF00 when missing', () => {
    const el = ElementFactory.fromJSON({
      id: 14, type: 'highlight', x: 0, y: 0, width: 100, height: 20, pageId: 'p1',
    }) as HighlightElement;
    expect(el.color).toBe('#FFFF00');
    expect(el.opacity).toBe(0.3);
  });
});

// ── CommentElement ─────────────────────────────────────────────────────────────
describe('fromJSON — comment', () => {
  it('creates a CommentElement with color and text', () => {
    const el = ElementFactory.fromJSON({
      id: 15, type: 'comment', x: 100, y: 200, width: 200, height: 120, pageId: 'p2',
      color: '#FFFDE7', text: 'Look here!',
    }) as CommentElement;
    expect(el).toBeInstanceOf(CommentElement);
    expect(el.color).toBe('#FFFDE7');
    expect(el.text).toBe('Look here!');
    expect(el.width).toBe(200);
    expect(el.height).toBe(120);
  });
});

// ── RedactionElement ───────────────────────────────────────────────────────────
describe('fromJSON — redaction', () => {
  it('creates a RedactionElement', () => {
    const el = ElementFactory.fromJSON({
      id: 16, type: 'redaction', x: 10, y: 10, width: 80, height: 20, pageId: 'p1',
      color: '#000000',
    }) as RedactionElement;
    expect(el).toBeInstanceOf(RedactionElement);
    expect(el.color).toBe('#000000');
  });

  it('accepts undefined color', () => {
    const el = ElementFactory.fromJSON({
      id: 17, type: 'redaction', x: 0, y: 0, width: 50, height: 20, pageId: 'p1',
    }) as RedactionElement;
    expect(el).toBeInstanceOf(RedactionElement);
  });
});

// ── Unknown type ───────────────────────────────────────────────────────────────
describe('fromJSON — unknown type', () => {
  it('returns null for unrecognised type', () => {
    const el = ElementFactory.fromJSON({
      id: 99, type: 'unknown', x: 0, y: 0, width: 100, height: 50, pageId: 'p1',
    });
    expect(el).toBeNull();
  });
});

// ── syncIdCounter ──────────────────────────────────────────────────────────────
describe('syncIdCounter', () => {
  it('advances _nextId to max id + 1', () => {
    PDFElement._nextId = 1;
    const elements = [
      new TextElement(0, 0, 'p1', {}),
      new TextElement(0, 0, 'p1', {}),
    ];
    elements[0].id = 50;
    elements[1].id = 30;
    ElementFactory.syncIdCounter(elements);
    expect(PDFElement._nextId).toBe(51);
  });

  it('does nothing on empty array', () => {
    PDFElement._nextId = 5;
    ElementFactory.syncIdCounter([]);
    expect(PDFElement._nextId).toBe(5);
  });

  it('does not decrease _nextId if already higher', () => {
    // Create element first, then set _nextId high to simulate already-advanced counter
    const el = new TextElement(0, 0, 'p1', {});
    el.id = 10;
    PDFElement._nextId = 100; // manually advance AFTER element creation
    ElementFactory.syncIdCounter([el]);
    // maxId=10 < _nextId=100 → condition false → _nextId stays 100
    expect(PDFElement._nextId).toBe(100);
  });
});

// ── Round-trip: toJSON → fromJSON ─────────────────────────────────────────────
describe('round-trip toJSON → fromJSON', () => {
  it('TextElement survives round-trip', () => {
    const orig = new TextElement(10, 20, 'p1', { fontSize: 18, color: '#f00', bold: true });
    orig.text = 'hello world';
    const json = orig.toJSON();
    const restored = ElementFactory.fromJSON(json) as TextElement;
    expect(restored.text).toBe('hello world');
    expect(restored.fontSize).toBe(18);
    expect(restored.bold).toBe(true);
    expect(restored.color).toBe('#f00');
  });

  it('HighlightElement survives round-trip', () => {
    const orig = new HighlightElement(5, 5, 100, 20, 'p1', '#ffcc00', 0.4);
    const json = orig.toJSON();
    const restored = ElementFactory.fromJSON(json) as HighlightElement;
    expect(restored.color).toBe('#ffcc00');
    expect(restored.opacity).toBe(0.4);
    expect(restored.width).toBe(100);
  });

  it('ShapeElement (arrow) survives round-trip', () => {
    const orig = new ShapeElement('arrow', 10, 20, 80, 40, 'p1', {
      strokeColor: '#0000ff', strokeWidth: 2, x1: 10, y1: 20, x2: 90, y2: 60,
    });
    const json = orig.toJSON();
    const restored = ElementFactory.fromJSON(json) as ShapeElement;
    expect(restored.shapeType).toBe('arrow');
    expect(restored.x1).toBe(10);
    expect(restored.x2).toBe(90);
  });

  it('ImageElement src survives round-trip', () => {
    const orig = new ImageElement(0, 0, 100, 80, 'p1', 'data:image/png;base64,test');
    const json = orig.toJSON();
    const restored = ElementFactory.fromJSON(json) as ImageElement;
    expect(restored.src).toBe('data:image/png;base64,test');
  });
});
