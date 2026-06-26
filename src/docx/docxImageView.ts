import type { EditorView, NodeView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { moveImageAt, moveImageToGap, dropTargetIndex } from './docxImageMove';
import { t } from '../utils/i18n';

/**
 * NodeView for the `docx_image` atom (Sub-project C Phase 2b). Renders the extracted picture and,
 * when the node is the active NodeSelection, a corner drag-handle (aspect-locked; Shift = free) and a
 * ✕ delete button. Resize dispatches a `setNodeMarkup` on widthPt/heightPt (one undo step); delete
 * removes the node. The save pre-pass (`reconcileImageAnchors`) maps the edited node back to its
 * source `w:p` via `anchorId`.
 */
export function createDocxImageView(node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const dom = document.createElement('span');
  dom.className = 'docx-image-wrap';

  const img = document.createElement('img');
  img.setAttribute('data-docx-image', '1');
  const apply = (nn: PMNode): void => {
    img.src = `data:${nn.attrs.mime as string};base64,${nn.attrs.dataB64 as string}`;
    const w = nn.attrs.widthPt as number;
    const h = nn.attrs.heightPt as number;
    img.style.cssText = `max-width:100%;${w ? `width:${w}pt;` : ''}${h ? `height:${h}pt;` : ''}`;
  };
  apply(node);
  dom.appendChild(img);

  const se = document.createElement('span');
  se.className = 'docx-image-handle se';
  se.setAttribute('data-docx-resize', 'se');

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'docx-image-del';
  del.textContent = '✕';
  del.title = t('docxEditor.deleteImage');
  del.setAttribute('aria-label', t('docxEditor.deleteImage'));

  // ▲/▼ move controls (B slice 2): relocate this image one top-level block up/down. A move past a bound
  // returns null → silent no-op. Move keeps the node selected so the user can move again immediately.
  const mkMoveBtn = (cls: string, glyph: string, key: string, dir: -1 | 1): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `docx-image-move ${cls}`;
    b.textContent = glyph;
    b.title = t(key);
    b.setAttribute('aria-label', t(key));
    b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', e => {
      e.preventDefault();
      const pos = getPos();
      if (pos === undefined) return;
      const tr = moveImageAt(view.state, pos, dir);
      if (tr) { view.dispatch(tr); view.focus(); }
    });
    return b;
  };
  const upBtn = mkMoveBtn('up', '▲', 'docxEditor.moveImageUp', -1);
  const downBtn = mkMoveBtn('down', '▼', 'docxEditor.moveImageDown', 1);

  dom.appendChild(se);
  dom.appendChild(del);
  dom.appendChild(upBtn);
  dom.appendChild(downBtn);

  let cur = node;
  const ratio = (): number => {
    const h = cur.attrs.heightPt as number;
    return h > 0 ? (cur.attrs.widthPt as number) / h : 1;
  };

  del.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  del.addEventListener('click', e => {
    e.preventDefault();
    const pos = getPos();
    if (pos === undefined) return;
    view.dispatch(view.state.tr.delete(pos, pos + cur.nodeSize));
    view.focus();
  });

  let startX = 0, startY = 0, startW = 0, startH = 0, free = false;
  // Target dims (pt) for a drag delta. Aspect-locked → height tracks width via the original ratio;
  // free (Shift) → width tracks dx and height tracks dy independently. px → pt at 96dpi (× 0.75).
  const dims = (e: PointerEvent): { widthPt: number; heightPt: number } => {
    const r = ratio();
    const widthPt = Math.max(1, (startW + (e.clientX - startX)) * 0.75);
    const heightPt = free
      ? Math.max(1, (startH + (e.clientY - startY)) * 0.75)
      : (r > 0 ? widthPt / r : widthPt);
    return { widthPt, heightPt };
  };
  const onMove = (e: PointerEvent): void => {
    const { widthPt, heightPt } = dims(e);
    img.style.width = `${widthPt}pt`;
    img.style.height = `${heightPt}pt`;
  };
  const onUp = (e: PointerEvent): void => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    const pos = getPos();
    if (pos === undefined) return;
    const { widthPt, heightPt } = dims(e);
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, widthPt, heightPt }));
  };
  se.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    // Base the drag on the node's stored width/heightPt (px = pt / 0.75), NOT getBoundingClientRect —
    // max-width:100% can clamp the rendered size and would make the resize drift. Fall back to the rect
    // only when the pt dim is 0 (extent absent → natural size).
    const rect = img.getBoundingClientRect();
    startW = (cur.attrs.widthPt as number) > 0 ? (cur.attrs.widthPt as number) / 0.75 : rect.width;
    startH = (cur.attrs.heightPt as number) > 0 ? (cur.attrs.heightPt as number) / 0.75 : rect.height;
    free = e.shiftKey;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  // Image-body drag-to-reorder (B slice 4). The .se/✕/▲▼ children capture their own events; a plain
  // click (< DRAG_THRESHOLD px) selects (PM default), a drag moves the image to the nearest top-level gap.
  const DRAG_THRESHOLD = 5;
  let dragStartX = 0, dragStartY = 0, dragging = false;
  let dropLine: HTMLDivElement | null = null;
  let rootPrevPosition: string | null = null; // restore the root's inline position after the drag
  const editorRoot = (): HTMLElement => (view.dom.parentElement ?? view.dom) as HTMLElement;
  const showDropLine = (clientY: number): void => {
    const g = dropTargetIndex(view, clientY);
    const root = editorRoot();
    if (dropLine === null) {
      // The absolutely-positioned line anchors to `root`, so root must be a positioned offset parent.
      if (getComputedStyle(root).position === 'static') {
        rootPrevPosition = root.style.position;
        root.style.position = 'relative';
      }
      dropLine = document.createElement('div');
      dropLine.className = 'docx-image-drop-line';
      root.appendChild(dropLine);
    }
    const rootRect = root.getBoundingClientRect();
    const doc = view.state.doc;
    let p = 0;
    for (let i = 0; i < g; i++) p += doc.child(i).nodeSize;
    const y = g >= doc.childCount
      ? view.coordsAtPos(doc.content.size).bottom
      : view.coordsAtPos(p + 1).top;
    dropLine.style.top = `${y - rootRect.top + root.scrollTop}px`;
  };
  const clearDropLine = (): void => {
    if (dropLine !== null) { dropLine.remove(); dropLine = null; }
    if (rootPrevPosition !== null) { editorRoot().style.position = rootPrevPosition; rootPrevPosition = null; }
  };
  const onImgMove = (e: PointerEvent): void => {
    if (!dragging && Math.abs(e.clientX - dragStartX) + Math.abs(e.clientY - dragStartY) > DRAG_THRESHOLD) {
      dragging = true;
      dom.classList.add('docx-image-dragging');
    }
    if (dragging) showDropLine(e.clientY);
  };
  const onImgUp = (e: PointerEvent): void => {
    document.removeEventListener('pointermove', onImgMove);
    document.removeEventListener('pointerup', onImgUp);
    dom.classList.remove('docx-image-dragging');
    clearDropLine();
    if (!dragging) return;                       // a plain click — PM already handled selection
    dragging = false;
    const pos = getPos();
    if (pos === undefined) return;
    const tr = moveImageToGap(view.state, pos, dropTargetIndex(view, e.clientY));
    if (tr) { view.dispatch(tr); view.focus(); }
  };
  img.addEventListener('pointerdown', e => {
    // Do NOT preventDefault — a plain click must still select the node (PM handles it).
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragging = false;
    document.addEventListener('pointermove', onImgMove);
    document.addEventListener('pointerup', onImgUp);
  });

  return {
    dom,
    update(nn: PMNode): boolean {
      if (nn.type !== cur.type) return false;
      cur = nn;
      apply(nn);
      return true;
    },
    selectNode(): void { dom.classList.add('selected'); },
    deselectNode(): void { dom.classList.remove('selected'); },
    stopEvent(e: Event): boolean { return e.target === se || e.target === del || e.target === upBtn || e.target === downBtn; },
    ignoreMutation(): boolean { return true; },
    destroy(): void {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointermove', onImgMove);
      document.removeEventListener('pointerup', onImgUp);
      clearDropLine();
    },
  };
}
