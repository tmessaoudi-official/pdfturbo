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
