import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HistoryManager, AddElementCmd, ClearAllCmd, TextEditCmd, ReplaceSourcePdfBytesCmd,
} from '../../src/core/historyManager';
import type { SourcePdf } from '../../src/core/documentModel';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { TextElement } from '../../src/elements/textElement';
import { PDFElement } from '../../src/elements/annotationElement';

function makeMgr() {
  const onChange = vi.fn();
  return { mgr: new HistoryManager(50, onChange), onChange };
}

function makeEl() {
  return new TextElement(0, 0, 'p1');
}

describe('HistoryManager', () => {
  it('executes and records command', () => {
    const { mgr } = makeMgr();
    const arr: ReturnType<typeof makeEl>[] = [];
    const el = makeEl();
    mgr.execute(new AddElementCmd(arr, el));
    expect(arr).toHaveLength(1);
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(false);
  });

  it('undo removes element, redo adds it back', () => {
    const { mgr } = makeMgr();
    const arr: ReturnType<typeof makeEl>[] = [];
    const el = makeEl();
    mgr.execute(new AddElementCmd(arr, el));
    mgr.undo();
    expect(arr).toHaveLength(0);
    expect(mgr.canRedo()).toBe(true);
    mgr.redo();
    expect(arr).toHaveLength(1);
  });

  it('ClearAllCmd: undo restores all elements', () => {
    const { mgr } = makeMgr();
    const arr = [makeEl(), makeEl(), makeEl()];
    const savedIds = arr.map(e => e.id);
    mgr.execute(new ClearAllCmd(arr));
    expect(arr).toHaveLength(0);
    mgr.undo();
    expect(arr.map(e => e.id)).toEqual(savedIds);
  });

  it('caps undo stack at maxSize', () => {
    const { mgr } = makeMgr();
    const arr: ReturnType<typeof makeEl>[] = [];
    for (let i = 0; i < 60; i++) mgr.execute(new AddElementCmd(arr, makeEl()));
    // Verify all IDs are unique
    const ids = arr.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Undo all — should only undo 50 (maxSize)
    let count = 0;
    while (mgr.canUndo()) { mgr.undo(); count++; }
    expect(count).toBe(50);
  });

  it('clear() empties both stacks', () => {
    const { mgr } = makeMgr();
    const arr: ReturnType<typeof makeEl>[] = [];
    mgr.execute(new AddElementCmd(arr, makeEl()));
    mgr.clear();
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
  });
});

describe('ReplaceSourcePdfBytesCmd', () => {
  function makeSrc(): { src: SourcePdf; oldDoc: PDFDocumentProxy; newDoc: PDFDocumentProxy } {
    const oldDoc = { numPages: 1 } as PDFDocumentProxy;
    const newDoc = { numPages: 1 } as PDFDocumentProxy;
    const src: SourcePdf = {
      id: 's1', doc: oldDoc, bytes: new Uint8Array([1, 2]), name: 'a.pdf', pageCount: 1,
    };
    return { src, oldDoc, newDoc };
  }

  it('execute swaps bytes+doc and fires onUpdate; undo restores both', () => {
    const { src, oldDoc, newDoc } = makeSrc();
    const oldBytes = src.bytes;
    const newBytes = new Uint8Array([9, 9, 9]);
    const onUpdate = vi.fn();
    const cmd = new ReplaceSourcePdfBytesCmd(
      src, { bytes: oldBytes, doc: oldDoc }, { bytes: newBytes, doc: newDoc }, onUpdate
    );

    cmd.execute();
    expect(src.bytes).toBe(newBytes);
    expect(src.doc).toBe(newDoc);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    cmd.undo();
    expect(src.bytes).toBe(oldBytes);
    expect(src.doc).toBe(oldDoc);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('round-trips through HistoryManager undo/redo', () => {
    const { src, oldDoc, newDoc } = makeSrc();
    const newBytes = new Uint8Array([7]);
    const { mgr } = makeMgr();
    mgr.execute(new ReplaceSourcePdfBytesCmd(
      src, { bytes: src.bytes, doc: oldDoc }, { bytes: newBytes, doc: newDoc }, () => {}
    ));
    expect(src.doc).toBe(newDoc);
    mgr.undo();
    expect(src.doc).toBe(oldDoc);
    mgr.redo();
    expect(src.doc).toBe(newDoc);
  });
});

describe('TextEditCmd', () => {
  beforeEach(() => { PDFElement._nextId = 1; });

  it('execute sets new text', () => {
    const el = makeEl();
    el.text = 'hello';
    const arr = [el];
    const cmd = new TextEditCmd(arr, el.id, 'hello', 'hello world');
    cmd.execute();
    expect(el.text).toBe('hello world');
  });

  it('undo restores previous text', () => {
    const el = makeEl();
    el.text = 'hello';
    const arr = [el];
    const cmd = new TextEditCmd(arr, el.id, 'hello', 'hello world');
    cmd.execute();
    cmd.undo();
    expect(el.text).toBe('hello');
  });

  it('no-op if element not found', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr: any[] = [];
    const cmd = new TextEditCmd(arr, 999, 'old', 'new');
    expect(() => cmd.execute()).not.toThrow();
    expect(() => cmd.undo()).not.toThrow();
  });
});
