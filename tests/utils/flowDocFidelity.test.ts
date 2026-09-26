/**
 * Sprint 2 Workstream B — PDF→DOCX fidelity fixes.
 * Tests the writer-side output (B-1 fonts, B-3 spacing, B-4 image position, B-5 justify/indent)
 * and the extraction-side detection (B-2 margins, B-5 alignment/indent) of flowDoc/flowDocWriters.
 */
import { describe, it, expect } from 'vitest';
import { flowDocToDocxBase64, wordFontFor, wordFamilyHint } from '../../src/utils/flowDocWriters';
import type { FlowDoc, FlowParagraph, FlowRun } from '../../src/utils/flowDoc';

function run(text: string, opts: Partial<FlowRun> = {}): FlowRun {
  return { text, bold: false, italic: false, fontSize: 12, fontFamily: 'sans-serif', rtl: false, ...opts };
}
function para(runs: FlowRun[], opts: Partial<FlowParagraph> = {}): FlowParagraph {
  return { runs, heading: 0, alignment: 'left', rtl: false, ...opts };
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

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ── B-1: broaden font family allow-list ────────────────────────────────────────

describe('B-1 — font allow-list (psName → real Word font)', () => {
  it('maps Calibri / Garamond-Bold / subset Verdana to their real Word names; an unknown REAL name passes through (row 18)', async () => {
    const doc: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        paragraphs: [para([
          run('Calibri text', { psName: 'Calibri', fontFamily: 'sans-serif' }),
          run('Garamond text', { psName: 'Garamond-Bold', fontFamily: 'serif', bold: true }),
          run('Verdana text', { psName: 'ABCDEF+Verdana', fontFamily: 'sans-serif' }),
          run('Unknown text', { psName: 'WeirdUnknownFace', fontFamily: 'serif' }),
        ])],
      }],
    };
    const files = await unpackDocx(await flowDocToDocxBase64(doc));
    const xml = files['word/document.xml'];
    expect(xml).toContain('w:ascii="Calibri"');
    expect(xml).toContain('w:ascii="Garamond"');
    expect(xml).toContain('w:ascii="Verdana"');
    // Row 18 (D6): a real family the allowlist does not know is kept — split at its word boundaries — rather than
    // flattened to the generic (it read "must fall back to the serif generic" until the D6 ruling).
    expect(xml).toContain('w:ascii="Weird Unknown Face"');
    expect(xml).not.toContain('w:ascii="Times New Roman"');
  });

  it('strips style suffixes like -BoldMT and ,Bold from the carried name', async () => {
    const doc: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        paragraphs: [para([
          run('A', { psName: 'Georgia-BoldItalic', fontFamily: 'serif' }),
          run('B', { psName: 'Tahoma,Bold', fontFamily: 'sans-serif' }),
        ])],
      }],
    };
    const xml = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/document.xml'];
    expect(xml).toContain('w:ascii="Georgia"');
    expect(xml).toContain('w:ascii="Tahoma"');
  });

  it('Helvetica → Arial, Times → Times New Roman, Courier → Courier New', async () => {
    const doc: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        paragraphs: [para([
          run('h', { psName: 'Helvetica', fontFamily: 'sans-serif' }),
          run('t', { psName: 'Times-Roman', fontFamily: 'serif' }),
          run('c', { psName: 'Courier', fontFamily: 'monospace' }),
        ])],
      }],
    };
    const xml = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/document.xml'];
    expect(xml).toContain('w:ascii="Arial"');
    expect(xml).toContain('w:ascii="Times New Roman"');
    expect(xml).toContain('w:ascii="Courier New"');
  });
});

// ── Row 18 (D6 + D7): real font names, measured against a 104-file corpus ─────────────────────────────

describe('row 18 — wordFontFor: allowlist, pass-through, and generated names', () => {
  // Every psName below is one pdf.js reported (or pdf-lib read as /BaseFont) in var/corpus + var/corpus-wide.
  it.each([
    ['TimesNewRomanPSMT', 'serif', 'Times New Roman'],          // spaceless: missed the 'times new roman' key before
    ['RBNGDK+TimesNewRomanPS-BoldMT', 'serif', 'Times New Roman'],
    ['WHERZU+HelveticaLTStd-Blk', 'sans-serif', 'Arial'],       // vendor suffix LTStd
    ['EXDRKK+ITCFranklinGothicStd-Demi', 'sans-serif', 'Franklin Gothic'], // ITC prefix + Std
    ['YOGHEW+TimesLTStd-Roman', 'serif', 'Times New Roman'],
    ['FYYHYI+HelveticaNeueLTStd-Bd', 'sans-serif', 'Arial'],    // clone list
    ['XORMUP+NimbusRomNo9L-Medi', 'serif', 'Times New Roman'],
    ['JQUDPS+NimbusMonL-Regu', 'monospace', 'Courier New'],
    ['QBHSCI+NewCenturySchlbkLTStd-Roman', 'serif', 'Century Schoolbook'],
  ] as const)('%s → allowlist %s', (ps, fam, want) => {
    expect(wordFontFor(ps, fam)).toEqual({ name: want, passThrough: false });
  });

  it.each([
    ['MMWSMN+MyriadPro-Regular', 'sans-serif', 'Myriad Pro'],
    ['CVYTLL+DejaVuSans', 'sans-serif', 'DejaVu Sans'],
    ['MUFUZY+RobotoMono-Regular', 'monospace', 'Roboto Mono'],
    ['AAAACL+CambriaMath', 'serif', 'Cambria Math'],
    ['CVMOMI+NotoSansCJKjp-Regular', 'sans-serif', 'Noto Sans CJK JP'], // D7's real case: 12 corpus files
    ['XIORHK+CMUSerif-Roman', 'serif', 'CMU Serif'],
  ] as const)('%s → passes through as %s', (ps, fam, want) => {
    expect(wordFontFor(ps, fam)).toEqual({ name: want, passThrough: true });
  });

  it.each([
    ['KGMNOB+TT93o00', 'serif'],        // Acrobat's generated TrueType names
    ['LICAEO+CMMI10', 'serif'],         // TeX-internal: no Word install has Computer Modern
    ['XEXHSJ+SFTT1000', 'monospace'],
    ['Cmb10', 'serif'],
    ['QDTWCG+MSBM10', 'serif'],
    ['g_d0_f3', 'sans-serif'],          // pdf.js's internal id, reached when the operator list failed
    ['247 0 R', 'serif'],               // a broken /BaseFont
    ['F1', 'sans-serif'],
    ['', 'serif'],
  ] as const)('%s → generated, falls back to the %s generic', (ps, fam) => {
    const generic = { serif: 'Times New Roman', 'sans-serif': 'Arial', monospace: 'Courier New' }[fam];
    expect(wordFontFor(ps, fam)).toEqual({ name: generic, passThrough: false });
  });
});

describe('row 18 — the DOCX carries the real name, a fallback hint, and the East Asian slot (D7)', () => {
  const doc: FlowDoc = {
    pages: [{
      width: 612, height: 792,
      paragraphs: [para([
        run('Myriad', { psName: 'MMWSMN+MyriadPro-Regular', fontFamily: 'sans-serif' }),
        run('日本語のテキスト', { psName: 'CVMOMI+NotoSansCJKjp-Regular', fontFamily: 'sans-serif' }),
        run('Mono', { psName: 'MUFUZY+RobotoMono-Regular', fontFamily: 'monospace' }),
        run('Serif', { psName: 'AAAACL+CambriaMath', fontFamily: 'serif' }),
        run('Arial', { psName: 'ArialMT', fontFamily: 'sans-serif' }),
      ])],
    }],
  };

  it('writes the passed-through name in every rFonts slot, eastAsia included', async () => {
    const xml = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/document.xml'];
    expect(xml).toContain('<w:rFonts w:ascii="Noto Sans CJK JP" w:cs="Noto Sans CJK JP" w:eastAsia="Noto Sans CJK JP" w:hAnsi="Noto Sans CJK JP"/>');
    expect(xml).toContain('w:eastAsia="Myriad Pro"');
  });

  it('lists each passed-through name in fontTable.xml with a family and pitch Word can substitute by', async () => {
    const table = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/fontTable.xml'];
    expect(table).toContain('<w:font w:name="Myriad Pro"><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>');
    expect(table).toContain('<w:font w:name="Roboto Mono"><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font>');
    expect(table).toContain('<w:font w:name="Cambria Math"><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font>');
    // Word's own faces need no hint.
    expect(table).not.toContain('w:name="Arial"');
  });

  it("lets a name that states its class override pdf.js's guess (a CJK serif face flagged FixedPitch)", async () => {
    // pdf.js reports `monospace` for NotoSerifCJKjp-Regular (measured on tests/fixtures/vertical, 2026-09-27).
    const cjk: FlowDoc = { pages: [{ width: 612, height: 792, paragraphs: [para([
      run('本文', { psName: 'BAAAAA+NotoSerifCJKjp-Regular', fontFamily: 'monospace' }),
    ])] }] };
    const table = (await unpackDocx(await flowDocToDocxBase64(cjk)))['word/fontTable.xml'];
    expect(table).toContain('<w:font w:name="Noto Serif CJK JP"><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font>');
  });

  it.each([
    ['Noto Sans Mono', 'monospace'], ['Courier Prime', 'monospace'], ['Source Code Pro', 'monospace'],
    ['Noto Sans CJK JP', 'sans-serif'], ['MS Gothic', 'sans-serif'], ['Microsoft Sans Serif', 'sans-serif'],
    ['Noto Serif CJK JP', 'serif'], ['Aokin Mincho', 'serif'], ['DejaVu Serif', 'serif'],
    ['Myriad Pro', null], ['Cambria Math', null], ['Wingdings2', null],
    // A word boundary is part of the rule: 'Unicode' ends in 'code' and 'Monotype' starts with 'mono' (row-18 6C).
    ['Lucida Sans Unicode', 'sans-serif'], ['Arial Unicode MS', 'sans-serif'], ['Monotype Corsiva', null], ['Fira Code', 'monospace'],
  ] as const)('wordFamilyHint(%s) → %s', (name, want) => {
    expect(wordFamilyHint(name)).toBe(want);
  });

  it('writes an empty font table, as before, when nothing passes through', async () => {
    const plain: FlowDoc = { pages: [{ width: 612, height: 792, paragraphs: [para([run('x', { psName: 'ArialMT' })])] }] };
    const table = (await unpackDocx(await flowDocToDocxBase64(plain)))['word/fontTable.xml'];
    expect(table).not.toContain('<w:font ');
  });
});

// ── B-2: page margins from text bbox (writer emits margins from FlowPage.margins) ─

describe('B-2 — page margins emitted in section properties', () => {
  it('emits w:pgMar with margins matching the page.margins (twips) when provided', async () => {
    const doc: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        // 72pt inset on all sides = 1440 twips
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        paragraphs: [para([run('Body')])],
      }],
    };
    const xml = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/document.xml'];
    expect(xml).toContain('w:top="1440"');
    expect(xml).toContain('w:left="1440"');
    expect(xml).toContain('w:right="1440"');
    expect(xml).toContain('w:bottom="1440"');
  });
});

// ── B-3: paragraph + line spacing ──────────────────────────────────────────────

describe('B-3 — paragraph/line spacing emitted', () => {
  it('emits w:spacing with line/before/after when paragraph carries spacing hints', async () => {
    const doc: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        paragraphs: [
          para([run('First')], { spaceBefore: 6, spaceAfter: 6, lineHeight: 14 }),
        ],
      }],
    };
    const xml = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/document.xml'];
    expect(xml).toContain('w:spacing');
    // 6pt → 120 twips before/after; 14pt line at exact rule → 280 twips
    expect(xml).toMatch(/w:before="120"/);
    expect(xml).toMatch(/w:after="120"/);
    expect(xml).toMatch(/w:line="280"/);
  });
});

// ── B-4: image x/y positioning ─────────────────────────────────────────────────

describe('B-4 — images placed by x/y via floating anchor (not centered-trailing)', () => {
  it('image with x/y produces a floating wp:anchor with posOffset, not a centered paragraph', async () => {
    const doc: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        paragraphs: [para([run('Some text')])],
        images: [{ x: 100, y: 400, width: 200, height: 150, base64: TINY_PNG_B64, mimeType: 'image/png' }],
      }],
    };
    const xml = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/document.xml'];
    expect(xml).toContain('wp:anchor');
    expect(xml).toContain('wp:posOffset');
    // x=100pt → 100*12700 = 1270000 EMU horizontally
    expect(xml).toContain('<wp:posOffset>1270000</wp:posOffset>');
    // y flip: pageHeight(792) - y(400) - height(150) = 242pt → 242*12700 = 3073400 EMU
    expect(xml).toContain('<wp:posOffset>3073400</wp:posOffset>');
  });

  it('image still lands in word/media/ (ISSUE-3/4 guard)', async () => {
    const doc: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        paragraphs: [],
        images: [{ x: 0, y: 0, width: 100, height: 100, base64: TINY_PNG_B64, mimeType: 'image/png' }],
      }],
    };
    const files = await unpackDocx(await flowDocToDocxBase64(doc));
    const mediaFiles = Object.keys(files).filter(p => p.startsWith('word/media/'));
    expect(mediaFiles.length).toBeGreaterThanOrEqual(1);
  });
});

// ── B-5: justify + indentation ─────────────────────────────────────────────────

describe('B-5 — justify alignment and indentation', () => {
  it('alignment "justify" maps to w:jc w:val="both"', async () => {
    const doc: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        paragraphs: [para([run('Justified text')], { alignment: 'justify' })],
      }],
    };
    const xml = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/document.xml'];
    expect(xml).toContain('w:val="both"');
  });

  it('paragraph indent (left + firstLine) emits w:ind attributes', async () => {
    const doc: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        // 36pt left indent = 720 twips, 18pt firstLine = 360 twips
        paragraphs: [para([run('Indented')], { indentLeft: 36, indentFirstLine: 18 })],
      }],
    };
    const xml = (await unpackDocx(await flowDocToDocxBase64(doc)))['word/document.xml'];
    expect(xml).toContain('w:ind');
    expect(xml).toContain('w:left="720"');
    expect(xml).toContain('w:firstLine="360"');
  });
});
