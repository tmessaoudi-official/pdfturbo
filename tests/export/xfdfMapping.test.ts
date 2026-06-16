/**
 * XFDF ↔ element-model mapping (#57). The codec (xfdf.ts) handles the XML; this
 * covers the coordinate flip (editor display space, top-left/y-down ↔ PDF user
 * space, bottom-left/y-up) and the type mapping. Round-trip through PDF user
 * space must preserve geometry and payload for the supported types.
 */
import { describe, it, expect } from 'vitest';
import { elementToXfdfAnnot, xfdfAnnotToElement } from '../../src/export/xfdfMapping';
import type { ElementJSON } from '../../src/elements/annotationElement';

const H = 800;

const HIGHLIGHT: ElementJSON = { id: 1, type: 'highlight', x: 50, y: 100, width: 200, height: 20, pageId: 'p1', color: '#FFFF00', opacity: 0.4 };
const COMMENT: ElementJSON = { id: 2, type: 'comment', x: 300, y: 50, width: 24, height: 24, pageId: 'p1', color: '#FFFDE7', text: 'a note' };
const TEXT: ElementJSON = { id: 3, type: 'text', x: 10, y: 20, width: 150, height: 30, pageId: 'p1', color: '#000000', text: 'hi there', fontSize: 14 };

describe('XFDF element mapping (#57)', () => {
  it('flips a highlight to PDF user space and back without loss', () => {
    const a = elementToXfdfAnnot(HIGHLIGHT, 0, H);
    if (!a) throw new Error('expected a highlight annot');
    expect(a).toEqual({ type: 'highlight', page: 0, rect: [50, 680, 250, 700], color: '#FFFF00', opacity: 0.4 });
    expect(xfdfAnnotToElement(a, 'p1', H)).toMatchObject({ type: 'highlight', x: 50, y: 100, width: 200, height: 20, pageId: 'p1', color: '#FFFF00', opacity: 0.4 });
  });

  it('maps a comment ↔ XFDF text (sticky note)', () => {
    const a = elementToXfdfAnnot(COMMENT, 2, H);
    if (!a) throw new Error('expected a text annot');
    expect(a).toEqual({ type: 'text', page: 2, rect: [300, 726, 324, 750], color: '#FFFDE7', contents: 'a note' });
    expect(xfdfAnnotToElement(a, 'pX', H)).toMatchObject({ type: 'comment', x: 300, y: 50, width: 24, height: 24, pageId: 'pX', text: 'a note' });
  });

  it('maps a text element ↔ XFDF freetext, preserving font size and body', () => {
    const a = elementToXfdfAnnot(TEXT, 0, H);
    if (!a) throw new Error('expected a freetext annot');
    expect(a).toEqual({ type: 'freetext', page: 0, rect: [10, 750, 160, 780], color: '#000000', contents: 'hi there', fontSize: 14 });
    expect(xfdfAnnotToElement(a, 'p1', H)).toMatchObject({ type: 'text', x: 10, y: 20, width: 150, height: 30, pageId: 'p1', text: 'hi there', fontSize: 14 });
  });

  it('returns null for unsupported element types (skipped, never mis-mapped)', () => {
    const sig: ElementJSON = { id: 9, type: 'signature', x: 0, y: 0, width: 10, height: 10, pageId: 'p1' };
    expect(elementToXfdfAnnot(sig, 0, H)).toBeNull();
  });
});
