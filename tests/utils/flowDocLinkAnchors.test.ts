/**
 * Limits row 22 (D11) — a PDF's internal (GoTo) links become Word bookmarks and Markdown anchors.
 *
 * Until row 22 only Link annotations carrying a `url` reached the flow export; a jump to another page of the same
 * document ("see Section 3", a table of contents, a footnote mark) came out as plain text. The link now names its
 * target page and view top; after every page is built, `resolveLinkAnchors` places a bookmark on the paragraph it
 * lands on, and the writers emit a Word internal hyperlink / a Markdown `(#…)` link to it.
 */
import { describe, it, expect } from 'vitest';
import { resolveLinkAnchors, reconstructPage, splitItemAtLinks, type FlowDoc, type FlowPage, type FlowParagraph, type FlowRun, type LinkTarget, type RawTextItem, type FontInfoMap } from '../../src/utils/flowDoc';
import { flowDocToMarkdown, flowDocToText, flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';
import { resolveGoToDest, type DestDoc } from '../../src/export/linkDest';

const run = (text: string, opts: Partial<FlowRun> = {}): FlowRun =>
  ({ text, bold: false, italic: false, fontSize: 12, fontFamily: 'sans-serif', rtl: false, ...opts });
const para = (text: string, y?: number, opts: Partial<FlowParagraph> = {}): FlowParagraph =>
  ({ runs: [run(text)], heading: 0, alignment: 'left', rtl: false, y, ...opts });
const page = (...paragraphs: FlowParagraph[]): FlowPage => ({ width: 612, height: 792, paragraphs });
const linked = (text: string, key: string) => ({ runs: [run('See '), run(text, { linkAnchor: key })], heading: 0 as const, alignment: 'left' as const, rtl: false, y: 700 });

async function docxXml(doc: FlowDoc): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  return strFromU8(unzipSync(new Uint8Array(Buffer.from(await flowDocToDocxBase64(doc), 'base64')))['word/document.xml']);
}

describe('resolveLinkAnchors — which paragraph a link lands on', () => {
  it('the nearest paragraph starting at or below the view top', () => {
    const target = page(para('Intro', 740), para('Section Two', 600), para('Its body', 580));
    const src = page(linked('Section Two', 'k'));
    resolveLinkAnchors([src, target], new Map<string, LinkTarget>([['k', { page: target, top: 612 }]]));
    expect(target.paragraphs.map(p => p.bookmark)).toEqual([undefined, '_pdfturbo_link_1', undefined]);
    expect(src.paragraphs[0].runs[1].linkAnchor).toBe('_pdfturbo_link_1');
  });

  it('one point of slack above the paragraph top (producers put the edge on the heading)', () => {
    const target = page(para('Intro', 740), para('Section Two', 600.8));
    resolveLinkAnchors([page(linked('x', 'k')), target], new Map([['k', { page: target, top: 600 }]]));
    expect(target.paragraphs[1].bookmark).toBeDefined();
  });

  it('a destination with no height lands on the page’s first paragraph', () => {
    const target = page(para('First', 740), para('Second', 600));
    resolveLinkAnchors([page(linked('x', 'k')), target], new Map([['k', { page: target }]]));
    expect(target.paragraphs[0].bookmark).toBeDefined();
    expect(target.paragraphs[1].bookmark).toBeUndefined();
  });

  it('a view top below every paragraph start lands on the lowest one (the paragraph it falls in)', () => {
    const target = page(para('First', 740), para('Last', 400));
    resolveLinkAnchors([page(linked('x', 'k')), target], new Map([['k', { page: target, top: 120 }]]));
    expect(target.paragraphs.map(p => !!p.bookmark)).toEqual([false, true]);
  });

  it('a target missing from the export leaves plain text, not a dangling link', () => {
    const src = page(linked('x', 'gone'));
    resolveLinkAnchors([src], new Map());
    expect(src.paragraphs[0].runs[1].linkAnchor).toBeUndefined();
  });

  it('two links to one paragraph share its bookmark; a link pointing forward resolves too', () => {
    const target = page(para('Target', 600));
    const src = page(linked('a', 'k1'), linked('b', 'k2'));
    resolveLinkAnchors([src, target], new Map([['k1', { page: target, top: 610 }], ['k2', { page: target }]]));
    expect(src.paragraphs.map(p => p.runs[1].linkAnchor)).toEqual(['_pdfturbo_link_1', '_pdfturbo_link_1']);
  });

  it('whitespace-only paragraphs are never a target', () => {
    const target = page(para('   ', 700), para('Real', 650));
    resolveLinkAnchors([page(linked('x', 'k')), target], new Map([['k', { page: target }]]));
    expect(target.paragraphs.map(p => !!p.bookmark)).toEqual([false, true]);
  });
});

describe('reconstructPage — a GoTo link rect tags its words', () => {
  it('words under an anchor rect carry the key, and it keeps them out of a neighbouring run', () => {
    const item = (str: string, x: number): RawTextItem => ({ str, transform: [12, 0, 0, 12, x, 700], width: str.length * 6, fontName: 'f1', dir: 'ltr' } as RawTextItem);
    const pageOut = reconstructPage([item('See', 72), item('Section', 100), item('Two', 150)], {} as FontInfoMap, 612, 792, undefined, undefined,
      [{ anchor: 'k', x0: 98, y0: 695, x1: 175, y1: 715 }]);
    const runs = pageOut.paragraphs[0].runs;
    expect(runs.map(r => [r.text, r.linkAnchor])).toEqual([['See', undefined], [' Section Two', 'k']]);
  });
});

describe('splitItemAtLinks — a link inside a merged item tags only its words', () => {
  // "See Methods for the setup." drawn as one pdf.js item, 6pt per character for easy arithmetic.
  const str = 'See Methods for the setup.';
  const at = (i: number) => 100 + 6 * i;
  const link = (a: number, b: number, extra = {}) => ({ x0: at(a) - 1, x1: at(b) + 1, y0: 690, y1: 715, anchor: 'k', ...extra });

  it('cuts at both edges; the pieces rejoin to the item and tile its width', () => {
    const pieces = splitItemAtLinks(str, 100, 6 * str.length, 704, [link(4, 11)]);
    expect(pieces.map(p => p.text)).toEqual(['See ', 'Methods', ' for the setup.']);
    expect(pieces.map(p => p.text).join('')).toBe(str);
    expect(pieces[1].x).toBeCloseTo(at(4));
    expect(pieces.reduce((s, p) => s + p.width, 0)).toBeCloseTo(6 * str.length);
  });

  it('an edge estimated a character or two off snaps to the token it bounds, not into the space', () => {
    // Right edge two characters past "Methods" (inside " f"), left edge one character early (on the space).
    const pieces = splitItemAtLinks(str, 100, 6 * str.length, 704, [{ x0: at(3) + 1, x1: at(13) - 2, y0: 690, y1: 715, anchor: 'k' }]);
    expect(pieces.map(p => p.text)).toEqual(['See ', 'Methods', ' for the setup.']);
  });

  it('a link on another line, or covering the whole item, leaves it whole', () => {
    expect(splitItemAtLinks(str, 100, 6 * str.length, 704, [link(4, 11, { y0: 600, y1: 620 })])).toHaveLength(1);
    expect(splitItemAtLinks(str, 100, 6 * str.length, 704, [{ x0: 90, x1: 400, y0: 690, y1: 715, anchor: 'k' }])).toHaveLength(1);
  });

  it('through reconstructPage: only the linked word carries the link (external URLs too)', () => {
    const item = { str, transform: [12, 0, 0, 12, 100, 700], width: 6 * str.length, fontName: 'f1', dir: 'ltr' } as RawTextItem;
    const out = reconstructPage([item], {} as FontInfoMap, 612, 792, undefined, undefined, [{ ...link(4, 11), anchor: undefined, url: 'https://example.com' }]);
    expect(out.paragraphs[0].runs.map(r => [r.text, r.linkUrl])).toEqual([['See ', undefined], ['Methods', 'https://example.com'], [' for the setup.', undefined]]);
  });

  it('an RTL item is not cut (its characters do not run left to right)', () => {
    const item = { str: '\u0645\u0631\u062d\u0628\u0627 \u0628\u0643\u0645', transform: [12, 0, 0, 12, 100, 700], width: 54, fontName: 'f1', dir: 'rtl' } as RawTextItem;
    const out = reconstructPage([item], {} as FontInfoMap, 612, 792, undefined, undefined, [{ x0: 130, x1: 160, y0: 690, y1: 715, anchor: 'k' }]);
    expect(out.paragraphs[0].runs).toHaveLength(1);
  });

  it('a redacted item never reaches the cut: the redaction filter runs first and drops it whole', () => {
    const item = { str, transform: [12, 0, 0, 12, 100, 700], width: 6 * str.length, fontName: 'f1', dir: 'ltr' } as RawTextItem;
    // A redaction over "See" only (display space, y-down: baseline 700 → top ≈ 792-712).
    const out = reconstructPage([item], {} as FontInfoMap, 612, 792, undefined, [{ x: 99, y: 78, width: 20, height: 18 }], [link(4, 11)]);
    expect(out.paragraphs.flatMap(p => p.runs).map(r => r.text).join('')).toBe('');
  });
});

describe('writers', () => {
  const build = (): FlowDoc => {
    const target = page(para('Section Two', 600));
    const src = page(linked('Section Two', 'k'));
    resolveLinkAnchors([src, target], new Map([['k', { page: target, top: 612 }]]));
    return { pages: [src, target] };
  };

  it('DOCX: a bookmark around the target paragraph and a hyperlink to it', async () => {
    const xml = await docxXml(build());
    expect(xml).toMatch(/<w:bookmarkStart [^>]*w:name="_pdfturbo_link_1"/);
    expect(xml).toMatch(/<w:hyperlink [^>]*w:anchor="_pdfturbo_link_1"/);
    // The bookmark wraps the target's text, and its end closes it.
    expect(xml.indexOf('w:name="_pdfturbo_link_1"')).toBeLessThan(xml.lastIndexOf('Section Two'));
    expect(xml).toContain('<w:bookmarkEnd');
  });

  it('DOCX: no internal link, no bookmark markup (byte-shape unchanged)', async () => {
    const xml = await docxXml({ pages: [page(para('Plain', 700))] });
    expect(xml).not.toContain('w:bookmarkStart');
    expect(xml).not.toContain('w:anchor=');
  });

  it('Markdown: an HTML anchor on the target and a (#…) link to it', () => {
    const md = flowDocToMarkdown(build());
    expect(md).toContain('See [Section Two](#_pdfturbo_link_1)');
    expect(md).toContain('<a id="_pdfturbo_link_1"></a>Section Two');
  });

  it('Markdown: a heading keeps its marker before the anchor', () => {
    const target = page(para('Methods', 600, { heading: 2 }));
    const src = page(linked('Methods', 'k'));
    resolveLinkAnchors([src, target], new Map([['k', { page: target }]]));
    expect(flowDocToMarkdown({ pages: [src, target] })).toContain('## <a id="_pdfturbo_link_1"></a>Methods');
  });

  it('text: the link text, nothing else', () => {
    const txt = flowDocToText(build());
    expect(txt).toContain('See Section Two');
    expect(txt).not.toContain('_pdfturbo');
  });
});

describe('resolveGoToDest — what pdf.js reports as a destination', () => {
  const ref2 = { num: 12, gen: 0 };
  const doc: DestDoc = {
    numPages: 3,
    getDestination: (id: string) => Promise.resolve(id === 'sec2' ? [ref2, { name: 'XYZ' }, 72, 640, 0] : null),
    getPageIndex: (ref: { num: number }) => (ref.num === 12 ? Promise.resolve(1) : Promise.reject(new Error('Invalid page reference.'))),
  };

  it('an explicit /XYZ array: the page and the view top', async () => {
    expect(await resolveGoToDest(doc, [ref2, { name: 'XYZ' }, 0, 500, null])).toEqual({ pageNum: 2, top: 500 });
  });
  it('a named destination is looked up', async () => {
    expect(await resolveGoToDest(doc, 'sec2')).toEqual({ pageNum: 2, top: 640 });
  });
  it('/FitH and /FitR carry their top; /Fit and a null /XYZ top carry none', async () => {
    expect(await resolveGoToDest(doc, [ref2, { name: 'FitH' }, 300])).toEqual({ pageNum: 2, top: 300 });
    expect(await resolveGoToDest(doc, [ref2, { name: 'FitR' }, 10, 20, 200, 410])).toEqual({ pageNum: 2, top: 410 });
    expect(await resolveGoToDest(doc, [ref2, { name: 'Fit' }])).toEqual({ pageNum: 2 });
    expect(await resolveGoToDest(doc, [ref2, { name: 'XYZ' }, null, null, null])).toEqual({ pageNum: 2 });
  });
  it('a page given as a 0-based index', async () => {
    expect(await resolveGoToDest(doc, [2, { name: 'Fit' }])).toEqual({ pageNum: 3 });
  });
  it('an unknown name, a dangling reference or an out-of-range index → null (the link is dropped, the text kept)', async () => {
    expect(await resolveGoToDest(doc, 'nope')).toBeNull();
    expect(await resolveGoToDest(doc, [{ num: 99, gen: 0 }, { name: 'Fit' }])).toBeNull();
    expect(await resolveGoToDest(doc, [7, { name: 'Fit' }])).toBeNull();
    expect(await resolveGoToDest(doc, [])).toBeNull();
  });
  it('a name lookup that REJECTS (a corrupt /Names /Dests tree) drops the link instead of failing the export', async () => {
    // Measured in pdf.js 6.3.289: a dangling, non-dictionary or bad-/Kids /Dests tree rejects getDestination.
    const corrupt: DestDoc = { ...doc, getDestination: () => Promise.reject(new Error("Cannot read properties of null (reading 'has')")) };
    expect(await resolveGoToDest(corrupt, 'sec2')).toBeNull();
  });
});
