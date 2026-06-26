import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, NodeSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { docxSchema } from '../../src/docx/docxSchema';
import { createDocxImageView } from '../../src/docx/docxImageView';
import { moveImageAt, moveImage } from '../../src/docx/docxImageMove';

function imgNode(): PMNode { return docxSchema.nodes.docx_image.create({ dataB64: '', mime: 'image/png', widthPt: 10, heightPt: 10, anchorId: 0 }); }
function para(t: string): PMNode { return docxSchema.node('paragraph', null, [docxSchema.text(t)]); }
function stateWith(nodes: PMNode[]): EditorState {
  return EditorState.create({ doc: docxSchema.node('doc', null, nodes) });
}
function imgIndex(doc: PMNode): number {
  let idx = -1;
  doc.forEach((n, _o, i) => { if (n.type.name === 'docx_image') idx = i; });
  return idx;
}
function imgPos(state: EditorState): number {
  let pos = -1;
  state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') pos = p; });
  return pos;
}

describe('moveImage', () => {
  it('moves the image DOWN one block', () => {
    const state = stateWith([imgNode(), para('A'), para('B')]); // [img, A, B]
    const tr = moveImageAt(state, imgPos(state), 1);
    expect(tr).not.toBeNull();
    expect(imgIndex((tr as NonNullable<typeof tr>).doc)).toBe(1); // [A, img, B]
  });

  it('moves the image UP one block', () => {
    const state = stateWith([para('A'), imgNode(), para('B')]); // [A, img, B]
    const tr = moveImageAt(state, imgPos(state), -1);
    expect(imgIndex((tr as NonNullable<typeof tr>).doc)).toBe(0); // [img, A, B]
  });

  it('no-op at the top bound (returns null)', () => {
    const state = stateWith([imgNode(), para('A')]);
    expect(moveImageAt(state, imgPos(state), -1)).toBeNull();
  });

  it('no-op at the bottom bound (returns null)', () => {
    const state = stateWith([para('A'), imgNode()]);
    expect(moveImageAt(state, imgPos(state), 1)).toBeNull();
  });

  it('moveImage(dir) command returns false when the selection is not a docx_image', () => {
    let state = stateWith([para('A'), imgNode()]);
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0))); // select the paragraph node
    expect(moveImage(1)(state, undefined)).toBe(false);
  });

  it('moveImage(dir) command dispatches and keeps the moved node selected', () => {
    let state = stateWith([imgNode(), para('A')]);
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, imgPos(state))));
    let dispatched = false;
    const ok = moveImage(1)(state, tr => { dispatched = true; state = state.apply(tr); });
    expect(ok).toBe(true);
    expect(dispatched).toBe(true);
    expect(state.selection).toBeInstanceOf(NodeSelection);
    expect(imgIndex(state.doc)).toBe(1);
  });
});

// jsdom lacks layout; stub the rect APIs so EditorView creation/coordsAtPos don't throw.
function fakeRect(): DOMRect {
  return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

describe('docx_image NodeView — move buttons', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Element.prototype.getClientRects = (): DOMRectList => [fakeRect()] as unknown as DOMRectList;
    Element.prototype.getBoundingClientRect = (): DOMRect => fakeRect();
    Range.prototype.getClientRects = (): DOMRectList => [fakeRect()] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = (): DOMRect => fakeRect();
  });

  it('renders ▲ and ▼ controls', () => {
    const place = document.createElement('div');
    document.body.appendChild(place);
    const view = new EditorView(place, {
      state: stateWith([imgNode()]),
      nodeViews: { docx_image: (node, v, getPos) => createDocxImageView(node, v, getPos) },
    });
    expect(place.querySelector('.docx-image-move.up')).not.toBeNull();
    expect(place.querySelector('.docx-image-move.down')).not.toBeNull();
    view.destroy();
    place.remove();
  });
});
