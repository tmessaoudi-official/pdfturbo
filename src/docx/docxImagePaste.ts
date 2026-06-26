/**
 * docxImagePaste — ProseMirror-layer helpers for cut/copy/paste of a docx_image (B sub-slice 3).
 * The whole feature reuses the slice-1/2 `anchorId:-1 ⇒ mint-fresh` insert path: every PASTED image
 * must arrive with anchorId -1 so the save mints a new OPC media part instead of tripping the
 * dup-free anchor guard (which would silently bail the save to verbatim).
 */
import { Slice, Fragment, type Node as PMNode } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { docxSchema } from './docxSchema';

export const PT_PER_PX = 0.75;        // 96 DPI → 72 pt/in
export const CONTENT_WIDTH_PT = 468;  // usable width on a letter page (8.5in − 2×1in margins)

function mapFragment(frag: Fragment): Fragment {
  const out: PMNode[] = [];
  frag.forEach((child) => {
    if (child.type === docxSchema.nodes.docx_image) {
      out.push(child.type.create({ ...child.attrs, anchorId: -1 }, child.content, child.marks));
    } else if (child.content.size > 0) {
      out.push(child.copy(mapFragment(child.content)));
    } else {
      out.push(child);
    }
  });
  return Fragment.fromArray(out);
}

/** Return a copy of the pasted slice with every docx_image's anchorId reset to -1 (new identity). */
export function resetPastedImageAnchors(slice: Slice): Slice {
  return new Slice(mapFragment(slice.content), slice.openStart, slice.openEnd);
}

export function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export function imgBytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Natural image size scaled to pt (width clamped to the content width); {0,0} on decode failure. */
export async function imageDimsPt(bytes: Uint8Array, mime: 'image/png' | 'image/jpeg'): Promise<{ widthPt: number; heightPt: number }> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const widthPt = Math.min(bmp.width * PT_PER_PX, CONTENT_WIDTH_PT);
    const heightPt = bmp.width > 0 ? widthPt * (bmp.height / bmp.width) : 0;
    bmp.close();
    return { widthPt, heightPt };
  } catch {
    return { widthPt: 0, heightPt: 0 };
  }
}

/** First png/jpeg blob on the clipboard (files first, then items), or null. */
export function firstImageFile(dt: DataTransfer | null): File | null {
  if (dt === null) return null;
  for (let i = 0; i < dt.files.length; i++) {
    const f = dt.files[i];
    if (f.type === 'image/png' || f.type === 'image/jpeg') return f;
  }
  const items = dt.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'file' && (it.type === 'image/png' || it.type === 'image/jpeg')) {
      const f = it.getAsFile();
      if (f !== null) return f;
    }
  }
  return null;
}

/**
 * Insert a block image node. When an image (NodeSelection) is selected, insert AFTER it so a new
 * image is ADDED, not replaced (F1 fix); otherwise replace the (text) selection at the cursor.
 */
export function insertImageNode(view: EditorView, node: PMNode): void {
  const { state } = view;
  const sel = state.selection;
  if (sel instanceof NodeSelection) {
    const tr = state.tr.insert(sel.to, node);
    tr.setSelection(NodeSelection.create(tr.doc, sel.to));
    view.dispatch(tr.scrollIntoView());
  } else {
    view.dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
  }
  view.focus();
}

/** Decode an image blob and insert it as a docx_image (anchorId -1) at/after the selection. */
export async function insertImageBlob(view: EditorView, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageMime(bytes);
  if (mime === null) return;
  const { widthPt, heightPt } = await imageDimsPt(bytes, mime);
  const node = docxSchema.nodes.docx_image.create({ dataB64: imgBytesToB64(bytes), mime, widthPt, heightPt, anchorId: -1 });
  insertImageNode(view, node);
}
