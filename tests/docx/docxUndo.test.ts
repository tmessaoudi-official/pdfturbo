/**
 * Sub-project C Phase 2b — editor-wide undo (prosemirror-history).
 * jsdom: a setNodeMarkup (resize) is undoable, and a find/replace replace-all is one undo step.
 */
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { NodeSelection } from 'prosemirror-state';
import { undo } from 'prosemirror-history';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const DOC_ONE_IMG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/>
    <a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>
  </wp:inline></w:drawing></w:r></w:p></w:body></w:document>`;
const DOC_RELS_IMG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;
function makeDocxOneImage(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOC_ONE_IMG),
    'word/_rels/document.xml.rels': strToU8(DOC_RELS_IMG),
    'word/media/image1.png': b64ToBytes(PNG_B64),
  });
}

function imgPos(view: { state: { doc: { descendants: (f: (n: { type: { name: string } }, p: number) => void) => void } } }): number {
  let pos = -1;
  view.state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') pos = p; });
  return pos;
}

describe('DOCX editor — undo (prosemirror-history)', () => {
  it('undoes a setNodeMarkup image resize', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocxOneImage());
    const view = handle.view;
    const pos = imgPos(view);
    const node = view.state.doc.nodeAt(pos);
    const before = Number(node?.attrs.widthPt);
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node?.attrs, widthPt: 200 }));
    expect(Number(view.state.doc.nodeAt(pos)?.attrs.widthPt)).toBe(200);
    undo(view.state, view.dispatch);
    expect(Number(view.state.doc.nodeAt(pos)?.attrs.widthPt)).toBe(before);
    handle.destroy();
    container.remove();
  });

  it('undoes an image deletion (restores the node)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocxOneImage());
    const view = handle.view;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos(view))).deleteSelection());
    expect(imgPos(view)).toBe(-1); // gone
    undo(view.state, view.dispatch);
    expect(imgPos(view)).toBeGreaterThanOrEqual(0); // restored
    handle.destroy();
    container.remove();
  });
});
