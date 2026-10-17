/**
 * `scanNamedOps` (review-remediation row 10) must report exactly what `groupOps(tokenizeContentStream(src))` gives for
 * the operators it is asked about: the SEC-1 prune decides what a kept page DRAWS from it, so a name the scan counts
 * that the tokenizer would not (inside a string, a dictionary, an array) keeps a removed page's resource in the export,
 * and one it misses drops a resource the kept page draws. Compared on hand-written edge cases, seeded fuzz, and every
 * stream of the tracked fixture PDFs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { groupOps, scanNamedOps, tokenizeContentStream } from '../../src/utils/contentStreamEditor';

const WANTED: ReadonlySet<string> = new Set(['Do', 'Tf', 'gs', 'scn', 'SCN', 'sh', 'BDC', 'DP']);

type Outcome = { threw: string } | { ops: unknown[] };
const run = (f: () => unknown[]): Outcome => { try { return { ops: f() }; } catch (e) { return { threw: (e as Error).message }; } };

const reference = (src: string): Outcome => run(() => groupOps(tokenizeContentStream(src))
  .filter(op => WANTED.has(op.operator))
  .map(op => {
    const first = op.operands[0];
    const last = op.operands[op.operands.length - 1];
    return {
      operator: op.operator, operands: op.operands.length,
      first: first?.type === 'name' ? first.raw : undefined, last: last?.type === 'name' ? last.raw : undefined,
    };
  }));
const scanned = (src: string): Outcome => run(() => scanNamedOps(src, WANTED).map(o => ({ ...o })));

const EDGE: Record<string, string> = {
  'plain draws': 'q /Fm1 Do Q BT /F1 12 Tf ET /GS0 gs /P0 scn /P1 SCN /Sh0 sh',
  'a name inside a literal string': '(/Fm2 Do) Tj /Fm1 Do',
  'escaped parens in a string': '(a \\) /Fm2 Do \\( b) Tj (x(/Fm3)y) Tj /Fm1 Do',
  'a name in a comment': '% /Fm2 Do\r/Fm1 Do % >> ]\n/Fm4 Do',
  'hex strings': '<2F466D3220446F> Tj <ab /Fm2 Do',
  'marked content with a dictionary': '/Span <</ActualText <FEFF0009>>> BDC /OC /MC0 BDC EMC /Tag <</MCID 0 /K <</X /Fm2>> >> DP',
  'a dictionary with a comment and a string': '/T <</A (>>) % >> \n /B /Fm2>> BDC /Fm1 Do',
  'arrays': '[/Fm2 (/x) <2F> 1 -2.5 %c] /Fm1 Do [(a) /b] TJ /F1 [1 2] Tf',
  'a nested array opener': '[1 [2] /Fm1 Do',
  'numbers next to operators': '1.5Do /Fm1 1e-3 Do 2e Do +.5 - . Do 1E+2Tf',
  'operand counts': '/A /B /C BDC /A /B BDC /A BDC /P DP /P <</K 1>> DP',
  'escaped name characters': '/Fm#201 Do /F#31 12 Tf / Do',
  'inline image data': '/Fm1 BI /W 1 /H 1 ID xEIx /Fm2 Do EI /Fm3 Do',
  'an inline image clears the operands': '/Fm2 BI ID \x00 EI Do',
  'Tf reads its first operand': '/F1 12 Tf 12 /F2 Tf 12 Tf',
  'a long word ends the operands': '/Fm2 BDCX /Fm1 Do /X abcdefgh Do',
  'characters past latin-1': '/FmĀ Do ā /Fm1 Do',
  'a NUL is whitespace': '/Fm1\0Do',
  'a stray close paren': '/Fm1 Do ) /Fm2 Do',
  'a stray close bracket': '/Fm1 Do ] Tj',
  'a stray brace': '{ /Fm1 Do }',
  'a stray greater-than': '/Fm1 > Do',
  'an unterminated string': '/Fm1 Do (abc /Fm2 Do',
  'an unterminated dictionary': '/T << /A 1 /Fm2 Do',
  'an unterminated array': '/T [ /Fm2 Do',
  'empty': '',
};

describe('scanNamedOps reports what the full tokenizer gives (row 10)', () => {
  it.each(Object.entries(EDGE))('%s', (_label, src) => {
    expect(scanned(src)).toEqual(reference(src));
  });

  // Singly, so a scan and a tokenizer wrong in the same way still fail here.
  it('a name in a string, a comment or an array is not drawn; the Do operand is', () => {
    expect(scanned('(/Fm2 Do) Tj % /Fm3 Do\n[/Fm4] Tj /Fm1 Do')).toEqual({ ops: [{ operator: 'Do', operands: 1, first: '/Fm1', last: '/Fm1' }] });
  });
  it('BDC with a dictionary has no name for its properties', () => {
    expect(scanned('/Span <</MCID 0>> BDC')).toEqual({ ops: [{ operator: 'BDC', operands: 2, first: '/Span', last: undefined }] });
  });
  it('a stray delimiter throws, so the prune cannot read the page', () => {
    expect(scanned('/Fm1 Do ) Q')).toEqual({ threw: "Content stream: stray ')' at byte 8" });
  });

  it('agrees on 4000 seeded random streams', () => {
    const parts = ['/Fm1', '/Fm2', '/F#20a', '/', ' ', ' ', ' ', '\n', '\r', '\0', '%c /Fm9 Do\n', '(', ')', '\\', '(a(/b)c)',
      '(\\) /Fm9 Do)', '<', '>', '<<', '>>', '<</K /V>>', '<ab>', '[', ']', '[/A 1 (x)]', '1', '-2.5', '1e-3', '1e', '+', '.',
      'e', 'E', 'Do', 'Tf', 'gs', 'scn', 'SCN', 'sh', 'BDC', 'DP', 'EMC', 'BI /W 1 ID xEI yy EI', 'Tj', 're', 'q', 'Q', '{', '}',
      'abcd', 'BI', 'ID', 'EI', 'Ā'];
    let seed = 0x5eed;
    const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
    const mismatches: string[] = [];
    for (let c = 0; c < 4000; c++) {
      let src = '';
      const len = 1 + Math.floor(rand() * 24);
      for (let k = 0; k < len; k++) src += parts[Math.floor(rand() * parts.length)] + (rand() < 0.6 ? ' ' : '');
      if (JSON.stringify(scanned(src)) !== JSON.stringify(reference(src))) mismatches.push(JSON.stringify(src));
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('agrees on every stream of the tracked fixture PDFs', async () => {
    const dirs = ['tests/fixtures/corpus-public', 'tests/fixtures/annotations'];
    const files = dirs.flatMap(d => readdirSync(d).filter(f => f.endsWith('.pdf')).map(f => join(d, f)));
    let streams = 0;
    const mismatches: string[] = [];
    for (const file of files) {
      let doc: PDFDocument;
      try { doc = await PDFDocument.load(readFileSync(file), { updateMetadata: false, ignoreEncryption: true }); } catch { continue; }
      for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        let text: string;
        try { text = Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1'); } catch { continue; }
        if (text.length > 2_000_000) continue;
        streams++;
        if (JSON.stringify(scanned(text)) !== JSON.stringify(reference(text))) mismatches.push(`${file} ${ref.toString()}`);
      }
    }
    expect(streams).toBeGreaterThan(50);
    expect(mismatches).toEqual([]);
  });
});
