/**
 * pageOpsCmds — index-aware command BUILDERS for page operations (Agent P).
 *
 * These factories translate INDEX-based intent (move page i→j, rotate page #i,
 * delete page #i) into the canonical id-based undoable commands that already
 * exist in `pageCmds.ts`. They never mutate `DocumentModel` directly — every
 * mutation flows through the existing `ReorderPagesCmd` / `RotatePageCmd` /
 * `DeletePageCmd`, which delegate to the model's own methods. That keeps undo,
 * sourcePdf GC and currentPageIndex clamping identical to the existing path.
 *
 * The returned object is a `Command` ({ execute, undo }) ready to hand to
 * `HistoryManager.execute(cmd)`. Builders return `null` when the requested
 * operation is a no-op or out of range, so callers can skip pushing to history.
 */
import type { PDFElement } from '../../elements/annotationElement';
import type { DocumentModel, SourcePdf } from '../documentModel';
import type { Command } from './command';
import { ReorderPagesCmd, RotatePageCmd, DeletePageCmd } from './pageCmds';

/** Allowed rotation deltas (degrees, CCW positive). */
export type RotationDelta = 90 | -90 | 180;

/** Compute the page-id order after moving the element at `from` to `to`. */
export function computeReorder(ids: readonly string[], from: number, to: number): string[] {
  const next = ids.slice();
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Normalize any degree value to the canonical 0/90/180/270 bucket (CCW). */
export function normalizeRotation(deg: number): number {
  return (((deg % 360) + 360) % 360);
}

/**
 * Build a reorder command moving the page at `from` to index `to`.
 * Returns null when out of range or a no-op (no history entry needed).
 */
export function buildMovePageCmd(
  model: DocumentModel,
  from: number,
  to: number,
  onUpdate: () => void,
): Command | null {
  const before = model.pages.map(p => p.id);
  if (from < 0 || from >= before.length || to < 0 || to >= before.length || from === to) {
    return null;
  }
  const after = computeReorder(before, from, to);
  return new ReorderPagesCmd(model, before, after, onUpdate);
}

/**
 * Build a rotate command for the page at `index` by `delta` degrees (CCW).
 * Returns null when the index is out of range.
 */
export function buildRotatePageCmd(
  model: DocumentModel,
  index: number,
  delta: RotationDelta,
  onUpdate: () => void,
): Command | null {
  const page = model.pages[index];
  if (!page) return null;
  return new RotatePageCmd(model, page.id, delta, onUpdate);
}

/**
 * Build a delete command for the page at `index`. Refuses to delete the last
 * remaining page (returns null) so the document is never left page-less.
 * `elements` is the live element array (the command splices out / restores the
 * deleted page's elements); a `SourcePdf` snapshot is captured so undo can
 * re-add a source that was GC'd when its last page was removed.
 */
export function buildDeletePageCmd(
  model: DocumentModel,
  elements: PDFElement[],
  index: number,
  onUpdate: () => void,
): Command | null {
  const page = model.pages[index];
  if (!page) return null;
  if (model.pageCount <= 1) return null;
  const sourceSnapshot: SourcePdf | undefined = model.sourcePdfs.get(page.sourcePdfId);
  return new DeletePageCmd(model, elements, page.id, onUpdate, sourceSnapshot);
}
