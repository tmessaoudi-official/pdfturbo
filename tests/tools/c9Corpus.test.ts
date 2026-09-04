// @vitest-environment node
/**
 * C9 CORPUS PROBE — the plan's gate for wiring borderless-table inference into the DOCX flow.
 *
 * `inferBorderlessGrid` already ships for CSV/XLSX, where a false positive costs the user one
 * discardable file because they explicitly asked for a table. The DOCX flow is different:
 * `reconstructPage` REMOVES in-region words from the paragraph flow, so a phantom table there
 * silently mangles prose. The plan therefore gates the wiring on **zero false positives over
 * ~10-15 real-world PDFs**, and says that a non-zero result is recorded in `KNOWN_ISSUES.md` rather
 * than answered with a threshold tweak.
 *
 * This is a MEASUREMENT, not a permanent guard: the corpus lives in gitignored `var/corpus/`, so the
 * file SKIPS when it is absent (in CI, always). It runs the real `inferBorderlessGrid` against real
 * pdf.js text extraction — never a reimplementation of either, which is the mistake that would make
 * the whole exercise meaningless.
 *
 * Refresh the corpus with `scripts/c9-corpus-fetch.sh`, then run:
 *   C9_CORPUS=1 npx vitest run tests/tools/c9Corpus.test.ts
 * The per-page report lands in `var/claude/c9-corpus-report.json`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inferBorderlessGrid } from '../../src/utils/borderlessTable';
import type { TableTextItem } from '../../src/utils/tableExtract';

const CORPUS = resolve(__dirname, '../../var/corpus');
const OUT_DIR = resolve(__dirname, '../../var/claude');

const files = existsSync(CORPUS)
  ? readdirSync(CORPUS).filter(f => f.toLowerCase().endsWith('.pdf')).sort()
  : [];

interface PageHit {
  file: string;
  page: number;
  rows: number;
  cols: number;
  /** First two rows of the inferred grid, so a firing can be judged without re-running. */
  sample: string[][];
  /** The statistic MAX_MEDIAN_CELL_WORDS gates on, recomputed so a firing's MECHANISM is recorded. */
  medianCellWords: number;
  nonEmptyCells: number;
}

// Opt-in, twice over: the corpus must exist AND `C9_CORPUS=1` must be set. Excluding the file from
// the config instead would have been simpler and was tried — it makes `npx vitest run <this file>`
// match nothing, so the invocation in the header above silently does nothing at all. A probe that
// reads 360 pages has no business running inside `npm run test` or the pre-push hook.
describe.skipIf(files.length === 0 || !process.env.C9_CORPUS)('C9 corpus probe', () => {
  it('runs the real gate over every page and writes a report', async () => {
    // The LEGACY build is the one that runs under Node; the worker is disabled so pdf.js stays in
    // this process (a worker would need a URL resolvable from the test environment).
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const hits: PageHit[] = [];
    const perFile: Record<string, { pages: number; hits: number }> = {};

    for (const f of files) {
      const bytes = new Uint8Array(readFileSync(resolve(CORPUS, f)));
      const task = pdfjs.getDocument({
        data: bytes,
        useSystemFonts: false,
        disableFontFace: true,
        standardFontDataUrl: resolve(__dirname, '../../node_modules/pdfjs-dist/standard_fonts') + '/',
      } as never);
      const doc = await task.promise;
      perFile[f] = { pages: doc.numPages, hits: 0 };

      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        // Exactly the shape `_extractPageTableData` builds: absolute user-space origin plus the
        // advance width the borderless detector needs to know where text ENDS.
        const items: TableTextItem[] = (content.items as Array<Record<string, unknown>>)
          .filter(ti => typeof ti.str === 'string')
          .map(ti => ({
            text: ti.str as string,
            x: (ti.transform as number[])[4],
            y: (ti.transform as number[])[5],
            width: ti.width as number,
          }));

        const grid = inferBorderlessGrid(items);
        if (grid) {
          perFile[f].hits++;
          // Same computation as the gate's final filter, so the number in the report IS the number
          // the threshold was compared against — never a re-derivation that could differ.
          const counts = grid.cells.flat().map(c => c.trim()).filter(Boolean)
            .map(c => c.split(/\s+/).length).sort((a, b) => a - b);
          hits.push({
            file: f,
            page: p,
            rows: grid.cells.length,
            cols: grid.cells[0]?.length ?? 0,
            sample: grid.cells.slice(0, 2).map(r => r.map(c => c.slice(0, 40))),
            medianCellWords: counts[Math.floor(counts.length / 2)] ?? 0,
            nonEmptyCells: counts.length,
          });
        }
      }
      await task.destroy();
    }

    mkdirSync(OUT_DIR, { recursive: true });
    const totalPages = Object.values(perFile).reduce((n, v) => n + v.pages, 0);
    writeFileSync(
      resolve(OUT_DIR, 'c9-corpus-report.json'),
      JSON.stringify({ files: files.length, totalPages, firings: hits.length, perFile, hits }, null, 2),
    );

    // The probe asserts only that it RAN over a real corpus. The pass/fail judgement is the
    // false-positive classification, which is a reading of the report and is recorded in the
    // Decisions Log — asserting "zero firings" here would be wrong, since a firing on a genuinely
    // tabular page is the detector working.
    expect(files.length).toBeGreaterThan(0);
    expect(totalPages).toBeGreaterThan(0);
  }, 600_000);
});
