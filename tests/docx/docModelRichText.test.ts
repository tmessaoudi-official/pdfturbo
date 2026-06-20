/**
 * Phase 2 Slice A: rich-text model props (underline / font / size on runs;
 * heading / list on paragraphs). jsdom. Fixtures built with the `docx` writer so
 * we parse REAL OOXML; round-trips go through applyParagraphRuns (in place).
 */
import { describe, it, expect } from 'vitest';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from 'docx';
import {
  parseDocModel,
  applyParagraphRuns,
  type DocParagraph,
} from '../../src/docx/docModel';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';

async function xmlOf(doc: Document): Promise<string> {
  return getDocumentXml(openOpc(new Uint8Array(await Packer.toBuffer(doc))));
}

describe('docModel — run-level underline / font / size (Task 1)', () => {
  it('reads w:u → underline, w:rFonts → fontFamily, w:sz(half-pt) → fontSize(pt)', async () => {
    const xml = await xmlOf(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: 'styled', underline: {}, font: 'Arial', size: 28 }),
                ],
              }),
            ],
          },
        ],
      }),
    );
    const run = parseDocModel(xml).paragraphs[0].runs[0];
    expect(run).toMatchObject({ text: 'styled', underline: true, fontFamily: 'Arial', fontSize: 14 });
  });

  it('round-trips underline/font/size through applyParagraphRuns', async () => {
    const xml = await xmlOf(
      new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('orig')] })] }] }),
    );
    const out = applyParagraphRuns(xml, [
      { runs: [{ text: 'edited', underline: true, fontFamily: 'Georgia', fontSize: 18 }] },
    ]);
    expect(out).toContain('<w:u');
    expect(out).toContain('w:ascii="Georgia"');
    expect(out).toContain('w:val="36"'); // 18pt → 36 half-points
    const run = parseDocModel(out).paragraphs[0].runs[0];
    expect(run).toMatchObject({ text: 'edited', underline: true, fontFamily: 'Georgia', fontSize: 18 });
  });

  it('emits w:rPr children in CT_RPr schema order (rFonts < b < i < sz < u)', async () => {
    const xml = await xmlOf(
      new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('x')] })] }] }),
    );
    const out = applyParagraphRuns(xml, [
      { runs: [{ text: 'x', bold: true, italic: true, underline: true, fontFamily: 'Arial', fontSize: 12 }] },
    ]);
    const iFonts = out.indexOf('<w:rFonts');
    const iB = out.indexOf('<w:b ') >= 0 ? out.indexOf('<w:b ') : out.indexOf('<w:b/');
    const iI = out.indexOf('<w:i ') >= 0 ? out.indexOf('<w:i ') : out.indexOf('<w:i/');
    const iSz = out.indexOf('<w:sz ') >= 0 ? out.indexOf('<w:sz ') : out.indexOf('<w:sz/');
    const iU = out.indexOf('<w:u');
    expect(iFonts).toBeGreaterThanOrEqual(0);
    expect(iFonts).toBeLessThan(iB);
    expect(iB).toBeLessThan(iI);
    expect(iI).toBeLessThan(iSz);
    expect(iSz).toBeLessThan(iU); // underline (27) follows sz (24) per CT_RPr
  });

  it('preserves an unmodeled rPr child (w:color) when restyling', async () => {
    const xml = await xmlOf(
      new Document({
        sections: [{ children: [new Paragraph({ children: [new TextRun({ text: 'c', color: 'FF0000' })] })] }],
      }),
    );
    const out = applyParagraphRuns(xml, [{ runs: [{ text: 'c', bold: true }] }]);
    expect(out).toContain('w:val="FF0000"'); // color cloned from base rPr survives
  });
});

describe('docModel — paragraph-level heading / list (Task 2)', () => {
  it('reads w:pStyle Heading2 → heading:2', async () => {
    const xml = await xmlOf(
      new Document({
        sections: [{ children: [new Paragraph({ text: 'Title', heading: HeadingLevel.HEADING_2 })] }],
      }),
    );
    expect(parseDocModel(xml).paragraphs[0].heading).toBe(2);
  });

  it('writes heading via pStyle and round-trips (ids provided)', async () => {
    const xml = await xmlOf(
      new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('h')] })] }] }),
    );
    const ids = { heading: { 1: 'Heading1', 2: 'Heading2', 3: 'Heading3' }, bulletNumId: 100, orderedNumId: 101 };
    const para: DocParagraph = { runs: [{ text: 'h' }], heading: 3 };
    const out = applyParagraphRuns(xml, [para], ids);
    expect(out).toContain('w:val="Heading3"');
    expect(parseDocModel(out).paragraphs[0].heading).toBe(3);
  });

  it('writes a list via numPr (ids provided) and resolves ordered via numbering map', async () => {
    const xml = await xmlOf(
      new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('item')] })] }] }),
    );
    const ids = { heading: { 1: 'Heading1', 2: 'Heading2', 3: 'Heading3' }, bulletNumId: 100, orderedNumId: 101 };
    const out = applyParagraphRuns(xml, [{ runs: [{ text: 'item' }], list: { ordered: true, level: 0 } }], ids);
    expect(out).toContain('<w:numPr');
    expect(out).toContain('w:val="101"'); // the ordered numId
    const numberingMap = new Map<number, 'bullet' | 'decimal' | 'other'>([[101, 'decimal']]);
    const para = parseDocModel(out, numberingMap).paragraphs[0];
    expect(para.list).toMatchObject({ ordered: true, level: 0 });
  });

  it('without ids, paragraph-level props are ignored (byte-identical body to no-prop call)', async () => {
    const xml = await xmlOf(
      new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('p')] })] }] }),
    );
    const withProps = applyParagraphRuns(xml, [{ runs: [{ text: 'p' }], heading: 1, list: { ordered: false, level: 0 } }]);
    const without = applyParagraphRuns(xml, [{ runs: [{ text: 'p' }] }]);
    expect(withProps).toBe(without);
  });
});
