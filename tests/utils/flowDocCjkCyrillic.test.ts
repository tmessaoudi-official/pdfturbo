/**
 * #2 (2026-06-17) — PDF→DOCX/MD/TXT export must preserve non-Latin, non-Arabic
 * LTR scripts (Cyrillic, CJK) verbatim. These scripts are LTR like Latin, so they
 * take the same reconstruction + writer path; the only script-specific branch in
 * the pipeline is isArabicText (the RTL reorder), which must NOT fire for them.
 *
 * Content preservation is the contract verified here. CJK FONT-FACE selection (a
 * w:eastAsia font) is a documented ceiling: there is no universal CJK font name
 * (SimSun / MS Gothic / Malgun Gothic are locale-specific and risk Han-unification
 * mis-rendering if forced), and Word's font fallback renders the preserved
 * codepoints correctly. We keep the Latin ascii font name and rely on Word's
 * substitution — the text content is intact, which is the user-facing requirement.
 */
import { describe, it, expect } from 'vitest';
import { flowDocToDocxBase64, flowDocToMarkdown, flowDocToText } from '../../src/utils/flowDocWriters';
import {
  reconstructPage,
  type FlowDoc,
  type FlowParagraph,
  type FlowRun,
  type RawTextItem,
  type FontInfoMap,
} from '../../src/utils/flowDoc';

const CYRILLIC = 'Привет мир'; // "Hello world" (Russian)
const JAPANESE = '日本語のテキスト'; // "Japanese text"
const CHINESE = '中文文本'; // "Chinese text"
const KOREAN = '한국어 문서'; // "Korean document"

function run(text: string, opts: Partial<FlowRun> = {}): FlowRun {
  return { text, bold: false, italic: false, fontSize: 12, fontFamily: 'sans-serif', rtl: false, ...opts };
}
function para(runs: FlowRun[], opts: Partial<FlowParagraph> = {}): FlowParagraph {
  return { runs, heading: 0, alignment: 'left', rtl: false, ...opts };
}
function docOf(...texts: string[]): FlowDoc {
  return { pages: [{ width: 612, height: 792, paragraphs: texts.map((t) => para([run(t)])) }] };
}

async function unpackDocx(b64: string): Promise<Record<string, string>> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  const files = unzipSync(bytes);
  const result: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) {
    result[path] = strFromU8(data as Uint8Array);
  }
  return result;
}

describe('#2 — DOCX export preserves Cyrillic + CJK content verbatim', () => {
  it('Cyrillic survives into word/document.xml', async () => {
    const xml = (await unpackDocx(await flowDocToDocxBase64(docOf(CYRILLIC))))['word/document.xml'];
    expect(xml).toContain(CYRILLIC);
  });

  it('CJK (Japanese, Chinese, Korean) survives into word/document.xml', async () => {
    const xml = (await unpackDocx(await flowDocToDocxBase64(docOf(JAPANESE, CHINESE, KOREAN))))['word/document.xml'];
    expect(xml).toContain(JAPANESE);
    expect(xml).toContain(CHINESE);
    expect(xml).toContain(KOREAN);
  });
});

describe('#2 — Markdown + plain-text writers preserve Cyrillic + CJK', () => {
  const DOC = docOf(CYRILLIC, JAPANESE, CHINESE, KOREAN);
  it('Markdown keeps every script', () => {
    const md = flowDocToMarkdown(DOC);
    for (const s of [CYRILLIC, JAPANESE, CHINESE, KOREAN]) expect(md).toContain(s);
  });
  it('plain text keeps every script', () => {
    const txt = flowDocToText(DOC);
    for (const s of [CYRILLIC, JAPANESE, CHINESE, KOREAN]) expect(txt).toContain(s);
  });
});

describe('#2 — reconstructPage treats Cyrillic/CJK as LTR (no Arabic reorder)', () => {
  const FONTS: FontInfoMap = { f1: { name: 'Helvetica', family: 'sans-serif' } };
  function mkItem(str: string, x: number, y: number, width: number): RawTextItem {
    return { str, dir: 'ltr', transform: [12, 0, 0, 12, x, y], width, height: 12, fontName: 'f1', hasEOL: false };
  }
  it('preserves Cyrillic + CJK characters in logical order, not flagged RTL', () => {
    const page = reconstructPage([mkItem(CYRILLIC, 72, 700, 120), mkItem(JAPANESE, 72, 680, 120)], FONTS, 612, 792);
    const allText = page.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join(' ');
    expect(allText).toContain(CYRILLIC);
    expect(allText).toContain(JAPANESE);
    // RTL flag would trigger reverse + NFKC fold — must stay false for LTR scripts.
    expect(page.paragraphs.every((p) => !p.rtl)).toBe(true);
  });
});
