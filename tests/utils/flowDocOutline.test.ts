/**
 * B3 — PDF outline (/Outlines bookmarks) → Word Table of Contents.
 *
 * When the source PDF carries a document outline, the DOCX export emits a real
 * Word TOC FIELD (referencing the Heading1–6 paragraphs we already detect — so it
 * is non-duplicating, page-numbered and clickable after Word updates fields). The
 * TOC is emitted ONLY when an outline is present AND ≥1 heading was detected; with
 * no outline the export is byte-identical (no TOC). `flattenOutline` is the pure
 * tree→[{title,level}] flattener.
 */
import { describe, it, expect } from 'vitest';
import { flattenOutline, type FlowDoc } from '../../src/utils/flowDoc';
import { flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';

async function unpackDocx(b64: string): Promise<Record<string, string>> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(Buffer.from(b64, 'base64')));
  const out: Record<string, string> = {};
  for (const [p, d] of Object.entries(files)) out[p] = strFromU8(d as Uint8Array);
  return out;
}

const mkRun = (text: string, fontSize: number) => ({
  text, bold: false, italic: false, fontSize, fontFamily: 'serif' as const, rtl: false,
});
const heading = (text: string): FlowDoc['pages'][number]['paragraphs'][number] => ({
  runs: [mkRun(text, 24)], heading: 1, alignment: 'left', rtl: false,
});
const body = (text: string): FlowDoc['pages'][number]['paragraphs'][number] => ({
  runs: [mkRun(text, 12)], heading: 0, alignment: 'left', rtl: false,
});

describe('flattenOutline', () => {
  it('flattens a nested outline with 1-based levels', () => {
    const raw = [
      { title: 'Chapter 1', items: [{ title: '1.1 Intro', items: [] }, { title: '1.2 Body', items: [] }] },
      { title: 'Chapter 2', items: [] },
    ];
    expect(flattenOutline(raw)).toEqual([
      { title: 'Chapter 1', level: 1 },
      { title: '1.1 Intro', level: 2 },
      { title: '1.2 Body', level: 2 },
      { title: 'Chapter 2', level: 1 },
    ]);
  });

  it('skips empty/whitespace titles but keeps their children', () => {
    const raw = [{ title: '   ', items: [{ title: 'Kept', items: [] }] }];
    expect(flattenOutline(raw)).toEqual([{ title: 'Kept', level: 2 }]);
  });

  it('returns [] for an empty outline', () => {
    expect(flattenOutline([])).toEqual([]);
  });
});

describe('flowDocToDocxBase64 — TOC field (B3)', () => {
  it('emits a TOC field when outline present AND a heading exists', async () => {
    const doc: FlowDoc = {
      outline: [{ title: 'Chapter 1', level: 1 }],
      pages: [{ width: 612, height: 792, paragraphs: [heading('Chapter 1'), body('text')] }],
    };
    const xml = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/document.xml'];
    expect(xml).toContain('TOC');
  });

  it('emits NO TOC when there is no outline (byte-identical-when-inactive)', async () => {
    const doc: FlowDoc = {
      pages: [{ width: 612, height: 792, paragraphs: [heading('Chapter 1'), body('text')] }],
    };
    const xml = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/document.xml'];
    expect(xml).not.toContain('TOC');
  });

  it('emits NO TOC when outline present but no heading detected', async () => {
    const doc: FlowDoc = {
      outline: [{ title: 'Chapter 1', level: 1 }],
      pages: [{ width: 612, height: 792, paragraphs: [body('just body text')] }],
    };
    const xml = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/document.xml'];
    expect(xml).not.toContain('TOC');
  });
});
