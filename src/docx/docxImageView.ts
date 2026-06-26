import type { EditorView, NodeView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
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

  dom.appendChild(se);
  dom.appendChild(del);

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
    stopEvent(e: Event): boolean { return e.target === se || e.target === del; },
    ignoreMutation(): boolean { return true; },
    destroy(): void {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    },
  };
}
