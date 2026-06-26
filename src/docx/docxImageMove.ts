/**
 * Move an existing top-level docx_image up/down one block (B slice 2). `moveImageAt` builds the
 * single undoable transaction (delete the node, re-insert before the prev / after the next top-level
 * block, keep it NodeSelected); `moveImage(dir)` is the Command wrapper gated on a docx_image selection.
 */
import { type Command, type EditorState, type Transaction, NodeSelection } from 'prosemirror-state';

export function moveImageAt(state: EditorState, pos: number, dir: -1 | 1): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type !== state.schema.nodes.docx_image) return null;
  const $pos = state.doc.resolve(pos);
  if ($pos.depth !== 0) return null;                       // must be a TOP-LEVEL block
  const index = $pos.index(0);
  const target = index + dir;
  if (target < 0 || target >= state.doc.childCount) return null; // bounds → no-op
  const from = pos;
  const to = pos + node.nodeSize;
  const tr = state.tr.delete(from, to);
  const insertPos = dir < 0
    ? tr.mapping.map(from - state.doc.child(index - 1).nodeSize) // before the previous sibling
    : tr.mapping.map(to + state.doc.child(index + 1).nodeSize);  // after the next sibling
  tr.insert(insertPos, node);
  tr.setSelection(NodeSelection.create(tr.doc, insertPos));
  return tr.scrollIntoView();
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
