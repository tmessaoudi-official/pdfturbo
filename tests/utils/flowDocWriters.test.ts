import { describe, it, expect } from 'vitest';
import { flowDocToMarkdown, flowDocToText, flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';
import type { FlowDoc, FlowParagraph, FlowRun } from '../../src/utils/flowDoc';

function run(text: string, opts: Partial<FlowRun> = {}): FlowRun {
  return { text, bold: false, italic: false, fontSize: 12, fontFamily: 'sans-serif', rtl: false, ...opts };
}
function para(runs: FlowRun[], opts: Partial<FlowParagraph> = {}): FlowParagraph {
  return { runs, heading: 0, alignment: 'left', rtl: false, ...opts };
}

const DOC: FlowDoc = {
  pages: [
    {
      width: 612,
      height: 792,
      paragraphs: [
        para([run('My Title')], { heading: 1, alignment: 'center' }),
        para([run('Plain then '), run('bold', { bold: true }), run(' then '), run('italic', { italic: true }), run('.')]),
      ],
    },
    {
      width: 612,
      height: 792,
      paragraphs: [para([run('Second page text.')])],
    },
  ],
};

describe('flowDocToMarkdown', () => {
  it('renders headings, bold and italic', () => {
    const md = flowDocToMarkdown(DOC);
    expect(md).toContain('# My Title');
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
  });

  it('separates paragraphs with blank lines and keeps page order', () => {
    const md = flowDocToMarkdown(DOC);
    const blocks = md.split('\n\n');
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(md.indexOf('My Title')).toBeLessThan(md.indexOf('Second page'));
  });

  it('returns an empty string for an empty document', () => {
    expect(flowDocToMarkdown({ pages: [] })).toBe('');
  });
});

describe('flowDocToText', () => {
  it('renders plain text without markup', () => {
    const txt = flowDocToText(DOC);
    expect(txt).toContain('My Title');
    expect(txt).toContain('Plain then bold then italic.');
    expect(txt).not.toContain('**');
    expect(txt).not.toContain('#');
  });
});

describe('flowDocToDocxBase64', () => {
  it('produces a valid ZIP container (PK magic) for a styled document', async () => {
    const b64 = await flowDocToDocxBase64(DOC);
    // 'UEsD' is base64 for the PK\x03\x04 zip local-file-header magic
    expect(b64.startsWith('UEsD')).toBe(true);
    expect(b64.length).toBeGreaterThan(1000);
  });

  // ── New: FlowRun.color accepted and produces valid DOCX ──────────────────────

  it('accepts FlowRun with color field and still produces a valid DOCX', async () => {
    const colorRun: FlowRun = run('Red text', { color: 'FF0000' });
    const noColorRun: FlowRun = run('Black text');
    const docWithColor: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        paragraphs: [para([colorRun, noColorRun])],
      }],
    };
    const b64 = await flowDocToDocxBase64(docWithColor);
    expect(b64.startsWith('UEsD')).toBe(true);
    expect(b64.length).toBeGreaterThan(1000);
  });

  it('FlowRun.color is an optional field on the FlowRun type', () => {
    // This is a compile-time check: assigning color to a FlowRun must not error.
    const r: FlowRun = {
      text: 'test', bold: false, italic: false,
      fontSize: 12, fontFamily: 'sans-serif', rtl: false,
    };
    r.color = 'FF0000';
    expect(r.color).toBe('FF0000');
  });
});

// ── New: list output ──────────────────────────────────────────────────────────

const BULLET_PARA: FlowParagraph = para([run('Apple pie')], { listType: 'bullet', listDepth: 0 });
const ORDERED_PARA: FlowParagraph = para([run('First step')], { listType: 'ordered', listDepth: 0 });
const LIST_DOC: FlowDoc = {
  pages: [{
    width: 612, height: 792,
    paragraphs: [BULLET_PARA, ORDERED_PARA, para([run('Plain paragraph.')])],
  }],
};

describe('flowDocToMarkdown — lists', () => {
  it('renders bullet list items with - prefix', () => {
    const md = flowDocToMarkdown(LIST_DOC);
    expect(md).toContain('- Apple pie');
  });

  it('renders ordered list items with 1. prefix', () => {
    const md = flowDocToMarkdown(LIST_DOC);
    expect(md).toContain('1. First step');
  });

  it('does not apply heading markup to list items', () => {
    const md = flowDocToMarkdown(LIST_DOC);
    expect(md).not.toMatch(/^#/m);
  });
});

describe('flowDocToText — lists', () => {
  it('renders bullet list items with • prefix', () => {
    const txt = flowDocToText(LIST_DOC);
    expect(txt).toContain('• Apple pie');
  });

  it('renders ordered list items with 1. prefix', () => {
    const txt = flowDocToText(LIST_DOC);
    expect(txt).toContain('1. First step');
  });
});

describe('flowDocToDocxBase64 — lists', () => {
  it('produces a valid DOCX for a document with bullet and ordered paragraphs', async () => {
    const b64 = await flowDocToDocxBase64(LIST_DOC);
    expect(b64.startsWith('UEsD')).toBe(true);
    expect(b64.length).toBeGreaterThan(1000);
  });
});

// ── Native DOCX ordered-list numbering (Phase 3) ──────────────────────────────

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

// ── Phase 4: image embedding ──────────────────────────────────────────────────

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('flowDocToDocxBase64 — image embedding', () => {
  it('page with FlowImage produces a w:drawing element in document.xml', async () => {
    const docWithImage: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        paragraphs: [para([run('Before image')])],
        images: [{ x: 100, y: 400, width: 200, height: 150, base64: TINY_PNG_B64, mimeType: 'image/png' }],
      }],
    };
    const b64 = await flowDocToDocxBase64(docWithImage);
    const files = await unpackDocx(b64);
    expect(files['word/document.xml']).toContain('w:drawing');
  });

  it('page without images does not produce a w:drawing element', async () => {
    const b64 = await flowDocToDocxBase64(DOC);
    const files = await unpackDocx(b64);
    expect(files['word/document.xml']).not.toContain('w:drawing');
  });

  it('DOCX with image still produces a valid ZIP container', async () => {
    const docWithImage: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        paragraphs: [],
        images: [{ x: 0, y: 0, width: 100, height: 100, base64: TINY_PNG_B64, mimeType: 'image/jpeg' }],
      }],
    };
    const b64 = await flowDocToDocxBase64(docWithImage);
    expect(b64.startsWith('UEsD')).toBe(true);
  });
});

describe('flowDocToDocxBase64 — native ordered-list numbering', () => {
  it('word/numbering.xml exists and contains an abstractNum definition', async () => {
    const doc: FlowDoc = {
      pages: [{ width: 612, height: 792, paragraphs: [para([run('First')], { listType: 'ordered', listDepth: 0 })] }],
    };
    const b64 = await flowDocToDocxBase64(doc);
    const files = await unpackDocx(b64);
    expect(files['word/numbering.xml']).toBeDefined();
    expect(files['word/numbering.xml']).toContain('w:abstractNum');
  });

  it('ordered paragraph uses native w:numPr instead of "1. " text prefix', async () => {
    const doc: FlowDoc = {
      pages: [{ width: 612, height: 792, paragraphs: [para([run('Item text')], { listType: 'ordered', listDepth: 0 })] }],
    };
    const b64 = await flowDocToDocxBase64(doc);
    const files = await unpackDocx(b64);
    const docXml = files['word/document.xml'];
    expect(docXml).toContain('w:numPr');
    expect(docXml).not.toContain('>1. <');
  });

  // Gap 4 (Sprint 3): lettered ordered markers map to the matching docx
  // LevelFormat in numbering.xml (not collapsed to decimal).
  it('a lowerLetter ordered list emits w:numFmt val="lowerLetter" in numbering.xml', async () => {
    const doc: FlowDoc = {
      pages: [{ width: 612, height: 792, paragraphs: [
        para([run('sub-item')], { listType: 'ordered', listDepth: 0, listFormat: 'lowerLetter', listOrdinalText: '%1)' }),
      ] }],
    };
    const files = await unpackDocx(await flowDocToDocxBase64(doc));
    expect(files['word/numbering.xml']).toContain('lowerLetter');
  });

  it('decimal and lowerLetter lists in one doc use distinct numbering references', async () => {
    const doc: FlowDoc = {
      pages: [{ width: 612, height: 792, paragraphs: [
        para([run('One')], { listType: 'ordered', listDepth: 0, listFormat: 'decimal', listOrdinalText: '%1.' }),
        para([run('Body')]),
        para([run('aye')], { listType: 'ordered', listDepth: 0, listFormat: 'lowerLetter', listOrdinalText: '%1)' }),
      ] }],
    };
    const files = await unpackDocx(await flowDocToDocxBase64(doc));
    const numbering = files['word/numbering.xml'];
    expect(numbering).toContain('decimal');
    expect(numbering).toContain('lowerLetter');
  });

  it('two ordered lists separated by plain text get distinct numId values (restart)', async () => {
    const doc: FlowDoc = {
      pages: [{
        width: 612, height: 792,
        paragraphs: [
          para([run('Alpha')], { listType: 'ordered', listDepth: 0 }),
          para([run('Beta')], { listType: 'ordered', listDepth: 0 }),
          para([run('Separator')]),
          para([run('Gamma')], { listType: 'ordered', listDepth: 0 }),
        ],
      }],
    };
    const b64 = await flowDocToDocxBase64(doc);
    const files = await unpackDocx(b64);
    const docXml = files['word/document.xml'];
    const numIds = [...docXml.matchAll(/w:numId w:val="(\d+)"/g)].map(m => m[1]);
    expect(new Set(numIds).size).toBeGreaterThanOrEqual(2);
  });
});
