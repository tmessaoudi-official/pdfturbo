/**
 * `scanNamedOps(…, { pdfjs: true })` (review-remediation row 10, S10-1): the operator table it splits words and judges
 * an `EI` by, re-derived from the installed pdf.js, and the cases the pdf.js oracle in
 * `tests/export/inlineImagePdfjs.test.ts` cannot drive — pdf.js loops for ever on one of them, and the rest are shapes
 * this mode refuses because it cannot follow them (a reference it cannot resolve, a byte pdf.js lexes twice).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFJS_OPERATORS, scanNamedOps } from '../../src/utils/contentStreamEditor';

const pdfjs = (src: string, wanted: string[] = ['Do']) => scanNamedOps(src, new Set(wanted), { pdfjs: true });
const plain = (src: string, wanted: string[] = ['Do']) => scanNamedOps(src, new Set(wanted));
const IMG = 'BI /W 1 /H 1 /BPC 8 /CS /G';

describe('the pdf.js operator table (row 10, S10-1)', () => {
  it('equals EvaluatorPreprocessor.opMap in the installed pdf.worker.mjs', () => {
    const worker = readFileSync('node_modules/pdfjs-dist/build/pdf.worker.mjs', 'utf8');
    const start = worker.indexOf('static get opMap()');
    const block = worker.slice(start, worker.indexOf('}));', start));
    const derived = new Map<string, readonly [number, boolean] | null>();
    const key = String.raw`("[^"]+"|'[^']+'|[A-Za-z0-9*]+)`;
    for (const m of block.matchAll(new RegExp(`${key}: \\{\\s*id: OPS\\.\\w+,\\s*numArgs: (\\d+),\\s*variableArgs: (true|false)\\s*\\}`, 'g'))) {
      derived.set(m[1].replace(/^["']|["']$/g, ''), [Number(m[2]), m[3] === 'true']);
    }
    for (const m of block.matchAll(new RegExp(`${key}: null`, 'g'))) derived.set(m[1].replace(/^["']|["']$/g, ''), null);
    expect(derived.size).toBe(83);
    expect(Object.fromEntries(PDFJS_OPERATORS)).toEqual(Object.fromEntries(derived));
  });

  // `BI` opens an inline image instead (the oracle file's `qBI` case).
  it.each([...PDFJS_OPERATORS.keys()].filter(k => PDFJS_OPERATORS.get(k) !== null && k !== 'BI'))(
    'pdf.js reads %s run into letters as itself, then the letters', op => {
      // Past five bytes the split is not short-cut, so this walks the prefixes pdf.js walks.
      expect(pdfjs(`/A ${op}xxxxx`, [op])).toEqual([{ operator: op, operands: 1, first: '/A', last: '/A' }]);
    });
});

describe('scanNamedOps reads a word the way pdf.js does (row 10, S10-1)', () => {
  it('a control byte before a printable one is an operator of its own', () => {
    expect(pdfjs('\x01Do')).toEqual([{ operator: 'Do', operands: 0, first: undefined, last: undefined }]);
    expect(plain('\x01Do')).toEqual([]);
  });
  it('a control byte before another stays in the word', () => {
    expect(pdfjs('\x01\x02Do')).toEqual([]);
  });
  it('a known operator ends where the next letter would make it unknown', () => {
    expect(pdfjs('/Fm1 Do\x01')).toEqual([{ operator: 'Do', operands: 1, first: '/Fm1', last: '/Fm1' }]);
    expect(plain('/Fm1 Do\x01')).toEqual([]);
  });
  it('an operator past 128 bytes stops pdf.js, so the scan throws', () => {
    expect(() => pdfjs(`${'a'.repeat(129)} /Fm1 Do`)).toThrow(/past 128 bytes/);
    expect(pdfjs(`${'a'.repeat(128)} /Fm1 Do`)).toHaveLength(1);
    expect(plain(`${'a'.repeat(129)} /Fm1 Do`)).toHaveLength(1);
  });
});

describe('scanNamedOps refuses an inline image it cannot follow (row 10, S10-1)', () => {
  it.each([
    ['a filter given by reference', `${IMG} /F 1 0 R ID x EI /Fm1 Do`, /by reference/],
    ['a byte after ID that is not whitespace (pdf.js lexes it again after the data)', `${IMG} IDx EI /Fm1 Do`, /after whitespace/],
    ['ID as a value', `BI /W ID x EI /Fm1 Do`, /ID as a value/],
    ['ID inside an array value', `BI /D [1 ID x EI /Fm1 Do`, /ID as a value/],
    // pdf.js steps back onto a marker that has no length bytes left and reads it again, for ever (read, not run).
    ['a DCT marker at the very end', `${IMG} /F /DCT ID \xFF\xC0`, /never ends/],
  ])('%s', (_label, src, message) => {
    expect(() => pdfjs(src)).toThrow(message);
  });

  it('a dictionary cut off by the end of the stream draws nothing after it', () => {
    expect(pdfjs('/Fm1 Do BI /W')).toEqual([{ operator: 'Do', operands: 1, first: '/Fm1', last: '/Fm1' }]);
    expect(pdfjs('/Fm1 Do BI /W 1 ID')).toEqual([{ operator: 'Do', operands: 1, first: '/Fm1', last: '/Fm1' }]);
  });

  it('a DCT marker with one length byte left ends at the stream end', () => {
    expect(pdfjs(`${IMG} /F /DCT ID \xFF\xC0\x01`)).toEqual([]);
  });

  it('`1.0 0 R` is a reference to pdf.js, so a filter written that way refuses too', () => {
    expect(() => pdfjs(`${IMG} /F 1.0 0 R ID x EI /Fm1 Do`)).toThrow(/by reference/);
  });

  it('a name escape decodes before the filter is matched', () => {
    // `/DC#54` is `/DCT`: the EI inside the JPEG data is data.
    // The padding puts the end marker past the 15 bytes the unfiltered rule checks, which would refuse the EI anyway.
    expect(pdfjs(`${IMG} /F /DC#54 ID \xFF\xD8 EI /Fm2 Do ${'0 '.repeat(10)}\xFF\xD9 EI /Fm1 Do`)).toEqual(
      [{ operator: 'Do', operands: 1, first: '/Fm1', last: '/Fm1' }]);
  });
});
