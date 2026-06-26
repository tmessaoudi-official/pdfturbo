/**
 * Move an existing top-level docx_image among the top-level blocks (B slices 2 + 4).
 * `moveImageToGap` is the general mover (to an arbitrary block gap); `moveImageAt` is the ±1 wrapper
 * (▲/▼ + Alt+↑/↓); `moveImage(dir)` is the Command. All build ONE undoable transaction and keep the
 * node NodeSelected. The save path (`placeImageAnchors`) relocates the w:drawing by anchorId.
 */
import { type Command, type EditorState, type Transaction, NodeSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/** Document position of the start of top-level child `index` (Σ nodeSize of children before it). */
function topLevelChildStart(state: EditorState, index: number): number {
  let p = 0;
  for (let j = 0; j < index; j++) p += state.doc.child(j).nodeSize;
  return p;
}

// gap g ∈ [0, childCount]: insert the image BEFORE the original top-level child at index g
// (g === childCount → document end). No-op (null) when g is the image's own gap (g === ci || g === ci+1).
export function moveImageToGap(state: EditorState, pos: number, gap: number): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type !== state.schema.nodes.docx_image) return null;
  const $pos = state.doc.resolve(pos);
  if ($pos.depth !== 0) return null;                       // must be a TOP-LEVEL block
  const ci = $pos.index(0);
  const childCount = state.doc.childCount;
  const g = Math.max(0, Math.min(gap, childCount));
  if (g === ci || g === ci + 1) return null;               // dropping in its own gap → no-op
  const gapPos = g >= childCount ? state.doc.content.size : topLevelChildStart(state, g);
  const tr = state.tr.delete(pos, pos + node.nodeSize);
  const insertPos = tr.mapping.map(gapPos);
  tr.insert(insertPos, node);
  tr.setSelection(NodeSelection.create(tr.doc, insertPos));
  return tr.scrollIntoView();
}

export function moveImageAt(state: EditorState, pos: number, dir: -1 | 1): Transaction | null {
  const $pos = state.doc.resolve(pos);
  if ($pos.depth !== 0) return null;
  const ci = $pos.index(0);
  // dir -1 → gap ci-1 (before previous sibling); dir +1 → gap ci+2 (after next sibling).
  return moveImageToGap(state, pos, ci + (dir < 0 ? -1 : 2));
}

export function moveImage(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!(sel instanceof NodeSelection) || sel.node.type !== state.schema.nodes.docx_image) return false;
    const tr = moveImageAt(state, sel.from, dir);
    if (!tr) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

/** Nearest top-level gap (∈ [0, childCount]) to a viewport Y: counts block midpoints above clientY. */
export function dropTargetIndex(view: EditorView, clientY: number): number {
  const doc = view.state.doc;
  let p = 0;
  let g = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const top = view.coordsAtPos(p + 1).top;
    const bottom = view.coordsAtPos(p + child.nodeSize - 1).bottom;
    if (clientY > (top + bottom) / 2) g = i + 1;
    p += child.nodeSize;
  }
  return g;
}
