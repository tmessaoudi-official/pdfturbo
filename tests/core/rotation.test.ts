import { describe, it, expect } from 'vitest';
import { TextElement } from '../../src/elements/textElement';
import { RotateElementCmd, TransformAnnotationsCmd, ElementTransformSnapshot } from '../../src/core/historyManager';
import { ElementFactory } from '../../src/utils/elementFactory';
import type { PDFElement } from '../../src/elements/annotationElement';

function makeEl() {
  return new TextElement(10, 20, 'p1');
}

describe('PDFElement rotation field', () => {
  it('defaults to 0', () => {
    const el = makeEl();
    expect(el.rotation).toBe(0);
  });

  it('toJSON includes rotation', () => {
    const el = makeEl();
    el.rotation = 45;
    const json = el.toJSON();
    expect(json.rotation).toBe(45);
  });

  it('toJSON round-trips rotation=0', () => {
    const el = makeEl();
    expect(el.toJSON().rotation).toBe(0);
  });
});

describe('RotateElementCmd', () => {
  it('sets rotation on execute', () => {
    const el = makeEl();
    const arr = [el];
    const cmd = new RotateElementCmd(arr, el, 0, 90);
    cmd.execute();
    expect(el.rotation).toBe(90);
  });

  it('restores rotation on undo', () => {
    const el = makeEl();
    el.rotation = 90;
    const arr = [el];
    const cmd = new RotateElementCmd(arr, el, 90, 180);
    cmd.execute();
    expect(el.rotation).toBe(180);
    cmd.undo();
    expect(el.rotation).toBe(90);
  });

  it('works when element is found by id in arr', () => {
    const el = makeEl();
    const arr = [el];
    const cmd = new RotateElementCmd(arr, el, 0, 45);
    cmd.execute();
    expect(arr[0].rotation).toBe(45);
    cmd.undo();
    expect(arr[0].rotation).toBe(0);
  });
});

describe('TransformAnnotationsCmd with rotation', () => {
  it('applies rotation from snapshot', () => {
    const el = makeEl();
    const arr = [el];
    const before = new Map<number, ElementTransformSnapshot>([
      [el.id, { x: 10, y: 20, width: 100, height: 30, rotation: 0 }],
    ]);
    const after = new Map<number, ElementTransformSnapshot>([
      [el.id, { x: 30, y: 40, width: 30, height: 100, rotation: 90 }],
    ]);
    const cmd = new TransformAnnotationsCmd(arr, before, after);
    cmd.execute();
    expect(el.rotation).toBe(90);
    cmd.undo();
    expect(el.rotation).toBe(0);
  });
});

describe('ElementFactory.fromJSON rotation', () => {
  it('restores rotation field', () => {
    const el = ElementFactory.fromJSON({
      id: 99, type: 'text', x: 0, y: 0, width: 100, height: 30, pageId: 'p1',
      text: 'hello', rotation: 45,
    });
    expect(el).not.toBeNull();
    expect((el as PDFElement).rotation).toBe(45);
  });

  it('defaults to 0 when rotation absent', () => {
    const el = ElementFactory.fromJSON({
      id: 100, type: 'text', x: 0, y: 0, width: 100, height: 30, pageId: 'p1',
      text: 'hello',
    });
    expect(el).not.toBeNull();
    expect((el as PDFElement).rotation).toBe(0);
  });
});
