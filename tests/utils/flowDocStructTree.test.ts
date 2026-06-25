/**
 * B1 — tagged-PDF `getStructTree` exact-replace path for PDF→DOCX.
 *
 * `buildMarkedContentMap` splits a `getTextContent({includeMarkedContent:true})`
 * item stream into a map of marked-content-id → text items (attributing each
 * glyph run to the innermost MCID on the stack, dropping no-MCID artifacts).
 * `structTreeToFlow` walks the role tree (H1–6/P/L+LI/Table) in document reading
 * order and emits FlowParagraph[] + FlowTable[] straight from the tags — no
 * heuristic guessing. When correlation fails (tree references ids absent from the
 * map → zero text) it returns null so the caller falls back to the heuristic path
 * (byte-identical for untagged PDFs). `assignHeadings` must skip tagged pages so
 * the tag-derived levels aren't clobbered by the size heuristic.
 *
 * Pure functions → jsdom-unit-testable; the real-Chrome end-to-end correlation on
 * a genuine tagged PDF lives in tests/browser/docx-structtree.browser.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  buildMarkedContentMap,
  structTreeToFlow,
  assignHeadings,
  type RawTextItem,
  type FontInfoMap,
  type MarkedContentMarker,
  type StructTreeNodeLike,
  type FlowDoc,
  type FlowParagraph,
} from '../../src/utils/flowDoc';

const FONTS: FontInfoMap = {};

function txt(str: string, x: number, y: number, size = 12, fontName = 'f1', dir = 'ltr'): RawTextItem {
  return { str, dir, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size, fontName, hasEOL: false };
}
const begin = (id: string | undefined, tag: string): MarkedContentMarker => ({ type: 'beginMarkedContentProps', id, tag });
const end = (): MarkedContentMarker => ({ type: 'endMarkedContent' });
const leaf = (id: string): StructTreeNodeLike => ({ type: 'content', id });
const elem = (role: string, children: StructTreeNodeLike[]): StructTreeNodeLike => ({ role, children });

/** Narrow a possibly-null flow to non-null (oxlint forbids `!`). */
function expectFlow(flow: ReturnType<typeof structTreeToFlow>): NonNullable<typeof flow> {
  if (!flow) throw new Error('expected a non-null struct flow');
  return flow;
}

describe('buildMarkedContentMap (B1)', () => {
  it('attributes text items to their enclosing MCID, dropping no-MCID artifacts', () => {
    const items: Array<RawTextItem | MarkedContentMarker> = [
      begin('a', 'P'), txt('Hello', 10, 700), txt('World', 60, 700), end(),
      begin(undefined, 'Artifact'), txt('drop me', 10, 10), end(),
      begin('b', 'P'), txt('Bye', 10, 650), end(),
    ];
    const map = buildMarkedContentMap(items);
    expect([...map.keys()]).toEqual(['a', 'b']);
    expect((map.get('a') ?? []).map(i => i.str)).toEqual(['Hello', 'World']);
    expect((map.get('b') ?? []).map(i => i.str)).toEqual(['Bye']);
  });

  it('attributes to the innermost MCID on nested marked content', () => {
    const items: Array<RawTextItem | MarkedContentMarker> = [
      begin('outer', 'Sect'), txt('o', 5, 700),
      begin('inner', 'P'), txt('i', 10, 690), end(),
      end(),
    ];
    const map = buildMarkedContentMap(items);
    expect((map.get('outer') ?? []).map(i => i.str)).toEqual(['o']);
    expect((map.get('inner') ?? []).map(i => i.str)).toEqual(['i']);
  });
});

describe('structTreeToFlow (B1)', () => {
  it('emits headings / body / list items in document reading order from the tags', () => {
    const tree = elem('Root', [elem('Sect', [
      elem('H1', [leaf('h')]),
      elem('P', [leaf('p')]),
      elem('L', [
        elem('LI', [leaf('li1')]),
        elem('LI', [leaf('li2')]),
      ]),
    ])]);
    const map = new Map<string, RawTextItem[]>([
      ['h', [txt('Heading', 10, 750, 20)]],
      ['p', [txt('Body text', 10, 700, 12)]],
      ['li1', [txt('• First', 10, 650, 12)]],
      ['li2', [txt('• Second', 10, 630, 12)]],
    ]);
    const flow = expectFlow(structTreeToFlow(tree, map, FONTS, 600, 800));
    expect(flow.paragraphs.map(p => ({
      h: p.heading, t: p.runs.map(r => r.text).join(''), list: p.listType,
    }))).toEqual([
      { h: 1, t: 'Heading', list: undefined },
      { h: 0, t: 'Body text', list: undefined },
      { h: 0, t: 'First', list: 'bullet' },
      { h: 0, t: 'Second', list: 'bullet' },
    ]);
  });

  it('maps an ordered list-item marker to an ordered list with its format', () => {
    const tree = elem('Root', [elem('L', [elem('LI', [leaf('x')])])]);
    const map = new Map<string, RawTextItem[]>([['x', [txt('1. First item', 10, 700, 12)]]]);
    const flow = expectFlow(structTreeToFlow(tree, map, FONTS, 600, 800));
    expect(flow.paragraphs).toHaveLength(1);
    const p = flow.paragraphs[0];
    expect(p.listType).toBe('ordered');
    expect(p.listFormat).toBe('decimal');
    expect(p.runs.map(r => r.text).join('')).toBe('First item');
  });

  it('reads explicit heading levels (H2 → 2, bare H → 1)', () => {
    const tree = elem('Root', [
      elem('H2', [leaf('a')]),
      elem('H', [leaf('b')]),
    ]);
    const map = new Map<string, RawTextItem[]>([
      ['a', [txt('Sub', 10, 700, 16)]],
      ['b', [txt('Plain H', 10, 650, 16)]],
    ]);
    const flow = expectFlow(structTreeToFlow(tree, map, FONTS, 600, 800));
    expect(flow.paragraphs.map(p => p.heading)).toEqual([2, 1]);
  });

  it('builds a FlowTable grid from Table → TR → TH/TD', () => {
    const tree = elem('Root', [elem('Table', [
      elem('TR', [elem('TH', [leaf('a')]), elem('TH', [leaf('b')])]),
      elem('TR', [elem('TD', [leaf('c')]), elem('TD', [leaf('d')])]),
    ])]);
    const map = new Map<string, RawTextItem[]>([
      ['a', [txt('Name', 10, 700)]], ['b', [txt('Age', 80, 700)]],
      ['c', [txt('Alice', 10, 680)]], ['d', [txt('30', 80, 680)]],
    ]);
    const flow = expectFlow(structTreeToFlow(tree, map, FONTS, 600, 800));
    expect(flow.paragraphs).toHaveLength(0);
    expect(flow.tables).toHaveLength(1);
    expect(flow.tables[0].grid.cells).toEqual([['Name', 'Age'], ['Alice', '30']]);
    expect(flow.tables[0].grid.rows).toBe(2);
    expect(flow.tables[0].grid.cols).toBe(2);
  });

  it('returns null when the tree references ids absent from the marked-content map', () => {
    const tree = elem('Root', [elem('P', [leaf('missing')])]);
    const flow = structTreeToFlow(tree, new Map(), FONTS, 600, 800);
    expect(flow).toBeNull();
  });

  it('returns null for a null tree (caller falls back to heuristics)', () => {
    expect(structTreeToFlow(null, new Map(), FONTS, 600, 800)).toBeNull();
  });

  it('drops a tagged item that sits under a redaction rectangle', () => {
    const tree = elem('Root', [
      elem('P', [leaf('a')]),
      elem('P', [leaf('b')]),
    ]);
    const map = new Map<string, RawTextItem[]>([
      ['a', [txt('Secret', 10, 700, 12)]],
      ['b', [txt('Public', 10, 650, 12)]],
    ]);
    // Item 'a' baseline y=700,size=12 on an 800-tall page → top-origin box y∈[88,100].
    const redactions = [{ x: 0, y: 80, width: 200, height: 30 }];
    const flow = expectFlow(structTreeToFlow(tree, map, FONTS, 600, 800, redactions));
    expect(flow.paragraphs.map(p => p.runs.map(r => r.text).join(''))).toEqual(['Public']);
  });
});

describe('assignHeadings — tagged-page guard (B1)', () => {
  const para = (text: string, heading: FlowParagraph['heading'], size: number): FlowParagraph => ({
    runs: [{ text, bold: false, italic: false, fontSize: size, fontFamily: 'serif', rtl: false }],
    heading, alignment: 'left', rtl: false,
  });

  it('preserves tag-derived headings on a tagged page and still ranks untagged pages', () => {
    const doc: FlowDoc = {
      pages: [
        { width: 600, height: 800, tagged: true, paragraphs: [para('Title', 1, 18), para('body', 0, 12)] },
        { width: 600, height: 800, paragraphs: [para('Heading', 0, 20), para('this is a longer body paragraph with many words', 0, 12)] },
      ],
    };
    assignHeadings(doc);
    // Tagged page: levels untouched.
    expect(doc.pages[0].paragraphs[0].heading).toBe(1);
    expect(doc.pages[0].paragraphs[1].heading).toBe(0);
    // Untagged page: the larger size is promoted to a heading by the size pass.
    expect(doc.pages[1].paragraphs[0].heading).toBe(1);
    expect(doc.pages[1].paragraphs[1].heading).toBe(0);
  });
});
