// @vitest-environment node
/**
 * The load guard against REAL files — the false-refusal measurement (WS7 round 13).
 *
 * `loadPdfDocument` refuses a file pdf-lib dropped content from, or reads differently from pdf.js. A guard
 * that refuses a real file every viewer opens is worse than the bound it closes, so a real PDF must load
 * through the guard exactly as it loads through pdf-lib — same success, or the same error.
 *
 * Two corpora:
 *  - `tests/fixtures/corpus-public` is tracked and runs on every run.
 *  - `var/corpus` is gitignored (arXiv 1- and 2-column papers, IRS/GSA/USPTO forms, government reports),
 *    so that half SKIPS when it is absent — always in CI. Refresh it with `scripts/c9-corpus-fetch.sh`, then
 *    `LOAD_GUARD_CORPUS=1 npx vitest run tests/utils/pdfLoadGuardCorpus.test.ts`; the per-file report lands in
 *    `var/claude/ws7/load-guard-corpus.json`.
 *
 * Non-vacuity: a file only reaches the cross-reference comparison when pdf-lib assigned some object twice or
 * met more than one trailer, AND the chain from `startxref` resolved. The gated half asserts that happened on
 * at least one real file, so "nothing refused" is not merely "nothing was compared".
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { describeParse, loadPdfDocument } from '../../src/utils/pdfLoadGuard';

const outcome = (p: Promise<unknown>): Promise<string> => p.then(() => 'loaded', (e: unknown) => (e as Error).name);
const pdfsIn = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf')).sort() : [];

interface Row {
  file: string;
  raw: string;
  guard: string;
  rawMs: number;
  ms: number;
  reassigned: boolean;
  trailerDicts: number;
  chainResolved: boolean;
}

async function measure(dir: string, file: string): Promise<Row> {
  const bytes = new Uint8Array(readFileSync(resolve(dir, file)));
  let parse = { reassigned: false, trailerDicts: 0, chainResolved: false };
  let rawMs = 0;
  const r0 = performance.now();
  const raw = await outcome(PDFDocument.load(bytes, { updateMetadata: false }).then(async doc => {
    rawMs = Math.round(performance.now() - r0);
    parse = await describeParse(doc.context, bytes);
  }));
  const t0 = performance.now();
  const guard = await outcome(loadPdfDocument(bytes, { updateMetadata: false }));
  return { file, raw, guard, rawMs, ms: Math.round(performance.now() - t0), ...parse };
}

describe('the load guard on real files', () => {
  const PUBLIC = resolve(__dirname, '../fixtures/corpus-public');

  it('loads every tracked public fixture exactly as pdf-lib does', async () => {
    const files = pdfsIn(PUBLIC);
    expect(files.length).toBeGreaterThanOrEqual(5); // a moved directory must not pass on nothing
    for (const file of files) {
      const row = await measure(PUBLIC, file);
      expect({ file, guard: row.guard }).toEqual({ file, guard: row.raw });
    }
  }, 120_000);

  const CORPUS = resolve(__dirname, '../../var/corpus');
  const gated = process.env.LOAD_GUARD_CORPUS === '1' && pdfsIn(CORPUS).length > 0;

  it.skipIf(!gated)('loads every file in var/corpus exactly as pdf-lib does, and compared some of them', async () => {
    const rows: Row[] = [];
    for (const file of pdfsIn(CORPUS)) rows.push(await measure(CORPUS, file));
    const out = resolve(__dirname, '../../var/claude/ws7');
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, 'load-guard-corpus.json'), JSON.stringify(rows, null, 2));
    expect(rows.filter(r => r.guard !== r.raw)).toEqual([]);
    expect(rows.some(r => (r.reassigned || r.trailerDicts > 1) && r.chainResolved)).toBe(true);
  }, 600_000);
});
