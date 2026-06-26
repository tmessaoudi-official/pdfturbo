import { describe, it, expect } from 'vitest';
import { Slice, Fragment, DOMParser as PMDOMParser, type Node as PMNode } from 'prosemirror-model';
import { docxSchema } from '../../src/docx/docxSchema';
import { resetPastedImageAnchors, firstImageFile } from '../../src/docx/docxImagePaste';

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

describe('docx_image parseDOM', () => {
  function parseHtml(html: string): PMNode {
    const div = document.createElement('div');
    div.innerHTML = html;
    return PMDOMParser.fromSchema(docxSchema).parse(div);
  }
  function imageNodes(doc: PMNode): PMNode[] {
    const found: PMNode[] = [];
    doc.descendants((node) => { if (node.type.name === 'docx_image') found.push(node); });
    return found;
  }
  it('parses our own data-uri image into a docx_image with anchorId -1', () => {
    const found = imageNodes(parseHtml('<img data-docx-image src="data:image/png;base64,QUJD">'));
    expect(found.length).toBe(1);
    expect(found[0].attrs.mime).toBe('image/png');
    expect(found[0].attrs.dataB64).toBe('QUJD');
    expect(found[0].attrs.anchorId).toBe(-1);
  });
  it('does NOT parse an external http image into a docx_image', () => {
    expect(imageNodes(parseHtml('<img src="https://example.com/x.png">')).length).toBe(0);
  });
  it('does NOT parse a data-uri <img> lacking the data-docx-image attr', () => {
    expect(imageNodes(parseHtml('<img src="data:image/png;base64,QUJD">')).length).toBe(0);
  });
});

describe('firstImageFile', () => {
  // jsdom has no DataTransfer constructor; stub the shape firstImageFile reads (.files + .items).
  function dtWith(files: File[]): DataTransfer {
    return { files: files as unknown as FileList, items: [] as unknown as DataTransferItemList } as unknown as DataTransfer;
  }
  it('returns the first png/jpeg file', () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' });
    expect(firstImageFile(dtWith([png]))?.type).toBe('image/png');
  });
  it('returns null for a text-only DataTransfer', () => {
    const txt = new File(['hi'], 'a.txt', { type: 'text/plain' });
    expect(firstImageFile(dtWith([txt]))).toBeNull();
  });
  it('returns null for a null DataTransfer', () => {
    expect(firstImageFile(null)).toBeNull();
  });
});
