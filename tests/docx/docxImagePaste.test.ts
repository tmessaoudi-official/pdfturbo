import { describe, it, expect } from 'vitest';
import { Slice, Fragment } from 'prosemirror-model';
import { docxSchema } from '../../src/docx/docxSchema';
import { resetPastedImageAnchors } from '../../src/docx/docxImagePaste';

const n = docxSchema.nodes;
function img(anchorId: number): ReturnType<typeof n.docx_image.create> {
  return n.docx_image.create({ dataB64: 'AAA', mime: 'image/png', widthPt: 100, heightPt: 50, anchorId });
}

describe('resetPastedImageAnchors', () => {
  it('rebuilds a docx_image with anchorId -1, preserving other attrs', () => {
    const out = resetPastedImageAnchors(new Slice(Fragment.fromArray([img(3)]), 0, 0));
    const node = out.content.firstChild;
    expect(node?.type.name).toBe('docx_image');
    expect(node?.attrs.anchorId).toBe(-1);
    expect(node?.attrs.dataB64).toBe('AAA');
    expect(node?.attrs.mime).toBe('image/png');
    expect(node?.attrs.widthPt).toBe(100);
    expect(node?.attrs.heightPt).toBe(50);
  });

  it('leaves a paragraph (and its text) untouched', () => {
    const para = n.paragraph.create(null, docxSchema.text('hello'));
    const out = resetPastedImageAnchors(new Slice(Fragment.fromArray([para]), 0, 0));
    expect(out.content.firstChild?.textContent).toBe('hello');
  });

  it('resets an image alongside other content', () => {
    const para = n.paragraph.create(null);
    const out = resetPastedImageAnchors(new Slice(Fragment.fromArray([img(0), para]), 0, 0));
    expect(out.content.firstChild?.attrs.anchorId).toBe(-1);
  });
});
