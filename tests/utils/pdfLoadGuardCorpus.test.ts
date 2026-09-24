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
 * Non-vacuity (WS8): every file that loads must have been through the viewer check — pdf.js on the file and on the
 * export-shaped copy, every page compared — so "nothing refused" is not merely "nothing was checked". The mirror of
 * pdf.js's cross-reference reader that this file used to measure (`describeParse`) is gone with WS8.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { loadPdfDocument } from '../../src/utils/pdfLoadGuard';
import { hasViewerVerdict } from '../../src/utils/viewerVerdict';

const outcome = (p: Promise<unknown>): Promise<string> => p.then(() => 'loaded', (e: unknown) => (e as Error).name);
const pdfsIn = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf')).sort() : [];

interface Row {
  file: string;
  raw: string;
  guard: string;
  rawMs: number;
  ms: number;
  /** The guard ran the viewer check on these exact bytes. */
  checked: boolean;
}

async function measure(dir: string, file: string): Promise<Row> {
  const bytes = new Uint8Array(readFileSync(resolve(dir, file)));
  const r0 = performance.now();
  const raw = await outcome(PDFDocument.load(bytes, { updateMetadata: false }));
  const rawMs = Math.round(performance.now() - r0);
  const t0 = performance.now();
  const guard = await outcome(loadPdfDocument(bytes, { viewerCheck: 'source', updateMetadata: false }));
  return { file, raw, guard, rawMs, ms: Math.round(performance.now() - t0), checked: hasViewerVerdict(bytes) };
}

describe('the load guard on real files', () => {
  const PUBLIC = resolve(__dirname, '../fixtures/corpus-public');

  it('loads every tracked public fixture exactly as pdf-lib does', async () => {
    const files = pdfsIn(PUBLIC);
    expect(files.length).toBeGreaterThanOrEqual(5); // a moved directory must not pass on nothing
    const rows: Row[] = [];
    for (const file of files) {
      const row = await measure(PUBLIC, file);
      rows.push(row);
      expect({ file, guard: row.guard }).toEqual({ file, guard: row.raw });
    }
    expect(rows.filter(r => r.raw === 'loaded' && !r.checked).map(r => r.file)).toEqual([]);
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
    expect(rows.filter(r => r.raw === 'loaded' && !r.checked).map(r => r.file)).toEqual([]);
    expect(rows.some(r => r.checked)).toBe(true);
  }, 600_000);
});
