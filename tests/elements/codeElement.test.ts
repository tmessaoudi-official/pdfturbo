/**
 * CodeElement — serialization round-trip tests.
 * Does NOT import codeGenerator or bwip-js (no canvas in JSDOM).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodeElement } from '../../src/elements/codeElement';
import { ElementFactory } from '../../src/utils/elementFactory';
import { PDFElement } from '../../src/elements/annotationElement';

const FAKE_URL = 'data:image/png;base64,abc123';

beforeEach(() => { PDFElement._nextId = 1; });

// ── Constructor ────────────────────────────────────────────────────────────────
describe('CodeElement — constructor', () => {
  it('sets all fields from opts and dims', () => {
    const el = new CodeElement(10, 20, 'p1', { codeType: 'qrcode', data: 'https://example.com', qrStyle: null }, FAKE_URL, { w: 150, h: 150 });
    expect(el.type).toBe('code');
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
    expect(el.pageId).toBe('p1');
    expect(el.codeType).toBe('qrcode');
    expect(el.data).toBe('https://example.com');
    expect(el.qrStyle).toBeNull();
    expect(el.cachedDataUrl).toBe(FAKE_URL);
    expect(el.width).toBe(150);
    expect(el.height).toBe(150);
  });

  it('defaults dims to 200x200 when not provided', () => {
    const el = new CodeElement(0, 0, 'p1', { codeType: 'code128', data: 'ABC' }, FAKE_URL);
    expect(el.width).toBe(200);
    expect(el.height).toBe(200);
  });

  it('stores qrStyle when provided', () => {
    const style = { styled: true, dotType: 'dots', dotColor: '#ff0000', bgColor: '#ffffff' };
    const el = new CodeElement(0, 0, 'p1', { codeType: 'qrcode', data: 'test', qrStyle: style }, FAKE_URL);
    expect(el.qrStyle).toEqual(style);
  });
});

// ── toJSON ─────────────────────────────────────────────────────────────────────
describe('CodeElement — toJSON', () => {
  it('serializes all code-specific fields', () => {
    const el = new CodeElement(5, 15, 'p2', { codeType: 'ean13', data: '590123412345', qrStyle: null }, FAKE_URL, { w: 300, h: 100 });
    el.id = 42;
    const json = el.toJSON();
    expect(json['type']).toBe('code');
    expect(json['codeType']).toBe('ean13');
    expect(json['data']).toBe('590123412345');
    expect(json['qrStyle']).toBeNull();
    expect(json['cachedDataUrl']).toBe(FAKE_URL);
    expect(json['x']).toBe(5);
    expect(json['y']).toBe(15);
    expect(json['width']).toBe(300);
    expect(json['height']).toBe(100);
    expect(json['pageId']).toBe('p2');
    expect(json['id']).toBe(42);
  });

  it('serializes qrStyle when present', () => {
    const style = { styled: true, dotType: 'rounded', dotColor: '#0000ff', bgColor: '#eeeeee', logoSrc: 'data:image/png;base64,xyz' };
    const el = new CodeElement(0, 0, 'p1', { codeType: 'qrcode', data: 'hi', qrStyle: style }, FAKE_URL);
    const json = el.toJSON();
    expect(json['qrStyle']).toEqual(style);
  });
});

// ── fromJSON (ElementFactory) ─────────────────────────────────────────────────
describe('ElementFactory.fromJSON — code type', () => {
  it('creates a CodeElement with correct fields', () => {
    const el = ElementFactory.fromJSON({
      id: 7, type: 'code', x: 30, y: 40, width: 120, height: 80, pageId: 'p3',
      codeType: 'pdf417', data: 'Test payload', qrStyle: null, cachedDataUrl: FAKE_URL,
    });
    expect(el).toBeInstanceOf(CodeElement);
    const ce = el as CodeElement;
    expect(ce.id).toBe(7);
    expect(ce.x).toBe(30);
    expect(ce.y).toBe(40);
    expect(ce.width).toBe(120);
    expect(ce.height).toBe(80);
    expect(ce.pageId).toBe('p3');
    expect(ce.codeType).toBe('pdf417');
    expect(ce.data).toBe('Test payload');
    expect(ce.qrStyle).toBeNull();
    expect(ce.cachedDataUrl).toBe(FAKE_URL);
  });

  it('preserves rotation from JSON', () => {
    const el = ElementFactory.fromJSON({
      id: 8, type: 'code', x: 0, y: 0, width: 100, height: 100, pageId: 'p1',
      codeType: 'qrcode', data: 'hi', cachedDataUrl: FAKE_URL, rotation: 45,
    }) as CodeElement;
    expect(el.rotation).toBe(45);
  });

  it('defaults cachedDataUrl to empty string when absent', () => {
    const el = ElementFactory.fromJSON({
      id: 9, type: 'code', x: 0, y: 0, width: 100, height: 100, pageId: 'p1',
      codeType: 'code128', data: 'ABC',
    }) as CodeElement;
    expect(el.cachedDataUrl).toBe('');
  });
});

// ── render() ──────────────────────────────────────────────────────────────────
describe('CodeElement — render()', () => {
  const offset = { left: 0, top: 0 };

  it('returns a div with class code-element', () => {
    const el = new CodeElement(10, 20, 'p1', { codeType: 'qrcode', data: 'https://example.com' }, FAKE_URL, { w: 150, h: 150 });
    const div = el.render(document.createElement('div'), offset, 1);
    expect(div.className).toContain('code-element');
    expect(div.dataset.id).toBe(String(el.id));
  });

  it('positions the element via left/top styles with canvas offset applied', () => {
    const el = new CodeElement(30, 50, 'p1', { codeType: 'qrcode', data: 'hi' }, FAKE_URL, { w: 100, h: 100 });
    const div = el.render(document.createElement('div'), { left: 10, top: 5 }, 1);
    expect(div.style.left).toBe('40px'); // 10 + 30*1
    expect(div.style.top).toBe('55px');  // 5 + 50*1
  });

  it('scales dimensions by the scale factor', () => {
    const el = new CodeElement(0, 0, 'p1', { codeType: 'qrcode', data: 'hi' }, FAKE_URL, { w: 100, h: 80 });
    const div = el.render(document.createElement('div'), offset, 2);
    expect(div.style.width).toBe('200px');
    expect(div.style.height).toBe('160px');
  });

  it('clamps rendered size to at least 10px', () => {
    const el = new CodeElement(0, 0, 'p1', { codeType: 'qrcode', data: 'hi' }, FAKE_URL, { w: 3, h: 4 });
    const div = el.render(document.createElement('div'), offset, 1);
    expect(div.style.width).toBe('10px');
    expect(div.style.height).toBe('10px');
  });

  it('contains an img element with the cachedDataUrl as src', () => {
    const el = new CodeElement(0, 0, 'p1', { codeType: 'qrcode', data: 'hi' }, FAKE_URL);
    const div = el.render(document.createElement('div'), offset, 1);
    const img = div.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain(FAKE_URL);
    expect(img.draggable).toBe(false);
  });

  it('contains rotation handle, element controls, and resize handle', () => {
    const el = new CodeElement(0, 0, 'p1', { codeType: 'qrcode', data: 'hi' }, FAKE_URL);
    const div = el.render(document.createElement('div'), offset, 1);
    expect(div.querySelector('.rotation-handle')).toBeTruthy();
    expect(div.querySelector('.element-controls')).toBeTruthy();
    expect(div.querySelector('.resize-handle')).toBeTruthy();
  });

  it('dispatches code-element-edit CustomEvent on dblclick', () => {
    const el = new CodeElement(0, 0, 'p1', { codeType: 'qrcode', data: 'hi' }, FAKE_URL);
    const div = el.render(document.createElement('div'), offset, 1);
    let detail: { id: number } | null = null;
    div.addEventListener('code-element-edit', (e) => {
      detail = (e as CustomEvent<{ id: number }>).detail;
    });
    div.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(detail).toMatchObject({ id: el.id });
  });

  it('dblclick stops propagation (does not bubble past the div)', () => {
    const el = new CodeElement(0, 0, 'p1', { codeType: 'qrcode', data: 'hi' }, FAKE_URL);
    const container = document.createElement('div');
    const div = el.render(container, offset, 1);
    container.appendChild(div);
    const propagated = vi.fn();
    container.addEventListener('dblclick', propagated);
    div.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(propagated).not.toHaveBeenCalled();
  });
});

// ── Round-trip ─────────────────────────────────────────────────────────────────
describe('CodeElement — toJSON / fromJSON round-trip', () => {
  it('reconstructs identical element for plain QR', () => {
    const original = new CodeElement(12, 34, 'p5', { codeType: 'qrcode', data: 'https://grdf.fr', qrStyle: null }, FAKE_URL, { w: 200, h: 200 });
    original.id = 99;
    const json = original.toJSON();
    const restored = ElementFactory.fromJSON(json) as CodeElement;
    expect(restored).toBeInstanceOf(CodeElement);
    expect(restored.id).toBe(99);
    expect(restored.x).toBe(12);
    expect(restored.y).toBe(34);
    expect(restored.codeType).toBe('qrcode');
    expect(restored.data).toBe('https://grdf.fr');
    expect(restored.qrStyle).toBeNull();
    expect(restored.cachedDataUrl).toBe(FAKE_URL);
    expect(restored.width).toBe(200);
    expect(restored.height).toBe(200);
  });

  it('reconstructs identical element with qrStyle', () => {
    const style = { styled: true, dotType: 'classy', dotColor: '#123456', bgColor: '#ffffff' };
    const original = new CodeElement(0, 0, 'p1', { codeType: 'qrcode', data: 'test', qrStyle: style }, FAKE_URL, { w: 250, h: 250 });
    original.id = 55;
    const json = original.toJSON();
    const restored = ElementFactory.fromJSON(json) as CodeElement;
    expect(restored.qrStyle).toEqual(style);
    expect(restored.codeType).toBe('qrcode');
  });

  it('reconstructs 1D barcode with non-square dims', () => {
    const original = new CodeElement(0, 0, 'p1', { codeType: 'code128', data: 'ABC-123' }, FAKE_URL, { w: 400, h: 80 });
    original.id = 11;
    const json = original.toJSON();
    const restored = ElementFactory.fromJSON(json) as CodeElement;
    expect(restored.width).toBe(400);
    expect(restored.height).toBe(80);
    expect(restored.codeType).toBe('code128');
  });
});
