/**
 * pageOps — index-based page-operation service (Agent P).
 *
 * A thin, framework-agnostic facade over the canonical id-based page commands.
 * It exposes the INDEX semantics the UI thinks in (drag page i to slot j; rotate
 * the i-th thumbnail; delete the i-th thumbnail) and routes every mutation
 * through `HistoryManager`, so all three operations are fully undoable / redoable
 * via the existing undo/redo controls — no special-casing required.
 *
 * It deliberately owns NO mutation logic of its own: each method builds one of
 * the existing commands (`pageOpsCmds`) and calls `history.execute(cmd)`. When a
 * request is a no-op or out of range, nothing is pushed (the methods return
 * `false`) so the undo stack stays clean.
 *
 * Wiring: construct with the app's `DocumentModel`, the live `PDFElement[]`, the
 * app's `HistoryManager`, and an `onUpdate` callback that re-renders the page +
 * thumbnails (the existing `onPageStructureChange` is a perfect fit).
 */
import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel } from './documentModel';
import type { HistoryManager } from './historyManager';
import {
  buildMovePageCmd,
  buildRotatePageCmd,
  buildDeletePageCmd,
  normalizeRotation,
  type RotationDelta,
} from './commands/pageOpsCmds';

export type { RotationDelta } from './commands/pageOpsCmds';

export class PageOpsService {
  constructor(
    private readonly _model: DocumentModel,
    private readonly _elements: PDFElement[],
    private readonly _history: HistoryManager,
    private readonly _onUpdate: () => void,
  ) {}

  /** Number of pages currently in the document. */
  get pageCount(): number {
    return this._model.pageCount;
  }

  /**
   * Move the page at `from` to index `to` (drag-reorder). Returns true when a
   * command was executed, false for a no-op / out-of-range request.
   */
  movePage(from: number, to: number): boolean {
    const cmd = buildMovePageCmd(this._model, from, to, this._onUpdate);
    if (!cmd) return false;
    this._history.execute(cmd);
    return true;
  }

  /** Rotate the page at `index` 90° clockwise (i.e. -90° CCW). */
  rotatePageCw(index: number): boolean {
    return this.rotatePage(index, -90);
  }

  /** Rotate the page at `index` 90° counter-clockwise (+90° CCW). */
  rotatePageCcw(index: number): boolean {
    return this.rotatePage(index, 90);
  }

  /** Rotate the page at `index` 180°. */
  rotatePage180(index: number): boolean {
    return this.rotatePage(index, 180);
  }

  /**
   * Rotate the page at `index` by `delta` degrees (CCW positive: 90 | -90 | 180).
   * Returns true when a command was executed, false when out of range.
   */
  rotatePage(index: number, delta: RotationDelta): boolean {
    const cmd = buildRotatePageCmd(this._model, index, delta, this._onUpdate);
    if (!cmd) return false;
    this._history.execute(cmd);
    return true;
  }

  /**
   * Delete the page at `index`. Refuses to delete the last remaining page.
   * Fully undoable (re-inserts the page, its elements, and a GC'd source).
   * Returns true when a command was executed, false otherwise.
   */
  deletePage(index: number): boolean {
    const cmd = buildDeletePageCmd(this._model, this._elements, index, this._onUpdate);
    if (!cmd) return false;
    this._history.execute(cmd);
    return true;
  }

  /** Current normalized rotation (0/90/180/270 CCW) of the page at `index`. */
  rotationAt(index: number): number {
    const page = this._model.pages[index];
    return page ? normalizeRotation(page.rotation ?? 0) : 0;
  }

  /** Page id at `index`, or null when out of range. */
  pageIdAt(index: number): string | null {
    return this._model.pages[index]?.id ?? null;
  }
}
