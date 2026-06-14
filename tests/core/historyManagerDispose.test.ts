import { describe, it, expect, vi } from 'vitest';
import { HistoryManager, ReplaceSourcePdfBytesCmd, MacroCmd, type Command } from '../../src/core/historyManager';
import type { SourcePdf } from '../../src/core/documentModel';
import type { PDFDocumentProxy } from 'pdfjs-dist';

function makeMgr(maxSize = 50) {
  const onChange = vi.fn();
  return { mgr: new HistoryManager(maxSize, onChange), onChange };
}

// A minimal Command that records whether dispose() was called.
function makeDisposableCmd(): { cmd: Command; disposed: () => number } {
  const dispose = vi.fn();
  const cmd: Command = {
    execute() {},
    undo() {},
    dispose,
  };
  return { cmd, disposed: () => dispose.mock.calls.length };
}

describe('HistoryManager — Command.dispose() lifecycle', () => {
  it('calls dispose() exactly once on the command evicted by overflow', () => {
    const { mgr } = makeMgr(2);
    const a = makeDisposableCmd();
    const b = makeDisposableCmd();
    const c = makeDisposableCmd();

    mgr.execute(a.cmd); // stack: [a]
    mgr.execute(b.cmd); // stack: [a, b]
    expect(a.disposed()).toBe(0);

    mgr.execute(c.cmd); // overflow -> a evicted, stack: [b, c]
    expect(a.disposed()).toBe(1);
    expect(b.disposed()).toBe(0);
    expect(c.disposed()).toBe(0);
  });

  it('does NOT dispose commands still reachable for undo/redo', () => {
    const { mgr } = makeMgr(50);
    const a = makeDisposableCmd();
    mgr.execute(a.cmd);
    mgr.undo(); // a moves to redo stack — still reachable
    expect(a.disposed()).toBe(0);
    mgr.redo(); // back on undo stack — still reachable
    expect(a.disposed()).toBe(0);
  });

  it('disposes ALL commands (both stacks) on clear(), exactly once each', () => {
    const { mgr } = makeMgr(50);
    const a = makeDisposableCmd();
    const b = makeDisposableCmd();
    mgr.execute(a.cmd);
    mgr.execute(b.cmd);
    mgr.undo(); // b -> redo stack, a on undo stack
    mgr.clear();
    expect(a.disposed()).toBe(1);
    expect(b.disposed()).toBe(1);
  });

  it('overflow that evicts a redo-able-but-superseded command does not double-dispose', () => {
    // A fresh execute clears the redo stack; those cleared commands are gone for good
    // and must be disposed exactly once.
    const { mgr } = makeMgr(50);
    const a = makeDisposableCmd();
    mgr.execute(a.cmd);
    mgr.undo();            // a -> redo stack
    const b = makeDisposableCmd();
    mgr.execute(b.cmd);    // new execute clears redo stack -> a unreachable
    expect(a.disposed()).toBe(1);
    expect(b.disposed()).toBe(0);
  });

  it('commands without dispose() never throw', () => {
    const { mgr } = makeMgr(2);
    const plain: Command = { execute() {}, undo() {} };
    mgr.execute(plain);
    mgr.execute({ execute() {}, undo() {} });
    expect(() => mgr.execute({ execute() {}, undo() {} })).not.toThrow();
    expect(() => mgr.clear()).not.toThrow();
  });
});

describe('ReplaceSourcePdfBytesCmd.dispose() — use-after-free safety', () => {
  // pdf.js v6 PDFDocumentProxy has no destroy(); release goes through
  // doc.loadingTask.destroy(). Mock that shape with a spy for the assertions below.
  type MockDoc = PDFDocumentProxy & { loadingTask: { destroy: ReturnType<typeof vi.fn> } };
  function makeDoc(): MockDoc {
    return {
      numPages: 1,
      loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) },
    } as unknown as MockDoc;
  }
  function makeSrc(doc: PDFDocumentProxy): SourcePdf {
    return { id: 's1', doc, bytes: new Uint8Array([1]), name: 'a.pdf', pageCount: 1 };
  }

  it('after execute(): dispose destroys ONLY the undo-branch (before) doc, never the live doc', () => {
    const before = makeDoc();
    const after = makeDoc();
    const src = makeSrc(before);
    const cmd = new ReplaceSourcePdfBytesCmd(
      src, { bytes: new Uint8Array([1]), doc: before }, { bytes: new Uint8Array([2]), doc: after }, () => {}
    );
    cmd.execute(); // src.doc === after (live)
    cmd.dispose();
    expect(before.loadingTask.destroy).toHaveBeenCalledTimes(1); // undo branch freed
    expect(after.loadingTask.destroy).not.toHaveBeenCalled();    // live doc untouched
  });

  it('after undo(): dispose destroys ONLY the redo-branch (after) doc, never the live doc', () => {
    const before = makeDoc();
    const after = makeDoc();
    const src = makeSrc(before);
    const cmd = new ReplaceSourcePdfBytesCmd(
      src, { bytes: new Uint8Array([1]), doc: before }, { bytes: new Uint8Array([2]), doc: after }, () => {}
    );
    cmd.execute();
    cmd.undo(); // src.doc === before (live again)
    cmd.dispose();
    expect(after.loadingTask.destroy).toHaveBeenCalledTimes(1);  // redo branch freed
    expect(before.loadingTask.destroy).not.toHaveBeenCalled();   // live doc untouched
  });

  it('never destroys a doc that equals the live src.doc (conservative guard)', () => {
    // Pathological: both snapshots share the same doc which is also live.
    const shared = makeDoc();
    const src = makeSrc(shared);
    const cmd = new ReplaceSourcePdfBytesCmd(
      src, { bytes: new Uint8Array([1]), doc: shared }, { bytes: new Uint8Array([2]), doc: shared }, () => {}
    );
    cmd.dispose();
    expect(shared.loadingTask.destroy).not.toHaveBeenCalled();
  });

  it('dispose is idempotent — does not re-destroy on a second call', () => {
    const before = makeDoc();
    const after = makeDoc();
    const src = makeSrc(before);
    const cmd = new ReplaceSourcePdfBytesCmd(
      src, { bytes: new Uint8Array([1]), doc: before }, { bytes: new Uint8Array([2]), doc: after }, () => {}
    );
    cmd.execute();
    cmd.dispose();
    cmd.dispose();
    expect(before.loadingTask.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('MacroCmd.dispose() — forwards to children', () => {
  it('disposes every child command when the macro leaves the stack', () => {
    const d1 = vi.fn();
    const d2 = vi.fn();
    const child1: Command = { execute() {}, undo() {}, dispose: d1 };
    const child2: Command = { execute() {}, undo() {}, dispose: d2 };
    const plain: Command = { execute() {}, undo() {} }; // no dispose — must not throw
    const macro = new MacroCmd([child1, plain, child2]);

    const { mgr } = makeMgr(2);
    mgr.execute(macro);
    mgr.execute({ execute() {}, undo() {} });
    mgr.execute({ execute() {}, undo() {} }); // overflow evicts the macro
    expect(d1).toHaveBeenCalledTimes(1);
    expect(d2).toHaveBeenCalledTimes(1);
  });
});
