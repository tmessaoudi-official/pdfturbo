/**
 * HistoryManager — extended command coverage (RemoveElementCmd, MoveResizeCmd,
 * BulkDeleteCmd, SplitStrokeCmd, MacroCmd, RotateElementCmd, InkStrokeCmd,
 * ClearInkCmd, TransformAnnotationsCmd).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HistoryManager,
  RemoveElementCmd,
  MoveResizeCmd,
  BulkDeleteCmd,
  SplitStrokeCmd,
  MacroCmd,
  RotateElementCmd,
  InkStrokeCmd,
  ClearInkCmd,
  TransformAnnotationsCmd,
  SnapshotCmd,
  ReorderPagesCmd,
  DeletePageCmd,
  AddPagesCmd,
  RotatePageCmd,
  SetPageCropCmd,
  type ElementTransformSnapshot,
} from '../../src/core/historyManager';
import { TextElement } from '../../src/elements/textElement';
import { PDFElement } from '../../src/elements/annotationElement';
import { InkLayer, type InkStroke } from '../../src/infra/inkLayer';
import { DocumentModel } from '../../src/core/documentModel';
import type { PDFDocumentProxy } from 'pdfjs-dist';

beforeEach(() => { PDFElement._nextId = 1; });

function mkEl(pageId = 'p1'): TextElement { return new TextElement(0, 0, pageId); }
function mkMgr() { return new HistoryManager(50, vi.fn()); }
function mkStroke(override: Partial<InkStroke> = {}): InkStroke {
  return { type: 'ink', points: [{ x: 0, y: 0 }, { x: 10, y: 5 }], width: 2, color: '#000', ...override };
}

// ── RemoveElementCmd ───────────────────────────────────────────────────────────
describe('RemoveElementCmd', () => {
  it('execute removes the element', () => {
    const el1 = mkEl(), el2 = mkEl();
    const arr = [el1, el2];
    const cmd = new RemoveElementCmd(arr, el1);
    cmd.execute();
    expect(arr).toHaveLength(1);
    expect(arr[0]).toBe(el2);
  });

  it('undo restores element at its original index', () => {
    const el1 = mkEl(), el2 = mkEl();
    const arr = [el1, el2];
    const cmd = new RemoveElementCmd(arr, el1);
    cmd.execute();
    cmd.undo();
    expect(arr).toHaveLength(2);
    expect(arr[0]).toBe(el1);
  });

  it('is safely stackable via HistoryManager', () => {
    const mgr = mkMgr();
    const arr = [mkEl(), mkEl()];
    const el = arr[0];
    mgr.execute(new RemoveElementCmd(arr, el));
    expect(arr).toHaveLength(1);
    mgr.undo();
    expect(arr).toHaveLength(2);
    expect(arr[0]).toBe(el);
  });

  it('execute is no-op when element not in array', () => {
    const el = mkEl();
    const arr: PDFElement[] = [];
    const cmd = new RemoveElementCmd(arr, el);
    expect(() => cmd.execute()).not.toThrow();
  });
});

// ── MoveResizeCmd ──────────────────────────────────────────────────────────────
describe('MoveResizeCmd', () => {
  it('execute applies new position', () => {
    const el = mkEl();
    const arr = [el];
    el.x = 10; el.y = 20;
    const cmd = new MoveResizeCmd(arr, el, { x: 10, y: 20 }, { x: 100, y: 200 });
    cmd.execute();
    expect(el.x).toBe(100);
    expect(el.y).toBe(200);
  });

  it('undo restores previous position', () => {
    const el = mkEl();
    const arr = [el];
    el.x = 10; el.y = 20;
    const cmd = new MoveResizeCmd(arr, el, { x: 10, y: 20 }, { x: 100, y: 200 });
    cmd.execute();
    cmd.undo();
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
  });

  it('execute handles width/height', () => {
    const el = mkEl();
    const arr = [el];
    el.width = 200; el.height = 100;
    const cmd = new MoveResizeCmd(arr, el,
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 0, y: 0, width: 300, height: 150 });
    cmd.execute();
    expect(el.width).toBe(300);
    expect(el.height).toBe(150);
  });

  it('undo/redo cycle is stable', () => {
    const el = mkEl();
    el.x = 5; el.y = 5;
    const arr = [el];
    const mgr = mkMgr();
    mgr.execute(new MoveResizeCmd(arr, el, { x: 5, y: 5 }, { x: 50, y: 50 }));
    expect(el.x).toBe(50);
    mgr.undo();
    expect(el.x).toBe(5);
    mgr.redo();
    expect(el.x).toBe(50);
  });
});

// ── BulkDeleteCmd ──────────────────────────────────────────────────────────────
describe('BulkDeleteCmd', () => {
  it('execute removes all specified elements', () => {
    const e1 = mkEl(), e2 = mkEl(), e3 = mkEl();
    const arr = [e1, e2, e3];
    const cmd = new BulkDeleteCmd(arr, [e1, e3]);
    cmd.execute();
    expect(arr).toHaveLength(1);
    expect(arr[0]).toBe(e2);
  });

  it('undo restores deleted elements', () => {
    const e1 = mkEl(), e2 = mkEl();
    const arr = [e1, e2];
    const cmd = new BulkDeleteCmd(arr, [e1, e2]);
    cmd.execute();
    expect(arr).toHaveLength(0);
    cmd.undo();
    expect(arr).toHaveLength(2);
    expect(arr).toContain(e1);
    expect(arr).toContain(e2);
  });

  it('bulk delete via HistoryManager is undoable', () => {
    const arr = [mkEl(), mkEl(), mkEl()];
    const toDelete = [arr[0], arr[2]];
    const mgr = mkMgr();
    mgr.execute(new BulkDeleteCmd(arr, toDelete));
    expect(arr).toHaveLength(1);
    mgr.undo();
    expect(arr).toHaveLength(3);
  });

  it('undo restores the ORIGINAL z-order, not append order (QA-2026-06-23 P2)', () => {
    const e1 = mkEl(), e2 = mkEl(), e3 = mkEl(), e4 = mkEl(), e5 = mkEl();
    const arr = [e1, e2, e3, e4, e5];
    const cmd = new BulkDeleteCmd(arr, [e2, e4]); // delete middle elements
    cmd.execute();
    expect(arr).toEqual([e1, e3, e5]);
    cmd.undo();
    // paint order = array order; e2/e4 must return to their original slots, not the end
    expect(arr).toEqual([e1, e2, e3, e4, e5]);
  });
});

// ── SplitStrokeCmd ─────────────────────────────────────────────────────────────
describe('SplitStrokeCmd', () => {
  it('execute replaces original with replacements', () => {
    const orig = mkEl();
    const r1 = mkEl(), r2 = mkEl();
    const arr = [mkEl(), orig, mkEl()];
    const cmd = new SplitStrokeCmd(arr, orig, [r1, r2]);
    cmd.execute();
    expect(arr).toContain(r1);
    expect(arr).toContain(r2);
    expect(arr).not.toContain(orig);
    expect(arr).toHaveLength(4); // 2 surrounding + 2 replacements
  });

  it('undo restores the original at the replacement location', () => {
    const orig = mkEl();
    const r1 = mkEl(), r2 = mkEl();
    const arr = [orig];
    const cmd = new SplitStrokeCmd(arr, orig, [r1, r2]);
    cmd.execute();
    cmd.undo();
    expect(arr).toContain(orig);
    expect(arr).not.toContain(r1);
    expect(arr).not.toContain(r2);
  });
});

// ── MacroCmd ───────────────────────────────────────────────────────────────────
describe('MacroCmd', () => {
  it('execute runs all sub-commands in order', () => {
    const log: string[] = [];
    const cmd1 = { execute: () => log.push('a'), undo: vi.fn() };
    const cmd2 = { execute: () => log.push('b'), undo: vi.fn() };
    const macro = new MacroCmd([cmd1, cmd2]);
    macro.execute();
    expect(log).toEqual(['a', 'b']);
  });

  it('undo runs sub-commands in reverse order', () => {
    const log: string[] = [];
    const cmd1 = { execute: vi.fn(), undo: () => log.push('undo-a') };
    const cmd2 = { execute: vi.fn(), undo: () => log.push('undo-b') };
    const macro = new MacroCmd([cmd1, cmd2]);
    macro.execute();
    macro.undo();
    expect(log).toEqual(['undo-b', 'undo-a']); // reversed
  });

  it('empty MacroCmd does not throw', () => {
    const macro = new MacroCmd([]);
    expect(() => macro.execute()).not.toThrow();
    expect(() => macro.undo()).not.toThrow();
  });

  it('integrates with HistoryManager', () => {
    const el1 = mkEl(), el2 = mkEl();
    const arr1: PDFElement[] = [], arr2: PDFElement[] = [];
    const mgr = mkMgr();
    // Macro: add el1 to arr1 AND el2 to arr2 atomically
    const macro = new MacroCmd([
      { execute: () => arr1.push(el1), undo: () => { arr1.pop(); } },
      { execute: () => arr2.push(el2), undo: () => { arr2.pop(); } },
    ]);
    mgr.execute(macro);
    expect(arr1).toHaveLength(1);
    expect(arr2).toHaveLength(1);
    mgr.undo();
    expect(arr1).toHaveLength(0);
    expect(arr2).toHaveLength(0);
  });

  it('rolls back already-applied children when a child throws on execute (QA-2026-06-23 P2)', () => {
    const log: string[] = [];
    const cmd1 = { execute: () => log.push('do1'), undo: () => log.push('undo1') };
    const cmd2 = { execute: () => { throw new Error('boom'); }, undo: vi.fn() };
    const macro = new MacroCmd([cmd1, cmd2]);
    expect(() => macro.execute()).toThrow('boom'); // error propagates
    expect(log).toEqual(['do1', 'undo1']); // cmd1 applied then rolled back → no partial state
  });

  it('rolls back already-undone children when a child throws on undo', () => {
    const log: string[] = [];
    const cmd1 = { execute: vi.fn(), undo: () => { throw new Error('boom'); } };
    const cmd2 = { execute: () => log.push('redo2'), undo: () => log.push('undo2') };
    const macro = new MacroCmd([cmd1, cmd2]);
    // undo runs reversed: cmd2.undo ok, then cmd1.undo throws → cmd2 re-executed
    expect(() => macro.undo()).toThrow('boom');
    expect(log).toEqual(['undo2', 'redo2']);
  });
});

// ── RotateElementCmd ───────────────────────────────────────────────────────────
describe('RotateElementCmd', () => {
  it('execute sets new rotation', () => {
    const el = mkEl();
    el.rotation = 0;
    const cmd = new RotateElementCmd([el], el, 0, 45);
    cmd.execute();
    expect(el.rotation).toBe(45);
  });

  it('undo restores previous rotation', () => {
    const el = mkEl();
    el.rotation = 0;
    const cmd = new RotateElementCmd([el], el, 0, 45);
    cmd.execute();
    cmd.undo();
    expect(el.rotation).toBe(0);
  });

  it('supports negative rotation', () => {
    const el = mkEl();
    el.rotation = 180;
    const cmd = new RotateElementCmd([el], el, 180, -90);
    cmd.execute();
    expect(el.rotation).toBe(-90);
    cmd.undo();
    expect(el.rotation).toBe(180);
  });
});

// ── InkStrokeCmd ───────────────────────────────────────────────────────────────
describe('InkStrokeCmd', () => {
  it('execute adds stroke to layer', () => {
    const layer = new InkLayer();
    const stroke = mkStroke();
    const onUpdate = vi.fn();
    const cmd = new InkStrokeCmd(layer, 'p1', stroke, onUpdate);
    cmd.execute();
    expect(layer.getStrokes('p1')).toHaveLength(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('undo removes last stroke', () => {
    const layer = new InkLayer();
    layer.addStroke('p1', mkStroke({ color: '#aaa' }));
    const stroke = mkStroke({ color: '#bbb' });
    const onUpdate = vi.fn();
    const cmd = new InkStrokeCmd(layer, 'p1', stroke, onUpdate);
    cmd.execute();
    expect(layer.getStrokes('p1')).toHaveLength(2);
    cmd.undo();
    expect(layer.getStrokes('p1')).toHaveLength(1);
    expect(layer.getStrokes('p1')[0].color).toBe('#aaa');
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('integrates with HistoryManager undo/redo', () => {
    const layer = new InkLayer();
    const mgr = mkMgr();
    const stroke = mkStroke();
    const onUpdate = vi.fn();
    mgr.execute(new InkStrokeCmd(layer, 'p1', stroke, onUpdate));
    expect(layer.hasContent('p1')).toBe(true);
    mgr.undo();
    expect(layer.hasContent('p1')).toBe(false);
    mgr.redo();
    expect(layer.hasContent('p1')).toBe(true);
  });
});

// ── ClearInkCmd ────────────────────────────────────────────────────────────────
describe('ClearInkCmd', () => {
  it('execute clears all strokes', () => {
    const layer = new InkLayer();
    layer.addStroke('p1', mkStroke({ color: '#111' }));
    layer.addStroke('p2', mkStroke({ color: '#222' }));
    const onUpdate = vi.fn();
    const cmd = new ClearInkCmd(layer, onUpdate);
    cmd.execute();
    expect(layer.hasAnyContent()).toBe(false);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('undo restores all pages', () => {
    const layer = new InkLayer();
    layer.addStroke('p1', mkStroke({ color: '#111' }));
    layer.addStroke('p2', mkStroke({ color: '#222' }));
    const onUpdate = vi.fn();
    const cmd = new ClearInkCmd(layer, onUpdate);
    cmd.execute();
    cmd.undo();
    expect(layer.getStrokes('p1')).toHaveLength(1);
    expect(layer.getStrokes('p2')).toHaveLength(1);
    expect(layer.getStrokes('p1')[0].color).toBe('#111');
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('undo on empty layer is a no-op', () => {
    const layer = new InkLayer();
    const cmd = new ClearInkCmd(layer, vi.fn());
    cmd.execute();
    expect(() => cmd.undo()).not.toThrow();
  });
});

// ── TransformAnnotationsCmd ───────────────────────────────────────────────────
describe('TransformAnnotationsCmd', () => {
  it('execute applies "after" snapshots', () => {
    const el = mkEl();
    el.x = 10; el.y = 20; el.width = 100; el.height = 50;
    const arr = [el];

    const before = new Map<number, ElementTransformSnapshot>([
      [el.id, { x: 10, y: 20, width: 100, height: 50 }],
    ]);
    const after = new Map<number, ElementTransformSnapshot>([
      [el.id, { x: 50, y: 80, width: 200, height: 90 }],
    ]);

    const cmd = new TransformAnnotationsCmd(arr, before, after);
    cmd.execute();
    expect(el.x).toBe(50);
    expect(el.y).toBe(80);
    expect(el.width).toBe(200);
    expect(el.height).toBe(90);
  });

  it('undo restores "before" snapshots', () => {
    const el = mkEl();
    el.x = 10; el.y = 20; el.width = 100; el.height = 50;
    const arr = [el];

    const before = new Map<number, ElementTransformSnapshot>([
      [el.id, { x: 10, y: 20, width: 100, height: 50 }],
    ]);
    const after = new Map<number, ElementTransformSnapshot>([
      [el.id, { x: 50, y: 80, width: 200, height: 90 }],
    ]);

    const cmd = new TransformAnnotationsCmd(arr, before, after);
    cmd.execute();
    cmd.undo();
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
    expect(el.width).toBe(100);
    expect(el.height).toBe(50);
  });

  it('applies rotation in snapshot', () => {
    const el = mkEl();
    el.rotation = 0;
    const arr = [el];
    const cmd = new TransformAnnotationsCmd(arr,
      new Map([[el.id, { x: 0, y: 0, width: 100, height: 50, rotation: 0 }]]),
      new Map([[el.id, { x: 0, y: 0, width: 100, height: 50, rotation: 90 }]]),
    );
    cmd.execute();
    expect(el.rotation).toBe(90);
    cmd.undo();
    expect(el.rotation).toBe(0);
  });

  it('skips elements not in the snapshot map', () => {
    const el = mkEl();
    el.x = 99;
    const arr = [el];
    // Empty maps — nothing should change
    const cmd = new TransformAnnotationsCmd(arr, new Map(), new Map());
    cmd.execute();
    expect(el.x).toBe(99);
  });
});

// ── SnapshotCmd ────────────────────────────────────────────────────────────────
describe('SnapshotCmd', () => {
  function makeDocProxy(n = 1) {
    return { numPages: n, getPage: () => Promise.resolve({}) } as unknown as PDFDocumentProxy;
  }

  it('execute restores elements from captureAfter snapshot', () => {
    const el = mkEl();
    el.x = 10;
    const arr = [el];
    const cmd = new SnapshotCmd(arr);
    el.x = 99;
    cmd.captureAfter();
    el.x = 0;
    cmd.execute();
    expect(arr[0].x).toBe(99);
  });

  it('execute is a no-op before captureAfter is called', () => {
    const el = mkEl();
    el.x = 5;
    const arr = [el];
    const cmd = new SnapshotCmd(arr);
    el.x = 50;
    cmd.execute(); // captureAfter not called — should be a no-op
    expect(arr[0].x).toBe(50);
  });

  it('undo restores elements from before snapshot', () => {
    const el = mkEl();
    el.x = 10;
    const arr = [el];
    const cmd = new SnapshotCmd(arr);
    el.x = 99;
    cmd.captureAfter();
    cmd.execute();
    cmd.undo();
    expect(arr[0].x).toBe(10);
  });

  it('full undo/redo cycle via HistoryManager', () => {
    const mgr = mkMgr();
    const el = mkEl();
    el.x = 5;
    const arr = [el];
    const cmd = new SnapshotCmd(arr);
    el.x = 55;
    cmd.captureAfter();
    mgr.record(cmd);
    mgr.undo();
    expect(arr[0].x).toBe(5);
    mgr.redo();
    expect(arr[0].x).toBe(55);
  });

  it('makeDocProxy helper is only used for page commands — standalone SnapshotCmd does not need it', () => {
    expect(makeDocProxy().numPages).toBe(1);
  });
});

// ── ReorderPagesCmd ────────────────────────────────────────────────────────────
describe('ReorderPagesCmd', () => {
  function makeModel3() {
    const model = new DocumentModel();
    const src = model.addSourcePdf(
      { numPages: 3, getPage: () => Promise.resolve({}) } as unknown as PDFDocumentProxy,
      new Uint8Array(), 'test.pdf'
    );
    model.addPagesFrom(src.id);
    return model;
  }

  it('execute reorders pages to the new order', () => {
    const model = makeModel3();
    const [a, b, c] = model.pages.map(p => p.id);
    const onUpdate = vi.fn();
    const cmd = new ReorderPagesCmd(model, [a, b, c], [c, a, b], onUpdate);
    cmd.execute();
    expect(model.pages.map(p => p.id)).toEqual([c, a, b]);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('undo restores the original order', () => {
    const model = makeModel3();
    const [a, b, c] = model.pages.map(p => p.id);
    const onUpdate = vi.fn();
    const cmd = new ReorderPagesCmd(model, [a, b, c], [c, a, b], onUpdate);
    cmd.execute();
    cmd.undo();
    expect(model.pages.map(p => p.id)).toEqual([a, b, c]);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });
});

// ── DeletePageCmd ──────────────────────────────────────────────────────────────
describe('DeletePageCmd', () => {
  function makeModel2() {
    const model = new DocumentModel();
    const src = model.addSourcePdf(
      { numPages: 2, getPage: () => Promise.resolve({}) } as unknown as PDFDocumentProxy,
      new Uint8Array(), 'test.pdf'
    );
    model.addPagesFrom(src.id);
    return { model, srcId: src.id };
  }

  it('execute removes the page and its elements', () => {
    const { model } = makeModel2();
    const [p1, p2] = model.pages;
    const el1 = mkEl(p1.id), el2 = mkEl(p2.id);
    const elements = [el1, el2];
    const cmd = new DeletePageCmd(model, elements, p1.id, vi.fn());
    cmd.execute();
    expect(model.pageCount).toBe(1);
    expect(model.pages[0].id).toBe(p2.id);
    expect(elements).toHaveLength(1);
    expect(elements[0].id).toBe(el2.id);
  });

  it('undo restores the page and its elements', () => {
    const { model } = makeModel2();
    const [p1] = model.pages;
    const el1 = mkEl(p1.id);
    const elements = [el1];
    const cmd = new DeletePageCmd(model, elements, p1.id, vi.fn());
    cmd.execute();
    cmd.undo();
    expect(model.pageCount).toBe(2);
    expect(elements).toHaveLength(1);
    expect(elements[0].id).toBe(el1.id);
  });

  it('undo is a no-op when execute was never called', () => {
    const { model } = makeModel2();
    const elements: PDFElement[] = [];
    const cmd = new DeletePageCmd(model, elements, 'nonexistent', vi.fn());
    expect(() => cmd.undo()).not.toThrow(); // removedPage is null
    expect(model.pageCount).toBe(2);
  });
});

// ── AddPagesCmd ────────────────────────────────────────────────────────────────
describe('AddPagesCmd', () => {
  it('execute adds pages from source PDF', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(
      { numPages: 3, getPage: () => Promise.resolve({}) } as unknown as PDFDocumentProxy,
      new Uint8Array(), 'test.pdf'
    );
    const onUpdate = vi.fn();
    const cmd = new AddPagesCmd(model, src.id, undefined, onUpdate);
    cmd.execute();
    expect(model.pageCount).toBe(3);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('undo removes the added pages', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(
      { numPages: 2, getPage: () => Promise.resolve({}) } as unknown as PDFDocumentProxy,
      new Uint8Array(), 'test.pdf'
    );
    const onUpdate = vi.fn();
    const cmd = new AddPagesCmd(model, src.id, undefined, onUpdate);
    cmd.execute();
    expect(model.pageCount).toBe(2);
    cmd.undo();
    expect(model.pageCount).toBe(0);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('adds only specified page numbers when pageNums is provided', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(
      { numPages: 5, getPage: () => Promise.resolve({}) } as unknown as PDFDocumentProxy,
      new Uint8Array(), 'test.pdf'
    );
    const cmd = new AddPagesCmd(model, src.id, [1, 3], vi.fn());
    cmd.execute();
    expect(model.pageCount).toBe(2);
    expect(model.pages[0].sourcePageNum).toBe(1);
    expect(model.pages[1].sourcePageNum).toBe(3);
  });
});

// ── RotatePageCmd ──────────────────────────────────────────────────────────────
describe('RotatePageCmd', () => {
  function makeModelWithPage() {
    const model = new DocumentModel();
    const src = model.addSourcePdf(
      { numPages: 1, getPage: () => Promise.resolve({}) } as unknown as PDFDocumentProxy,
      new Uint8Array(), 'test.pdf'
    );
    model.addPagesFrom(src.id);
    return model;
  }

  it('execute rotates the page by delta', () => {
    const model = makeModelWithPage();
    const pageId = model.pages[0].id;
    const cmd = new RotatePageCmd(model, pageId, 90, vi.fn());
    cmd.execute();
    expect(model.pages[0].rotation).toBe(90);
  });

  it('undo restores the original rotation', () => {
    const model = makeModelWithPage();
    const pageId = model.pages[0].id;
    model.pages[0].rotation = 180;
    const cmd = new RotatePageCmd(model, pageId, 90, vi.fn());
    cmd.execute();
    expect(model.pages[0].rotation).toBe(270);
    cmd.undo();
    expect(model.pages[0].rotation).toBe(180);
  });

  it('is a no-op when pageId does not exist', () => {
    const model = makeModelWithPage();
    const cmd = new RotatePageCmd(model, 'nonexistent', 90, vi.fn());
    expect(() => cmd.execute()).not.toThrow();
    expect(() => cmd.undo()).not.toThrow();
  });

  it('rotation wraps around 360 correctly', () => {
    const model = makeModelWithPage();
    const pageId = model.pages[0].id;
    model.pages[0].rotation = 270;
    const cmd = new RotatePageCmd(model, pageId, 90, vi.fn());
    cmd.execute();
    expect(model.pages[0].rotation).toBe(0); // 270+90=360→0
  });
});

// ── SetPageCropCmd ─────────────────────────────────────────────────────────────
describe('SetPageCropCmd', () => {
  function makeModelWithPage() {
    const model = new DocumentModel();
    const src = model.addSourcePdf(
      { numPages: 1, getPage: () => Promise.resolve({}) } as unknown as PDFDocumentProxy,
      new Uint8Array(), 'test.pdf'
    );
    model.addPagesFrom(src.id);
    return model;
  }

  it('execute sets the page crop', () => {
    const model = makeModelWithPage();
    const crop = { x: 10, y: 20, width: 100, height: 200 };
    new SetPageCropCmd(model, model.pages[0].id, crop, vi.fn()).execute();
    expect(model.pages[0].crop).toEqual(crop);
  });

  it('stores a copy, not the caller reference', () => {
    const model = makeModelWithPage();
    const crop = { x: 1, y: 2, width: 3, height: 4 };
    new SetPageCropCmd(model, model.pages[0].id, crop, vi.fn()).execute();
    crop.x = 999;
    expect(model.pages[0].crop?.x).toBe(1);
  });

  it('undo restores no-crop when there was none', () => {
    const model = makeModelWithPage();
    const cmd = new SetPageCropCmd(model, model.pages[0].id, { x: 0, y: 0, width: 50, height: 50 }, vi.fn());
    cmd.execute();
    expect(model.pages[0].crop).toBeDefined();
    cmd.undo();
    expect(model.pages[0].crop).toBeUndefined();
  });

  it('undo restores a prior crop exactly', () => {
    const model = makeModelWithPage();
    model.pages[0].crop = { x: 5, y: 5, width: 60, height: 60 };
    const cmd = new SetPageCropCmd(model, model.pages[0].id, { x: 10, y: 10, width: 30, height: 30 }, vi.fn());
    cmd.execute();
    expect(model.pages[0].crop).toEqual({ x: 10, y: 10, width: 30, height: 30 });
    cmd.undo();
    expect(model.pages[0].crop).toEqual({ x: 5, y: 5, width: 60, height: 60 });
  });

  it('clears a crop when newCrop is null and undo restores it', () => {
    const model = makeModelWithPage();
    model.pages[0].crop = { x: 5, y: 5, width: 60, height: 60 };
    const cmd = new SetPageCropCmd(model, model.pages[0].id, null, vi.fn());
    cmd.execute();
    expect(model.pages[0].crop).toBeUndefined();
    cmd.undo();
    expect(model.pages[0].crop).toEqual({ x: 5, y: 5, width: 60, height: 60 });
  });

  it('is a no-op when pageId does not exist', () => {
    const model = makeModelWithPage();
    const cmd = new SetPageCropCmd(model, 'nonexistent', { x: 0, y: 0, width: 1, height: 1 }, vi.fn());
    expect(() => cmd.execute()).not.toThrow();
    expect(() => cmd.undo()).not.toThrow();
  });
});
