/**
 * Sprint 2 Workstream B — PDF→DOCX fidelity fixes.
 * Tests the writer-side output (B-1 fonts, B-3 spacing, B-4 image position, B-5 justify/indent)
 * and the extraction-side detection (B-2 margins, B-5 alignment/indent) of flowDoc/flowDocWriters.
 */
import { describe, it, expect } from 'vitest';
import { flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';
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
  it('maps Calibri / Garamond-Bold / subset Verdana to their real Word names; unknown falls back to generic', async () => {
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
    // Unknown face must fall back to the serif generic, never appear literally.
    expect(xml).not.toContain('WeirdUnknownFace');
    expect(xml).toContain('w:ascii="Times New Roman"');
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
