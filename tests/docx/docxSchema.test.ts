/**
 * Phase 2 Slice A: the extended ProseMirror schema (underline / fontFamily / fontSize
 * marks; heading node from schema-basic; bullet/ordered lists from schema-list). jsdom.
 */
import { describe, it, expect } from 'vitest';
import { DOMSerializer } from 'prosemirror-model';
import { docxSchema } from '../../src/docx/docxSchema';

function htmlOf(node: ReturnType<typeof docxSchema.node>): string {
  const div = document.createElement('div');
  div.appendChild(DOMSerializer.fromSchema(docxSchema).serializeFragment(node.content));
  return div.innerHTML;
}

describe('docxSchema (Task 5)', () => {
  it('exposes u/font/size marks and heading/list nodes', () => {
    for (const m of ['strong', 'em', 'underline', 'fontFamily', 'fontSize']) expect(docxSchema.marks[m]).toBeDefined();
    for (const n of ['heading', 'bullet_list', 'ordered_list', 'list_item']) expect(docxSchema.nodes[n]).toBeDefined();
  });

  it('serializes underline to <u> and font marks to span styles', () => {
    const doc = docxSchema.node('doc', null, [
      docxSchema.node('paragraph', null, [
        docxSchema.text('u', [docxSchema.marks.underline.create()]),
        docxSchema.text('f', [docxSchema.marks.fontFamily.create({ family: 'Arial' })]),
        docxSchema.text('s', [docxSchema.marks.fontSize.create({ size: 14 })]),
      ]),
    ]);
    const html = htmlOf(doc);
    expect(html).toContain('<u>');
    expect(html).toContain('font-family');
    expect(html).toContain('Arial');
    expect(html).toContain('font-size');
    expect(html).toContain('14pt');
  });

  it('serializes a heading node to hN and an ordered list to <ol><li>', () => {
    const doc = docxSchema.node('doc', null, [
      docxSchema.node('heading', { level: 2 }, [docxSchema.text('Title')]),
      docxSchema.node('ordered_list', null, [
        docxSchema.node('list_item', null, [docxSchema.node('paragraph', null, [docxSchema.text('one')])]),
      ]),
    ]);
    const html = htmlOf(doc);
    expect(html).toContain('<h2>');
    expect(html).toContain('<ol');
    expect(html).toContain('<li>');
  });
});
