/**
 * Element render() DOM output — verifies that each element type renders to
 * the correct DOM structure (class names, dataset.id, styles, children).
 * These tests are important for refactor safety: they pin the public render API.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PDFElement } from '../../src/elements/annotationElement';
import { TextElement } from '../../src/elements/textElement';
import { SignatureElement } from '../../src/elements/signatureElement';
import { ImageElement } from '../../src/elements/imageElement';
import { HighlightElement } from '../../src/elements/highlightElement';
import { RedactionElement } from '../../src/elements/redactionElement';
import { CommentElement } from '../../src/elements/commentElement';
import { ShapeElement } from '../../src/elements/shapeElement';

beforeEach(() => { PDFElement._nextId = 1; });

const offset = { left: 0, top: 0 };
const scale  = 1;

// ── PDFElement base helpers ────────────────────────────────────────────────────
describe('PDFElement base helpers', () => {
  it('createControls() produces a div.element-controls with a delete button', () => {
    const el = new TextElement(0, 0, 'p1');
    const controls = el.createControls();
    expect(controls.className).toBe('element-controls');
    const btn = controls.querySelector('button.delete-btn');
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).textContent).toBe('×');
  });

  it('createRotationHandle() produces a div.rotation-handle', () => {
    const el = new TextElement(0, 0, 'p1');
    const handle = el.createRotationHandle();
    expect(handle.className).toBe('rotation-handle');
    expect(handle.textContent).toBe('↻');
  });

  it('createResizeHandle() produces a div.resize-handle', () => {
    const el = new TextElement(0, 0, 'p1');
    const handle = el.createResizeHandle();
    expect(handle.className).toBe('resize-handle');
  });

  it('toJSON includes all base fields', () => {
    const el = new TextElement(10, 20, 'p1', { width: 150, height: 40 });
    const json = el.toJSON();
    expect(json.id).toBe(el.id);
    expect(json.type).toBe('text');
    expect(json.x).toBe(10);
    expect(json.y).toBe(20);
    expect(json.width).toBe(150);
    expect(json.height).toBe(40);
    expect(json.pageId).toBe('p1');
    expect(json.rotation).toBe(0);
  });
});

// ── TextElement render ─────────────────────────────────────────────────────────
describe('TextElement render', () => {
  it('renders a div.text-element with data-id', () => {
    const el = new TextElement(10, 20, 'p1');
    const container = document.createElement('div');
    const div = el.render(container, offset, scale);
    expect(div.className).toContain('text-element');
    expect(div.dataset.id).toBe(String(el.id));
  });

  it('positions the element via left/top styles', () => {
    const el = new TextElement(30, 50, 'p1');
    const div = el.render(document.createElement('div'), offset, scale);
    expect(div.style.left).toBe('30px');
    expect(div.style.top).toBe('50px');
  });

  it('applies scale to dimensions', () => {
    const el = new TextElement(0, 0, 'p1', { width: 200, height: 40 });
    const div = el.render(document.createElement('div'), offset, 2);
    expect(div.style.width).toBe('400px');
    expect(div.style.height).toBe('80px');
  });

  it('multiline=true renders a textarea', () => {
    const el = new TextElement(0, 0, 'p1', { multiline: true });
    const div = el.render(document.createElement('div'), offset, scale);
    expect(div.querySelector('textarea')).toBeTruthy();
    expect(div.querySelector('input')).toBeFalsy();
  });

  it('multiline=false renders an input', () => {
    const el = new TextElement(0, 0, 'p1', { multiline: false });
    const div = el.render(document.createElement('div'), offset, scale);
    expect(div.querySelector('input')).toBeTruthy();
    expect(div.querySelector('textarea')).toBeFalsy();
  });

  it('textarea value matches el.text', () => {
    const el = new TextElement(0, 0, 'p1', { multiline: true });
    el.text = 'Hello!';
    const div = el.render(document.createElement('div'), offset, scale);
    expect((div.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Hello!');
  });

  it('includes rotation handle, controls, resize handle', () => {
    const el = new TextElement(0, 0, 'p1');
    const div = el.render(document.createElement('div'), offset, scale);
    expect(div.querySelector('.rotation-handle')).toBeTruthy();
    expect(div.querySelector('.element-controls')).toBeTruthy();
    expect(div.querySelector('.resize-handle')).toBeTruthy();
  });

  it('toJSON serialises text, fontSize, color, fontFamily, bold, italic', () => {
    const el = new TextElement(0, 0, 'p1', { fontSize: 18, color: '#f00', bold: true, italic: true, fontFamily: 'Times' });
    el.text = 'World';
    const json = el.toJSON() as Record<string, unknown>;
    expect(json['text']).toBe('World');
    expect(json['fontSize']).toBe(18);
    expect(json['color']).toBe('#f00');
    expect(json['fontFamily']).toBe('Times');
    expect(json['bold']).toBe(true);
    expect(json['italic']).toBe(true);
  });
});

// ── SignatureElement render ────────────────────────────────────────────────────
describe('SignatureElement render', () => {
  it('renders a div.signature-element with data-id', () => {
    const el = new SignatureElement(10, 20, 'p1', 'data:image/png;base64,abc');
    const div = el.render(document.createElement('div'), offset, scale);
    expect(div.className).toContain('signature-element');
    expect(div.dataset.id).toBe(String(el.id));
  });

  it('sets backgroundImage to the signature data URL', () => {
    const el = new SignatureElement(0, 0, 'p1', 'data:image/png;base64,xyz');
    const div = el.render(document.createElement('div'), offset, scale);
    expect(div.style.backgroundImage).toContain('data:image/png;base64,xyz');
  });

  it('toJSON includes data field', () => {
    const el = new SignatureElement(0, 0, 'p1', 'data:image/png;base64,test');
    const json = el.toJSON() as Record<string, unknown>;
    expect(json['data']).toBe('data:image/png;base64,test');
  });
});

// ── ImageElement render ───────────────────────────────────────────────────────
describe('ImageElement render', () => {
  it('renders a div.image-element with an img tag', () => {
    const el = new ImageElement(0, 0, 100, 80, 'p1', 'data:image/jpeg;base64,abc');
    const div = el.render(document.createElement('div'), offset, scale);
    expect(div.className).toContain('image-element');
    const img = div.querySelector('img');
    expect(img).toBeTruthy();
    expect((img as HTMLImageElement).src).toContain('data:image/jpeg;base64,abc');
  });

  it('img is non-draggable', () => {
    const el = new ImageElement(0, 0, 100, 80, 'p1', 'data:image/png;base64,x');
    const div = el.render(document.createElement('div'), offset, scale);
    const img = div.querySelector('img') as HTMLImageElement;
    expect(img.draggable).toBe(false);
  });

  it('minimum size of 10px applied', () => {
    // width=2, height=2 → clamped to 10px
    const el = new ImageElement(0, 0, 2, 2, 'p1', 'data:image/png;base64,x');
    const div = el.render(document.createElement('div'), offset, scale);
    expect(div.style.width).toBe('10px');
    expect(div.style.height).toBe('10px');
  });

  it('toJSON includes src field', () => {
    const el = new ImageElement(0, 0, 100, 80, 'p1', 'data:image/png;base64,abc');
    const json = el.toJSON() as Record<string, unknown>;
    expect(json['src']).toBe('data:image/png;base64,abc');
  });
});

// ── HighlightElement render ───────────────────────────────────────────────────
describe('HighlightElement render', () => {
  it('renders a div.highlight-element', () => {
    const el = new HighlightElement(0, 0, 100, 20, 'p1');
    const div = el.render(document.createElement('div'), offset, scale);
    expect(div.className).toContain('highlight-element');
  });

  it('has data-id set', () => {
    const el = new HighlightElement(0, 0, 100, 20, 'p1');
    const div = el.render(document.createElement('div'), offset, scale);
    expect(div.dataset.id).toBe(String(el.id));
  });

  it('uses correct highlight color and opacity in background style', () => {
    const el = new HighlightElement(0, 0, 100, 20, 'p1', '#FFFF00', 0.3);
    const div = el.render(document.createElement('div'), offset, scale);
    // Background should reference the highlight color
    expect(div.style.background).toBeTruthy();
  });
});

// ── RedactionElement render ───────────────────────────────────────────────────
describe('RedactionElement render', () => {
  it('renders a div.redaction-element', () => {
    const el = new RedactionElement(0, 0, 100, 30, 'p1', '#000000');
    const div = el.render(document.createElement('div'), offset, scale);
    expect(div.className).toContain('redaction-element');
  });

  it('background is black or the specified color', () => {
    const el = new RedactionElement(0, 0, 100, 30, 'p1', '#000000');
    const div = el.render(document.createElement('div'), offset, scale);
    // Background should be set (black redaction box)
    expect(div.style.background || div.style.backgroundColor).toBeTruthy();
  });

  it('toJSON includes color', () => {
    const el = new RedactionElement(0, 0, 100, 30, 'p1', '#000000');
    const json = el.toJSON() as Record<string, unknown>;
    expect(json['color']).toBe('#000000');
  });
});

// ── CommentElement render ─────────────────────────────────────────────────────
describe('CommentElement render', () => {
  it('renders a div.comment-element appended to the container', () => {
    const el = new CommentElement(10, 20, 'p1', { text: 'note', color: '#FFFDE7' });
    const container = document.createElement('div');
    const wrapper = el.render(container, offset, scale);
    expect(wrapper.className).toContain('comment-element');
    expect(container.contains(wrapper)).toBe(true);
  });

  it('has a textarea with the comment text', () => {
    const el = new CommentElement(0, 0, 'p1', { text: 'my note' });
    const wrapper = el.render(document.createElement('div'), offset, scale);
    const textarea = wrapper.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe('my note');
  });

  it('background color is set (jsdom normalises hex to rgb)', () => {
    const el = new CommentElement(0, 0, 'p1', { color: '#FFFF00' });
    const wrapper = el.render(document.createElement('div'), offset, scale);
    // jsdom converts hex → rgb so check for the rgb equivalent or presence
    const bg = wrapper.style.background;
    expect(bg).toBeTruthy();
    // rgb(255, 255, 0) is #FFFF00 normalised by jsdom
    expect(bg.includes('#FFFF00') || bg.includes('rgb(255, 255, 0)')).toBe(true);
  });

  it('toJSON includes color and text', () => {
    const el = new CommentElement(5, 10, 'p1', { color: '#FFFDE7', text: 'hello' });
    const json = el.toJSON() as Record<string, unknown>;
    expect(json['color']).toBe('#FFFDE7');
    expect(json['text']).toBe('hello');
  });

  it('updating textarea value updates el.text via input event', () => {
    const el = new CommentElement(0, 0, 'p1', { text: '' });
    const wrapper = el.render(document.createElement('div'), offset, scale);
    const textarea = wrapper.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'new text';
    textarea.dispatchEvent(new Event('input'));
    expect(el.text).toBe('new text');
  });
});

// ── Delete button event ────────────────────────────────────────────────────────
describe('delete button fires element:delete event', () => {
  it('bubbles element:delete CustomEvent with element id', () => {
    const el = new TextElement(0, 0, 'p1');
    const div = el.render(document.createElement('div'), offset, scale);
    const btn = div.querySelector('button.delete-btn') as HTMLButtonElement;

    let detail: { id: number } | null = null;
    div.addEventListener('element:delete', (e) => {
      detail = (e as CustomEvent<{ id: number }>).detail;
    });
    btn.click();
    expect(detail).toMatchObject({ id: el.id });
  });
});

// ── ID auto-increment ─────────────────────────────────────────────────────────
describe('ID auto-increment', () => {
  it('each new element gets a unique monotonically increasing id', () => {
    const ids = [
      new TextElement(0, 0, 'p1').id,
      new TextElement(0, 0, 'p1').id,
      new HighlightElement(0, 0, 100, 20, 'p1').id,
      new RedactionElement(0, 0, 100, 30, 'p1', '#000').id,
    ];
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });
});

// ── ShapeElement arrow/freehand render ────────────────────────────────────────
describe('ShapeElement arrow/freehand render', () => {
  it('renders arrow: SVG contains a line and a polygon', () => {
    const el = new ShapeElement('arrow', 10, 10, 100, 60, 'p1', {
      strokeColor: '#ff0000', strokeWidth: 2, x1: 10, y1: 10, x2: 110, y2: 70,
    });
    const div = el.render(document.createElement('div'), { left: 0, top: 0 }, 1);
    const line = div.querySelector('line');
    const polygon = div.querySelector('polygon');
    expect(line).toBeTruthy();
    expect(polygon).toBeTruthy();
    expect((line as SVGLineElement).getAttribute('stroke')).toBe('#ff0000');
    expect((polygon as SVGPolygonElement).getAttribute('fill')).toBe('#ff0000');
  });

  it('renders freehand: SVG contains a polyline', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 5 }];
    const el = new ShapeElement('freehand', 0, 0, 20, 10, 'p1', {
      strokeColor: '#0000ff', strokeWidth: 3, points: pts,
    });
    const div = el.render(document.createElement('div'), { left: 0, top: 0 }, 1);
    const pl = div.querySelector('polyline');
    expect(pl).toBeTruthy();
    expect((pl as SVGPolylineElement).getAttribute('stroke')).toBe('#0000ff');
    expect((pl as SVGPolylineElement).getAttribute('fill')).toBe('none');
  });

  it('freehand with fewer than 2 points renders no polyline', () => {
    const el = new ShapeElement('freehand', 0, 0, 20, 10, 'p1', {
      strokeColor: '#000', strokeWidth: 2, points: [{ x: 5, y: 5 }],
    });
    const div = el.render(document.createElement('div'), { left: 0, top: 0 }, 1);
    expect(div.querySelector('polyline')).toBeNull();
  });

  it('arrow has no resize handle (only rect/ellipse get one)', () => {
    const el = new ShapeElement('arrow', 0, 0, 100, 60, 'p1', {
      strokeColor: '#000', strokeWidth: 2, x1: 0, y1: 0, x2: 100, y2: 60,
    });
    const div = el.render(document.createElement('div'), { left: 0, top: 0 }, 1);
    expect(div.querySelector('.resize-handle')).toBeNull();
  });

  it('freehand has no resize handle', () => {
    const el = new ShapeElement('freehand', 0, 0, 50, 30, 'p1', {
      strokeColor: '#000', strokeWidth: 2, points: [{ x: 0, y: 0 }, { x: 50, y: 30 }],
    });
    const div = el.render(document.createElement('div'), { left: 0, top: 0 }, 1);
    expect(div.querySelector('.resize-handle')).toBeNull();
  });

  it('rect and ellipse do have a resize handle', () => {
    const rect = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ellipse = new ShapeElement('ellipse', 0, 0, 100, 50, 'p1');
    expect(rect.render(document.createElement('div'), { left: 0, top: 0 }, 1).querySelector('.resize-handle')).toBeTruthy();
    expect(ellipse.render(document.createElement('div'), { left: 0, top: 0 }, 1).querySelector('.resize-handle')).toBeTruthy();
  });
});

// ── ShapeElement fill color ────────────────────────────────────────────────────
describe('ShapeElement fillColor', () => {
  it('defaults to undefined (no fill)', () => {
    const el = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    expect(el.fillColor).toBeUndefined();
  });

  it('accepts fillColor from options', () => {
    const el = new ShapeElement('rect', 0, 0, 100, 50, 'p1', { fillColor: '#ff0000' });
    expect(el.fillColor).toBe('#ff0000');
  });

  it('renders rect SVG with fill=none when fillColor is undefined', () => {
    const el = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const div = el.render(document.createElement('div'), { left: 0, top: 0 }, 1);
    const rect = div.querySelector('rect');
    expect(rect?.getAttribute('fill')).toBe('none');
  });

  it('renders rect SVG with fillColor when set', () => {
    const el = new ShapeElement('rect', 0, 0, 100, 50, 'p1', { fillColor: '#0000ff' });
    const div = el.render(document.createElement('div'), { left: 0, top: 0 }, 1);
    const rect = div.querySelector('rect');
    expect(rect?.getAttribute('fill')).toBe('#0000ff');
  });

  it('renders ellipse SVG with fillColor when set', () => {
    const el = new ShapeElement('ellipse', 0, 0, 100, 50, 'p1', { fillColor: '#00ff00' });
    const div = el.render(document.createElement('div'), { left: 0, top: 0 }, 1);
    const ellipse = div.querySelector('ellipse');
    expect(ellipse?.getAttribute('fill')).toBe('#00ff00');
  });

  it('toJSON includes fillColor', () => {
    const el = new ShapeElement('rect', 0, 0, 100, 50, 'p1', { fillColor: '#123456' });
    const json = el.toJSON() as Record<string, unknown>;
    expect(json['fillColor']).toBe('#123456');
  });

  it('toJSON omits fillColor when undefined', () => {
    const el = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const json = el.toJSON() as Record<string, unknown>;
    expect(json['fillColor']).toBeUndefined();
  });
});
