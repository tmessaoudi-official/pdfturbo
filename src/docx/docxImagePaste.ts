/**
 * docxImagePaste — ProseMirror-layer helpers for cut/copy/paste of a docx_image (B sub-slice 3).
 * The whole feature reuses the slice-1/2 `anchorId:-1 ⇒ mint-fresh` insert path: every PASTED image
 * must arrive with anchorId -1 so the save mints a new OPC media part instead of tripping the
 * dup-free anchor guard (which would silently bail the save to verbatim).
 */
import { Slice, Fragment, type Node as PMNode } from 'prosemirror-model';
import { docxSchema } from './docxSchema';

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
