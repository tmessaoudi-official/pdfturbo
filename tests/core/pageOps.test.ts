/**
 * PageOpsService + pageOpsCmds — index-based reorder / rotate / delete (Agent P).
 *
 * Exercises do + undo + redo for each operation against a REAL DocumentModel and
 * a REAL HistoryManager (no mocks of the mutation path), so the tests prove the
 * commands integrate with the canonical model methods and the undo/redo stacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentModel, type SourcePdf } from '../../src/core/documentModel';
import { HistoryManager } from '../../src/core/historyManager';
import { PageOpsService } from '../../src/core/pageOps';
import {
  computeReorder,
  normalizeRotation,
  buildMovePageCmd,
} from '../../src/core/commands/pageOpsCmds';
import type { PDFElement } from '../../src/elements/annotationElement';

// A SourcePdf stub good enough for the model (only id/pageCount are touched here).
function mkSource(model: DocumentModel, id: string, pageCount: number): SourcePdf {
  const src = { id, doc: { numPages: pageCount } as never, bytes: new Uint8Array(), name: id, pageCount };
  model.sourcePdfs.set(id, src);
  return src;
}

// Build a model with N pages from one source; returns the model + page ids.
function mkModel(pageCount: number): { model: DocumentModel; ids: string[] } {
  const model = new DocumentModel();
  mkSource(model, 'srcA', pageCount);
  const pages = model.addPagesFrom('srcA');
  return { model, ids: pages.map(p => p.id) };
}

function mkService(model: DocumentModel, elements: PDFElement[] = []) {
  const onChange = vi.fn();
  const onUpdate = vi.fn();
  const history = new HistoryManager(50, onChange);
  const svc = new PageOpsService(model, elements, history, onUpdate);
  return { svc, history, onUpdate };
}

beforeEach(() => vi.clearAllMocks());

// ── Pure helpers ────────────────────────────────────────────────────────────
describe('computeReorder', () => {
  it('moves an item forward', () => {
    expect(computeReorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('moves an item backward', () => {
    expect(computeReorder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('returns a copy unchanged for no-op / out-of-range', () => {
    expect(computeReorder(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(computeReorder(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    expect(computeReorder(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
  });
});

describe('normalizeRotation', () => {
  it('wraps into 0..359', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-360)).toBe(0);
  });
});

describe('buildMovePageCmd', () => {
  it('returns null for a no-op move', () => {
    const { model } = mkModel(3);
    expect(buildMovePageCmd(model, 1, 1, () => {})).toBeNull();
    expect(buildMovePageCmd(model, 9, 0, () => {})).toBeNull();
  });
});

// ── Reorder (move) ───────────────────────────────────────────────────────────
describe('PageOpsService.movePage', () => {
  it('do moves page i→j; undo restores; redo re-applies', () => {
    const { model, ids } = mkModel(4);
    const { svc, history, onUpdate } = mkService(model);

    expect(svc.movePage(0, 2)).toBe(true);
    expect(model.pages.map(p => p.id)).toEqual([ids[1], ids[2], ids[0], ids[3]]);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    expect(history.undo()).toBe(true);
    expect(model.pages.map(p => p.id)).toEqual(ids);

    expect(history.redo()).toBe(true);
    expect(model.pages.map(p => p.id)).toEqual([ids[1], ids[2], ids[0], ids[3]]);
  });

  it('returns false and pushes nothing for a no-op move', () => {
    const { model } = mkModel(3);
    const { svc, history } = mkService(model);
    expect(svc.movePage(1, 1)).toBe(false);
    expect(history.canUndo()).toBe(false);
  });
});

// ── Rotate ──────────────────────────────────────────────────────────────────
describe('PageOpsService.rotatePage', () => {
  it('CW = -90 CCW lands on 270; undo back to 0; redo to 270', () => {
    const { model } = mkModel(2);
    const { svc, history } = mkService(model);

    expect(svc.rotatePageCw(0)).toBe(true);
    expect(svc.rotationAt(0)).toBe(270);

    expect(history.undo()).toBe(true);
    expect(svc.rotationAt(0)).toBe(0);

    expect(history.redo()).toBe(true);
    expect(svc.rotationAt(0)).toBe(270);
  });

  it('CCW (+90) and 180 accumulate then normalize', () => {
    const { model } = mkModel(1);
    const { svc } = mkService(model);
    expect(svc.rotatePageCcw(0)).toBe(true);   // 90
    expect(svc.rotatePage180(0)).toBe(true);   // 90 + 180 = 270
    expect(svc.rotationAt(0)).toBe(270);
  });

  it('returns false for an out-of-range index', () => {
    const { model } = mkModel(1);
    const { svc, history } = mkService(model);
    expect(svc.rotatePage(5, 90)).toBe(false);
    expect(history.canUndo()).toBe(false);
  });
});

// ── Delete ──────────────────────────────────────────────────────────────────
describe('PageOpsService.deletePage', () => {
  it('do removes page at index; undo re-inserts at original index; redo removes again', () => {
    const { model, ids } = mkModel(3);
    const { svc, history } = mkService(model);

    expect(svc.deletePage(1)).toBe(true);
    expect(model.pages.map(p => p.id)).toEqual([ids[0], ids[2]]);

    expect(history.undo()).toBe(true);
    expect(model.pages.map(p => p.id)).toEqual(ids);

    expect(history.redo()).toBe(true);
    expect(model.pages.map(p => p.id)).toEqual([ids[0], ids[2]]);
  });

  it('restores the source PDF on undo when its last page was deleted (GC)', () => {
    const { model, ids } = mkModel(1);
    // add a 2nd source with a single page, then delete it → source is GC'd
    mkSource(model, 'srcB', 1);
    const [bPage] = model.addPagesFrom('srcB');
    const { svc, history } = mkService(model);

    const idx = model.pages.findIndex(p => p.id === bPage.id);
    expect(svc.deletePage(idx)).toBe(true);
    expect(model.sourcePdfs.has('srcB')).toBe(false); // GC'd
    expect(model.pages.map(p => p.id)).toEqual(ids);

    expect(history.undo()).toBe(true);
    expect(model.sourcePdfs.has('srcB')).toBe(true);  // restored
    expect(model.pages.some(p => p.id === bPage.id)).toBe(true);
  });

  it('refuses to delete the only remaining page', () => {
    const { model } = mkModel(1);
    const { svc, history } = mkService(model);
    expect(svc.deletePage(0)).toBe(false);
    expect(model.pageCount).toBe(1);
    expect(history.canUndo()).toBe(false);
  });
});
