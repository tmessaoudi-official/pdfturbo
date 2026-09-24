// @vitest-environment node
/**
 * WS8 cost probe — what running pdf.js itself, instead of the load guard's mirror, would cost (2026-09-24).
 *
 * WS8 replaces the mirror (`src/utils/pdfLoadGuard.ts`) by comparing, page by page, what pdf.js shows for the
 * original file with what pdf.js shows for pdf-lib's copy of it (pages copied into a fresh document, re-opened in
 * pdf.js). Of the shapes run here, C2, C2ctl and countHidesFirst differ in page count; every other one differs only
 * in what a page draws, so the probe compares per-page CONTENT fingerprints, in two tiers:
 *  - text: `getTextContent` strings + origins,
 *  - ops:  `getOperatorList` operator sequence (fnArray only — args carry per-document font/image ids).
 *
 * Opt-in twice over, like `c9Corpus.test.ts`: the corpus must exist (`scripts/c9-corpus-fetch.sh`) AND
 * `WS8_COST=1` must be set. `WS8_RUNS` (default 3) and `WS8_FILES` (comma list) narrow a run. Report:
 * `var/claude/ws8/cost.json`.
 *
 * Read the numbers as CPU cost in Node: the legacy build runs pdf.js without a worker, in this process, with no
 * font faces. In the browser the same work runs in pdf.js's worker, off the main thread. The app already opens
 * every file with pdf.js (`documentLoader.ts`), so `origOpenMs` is reported but is not WS8's cost.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { loadPdfDocument } from '../../src/utils/pdfLoadGuard';
import { buildPageOrderPdf, buildXrefCountPdf, buildXrefShapePdf } from '../utils/_invalidObjectFixture';

const CORPUS = resolve(__dirname, '../../var/corpus');
const AUDIT = resolve(__dirname, '../../var/claude/ws7/audit-2026-09-24');
const OUT = resolve(__dirname, '../../var/claude/ws8');
const RUNS = Number(process.env.WS8_RUNS ?? 3);
const only = process.env.WS8_FILES?.split(',').map(s => s.trim()).filter(Boolean);
const files = existsSync(CORPUS)
  ? readdirSync(CORPUS).filter(f => f.toLowerCase().endsWith('.pdf') && (!only || only.includes(f))).sort()
  : [];

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type Tier = 'text' | 'ops';
let pdfjs: PdfJs;

const sha = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16);
const r2 = (n: number): string => (Math.round(n * 100) / 100).toString();

async function open(bytes: Uint8Array) {
  // `getDocument` TRANSFERS its buffer; every caller passes a copy.
  const task = pdfjs.getDocument({
    data: bytes.slice(0),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
    standardFontDataUrl: resolve(__dirname, '../../node_modules/pdfjs-dist/standard_fonts') + '/',
  } as never);
  return { task, doc: await task.promise };
}

/** One fingerprint per page; a page pdf.js cannot produce is `ERR:<name>`, which is itself a fingerprint. */
async function fingerprints(doc: Awaited<ReturnType<typeof open>>['doc'], tier: Tier): Promise<string[]> {
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    try {
      const page = await doc.getPage(p);
      if (tier === 'text') {
        const tc = await page.getTextContent();
        out.push(sha((tc.items as Array<{ str?: string; transform: number[] }>)
          .filter(i => typeof i.str === 'string')
          .map(i => `${i.str}@${r2(i.transform[4])},${r2(i.transform[5])}`).join('|')));
      } else {
        // Page CONTENT only. With annotations drawn, 7 of the 8 corpus forms mismatched on every widget page:
        // the export-shaped copy has no /AcroForm, so pdf.js draws its widgets differently (measured 2026-09-24;
        // DISABLE → 0 mismatched pages). Annotations are a separate channel from the ten disclosed shapes.
        const ol = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
        out.push(sha(Array.from(ol.fnArray).join(',')));
      }
      page.cleanup();
    } catch (e) {
      out.push(`ERR:${(e as Error).name}`);
    }
  }
  return out;
}

interface Pass {
  guardMs: number; saveMs: number; origOpenMs: number; copyOpenMs: number;
  textOrigMs: number; textCopyMs: number; opsOrigMs: number; opsCopyMs: number;
  pages: number; copyPages: number; textMismatch: number[]; opsMismatch: number[]; guard: string;
}

const time = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
  const t0 = performance.now();
  const v = await f();
  return [v, Math.round(performance.now() - t0)];
};

const mismatches = (a: string[], b: string[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i + 1);
  return out;
};

/**
 * One full WS8 pass: the shipped guard, then save → re-open → fingerprint both sides. Until WS8 step 4 the guard was
 * the mirror, and this was the baseline the design was measured against; since then it runs the viewer check
 * itself, so `guard` is the SHIPPED verdict and the shapes test below checks the probe's standalone fingerprinting
 * agrees with it on the controls.
 */
async function pass(bytes: Uint8Array): Promise<Pass> {
  const [guard, guardMs] = await time(() => loadPdfDocument(bytes, { updateMetadata: false, viewerCheck: 'source' })
    .then(() => 'loaded', (e: unknown) => (e as Error).name));
  // WS8 fingerprints what pdf-lib HOLDS, whether or not today's guard refuses it — so load raw pdf-lib.
  const libDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  // Export-shaped: pages copied into a FRESH document, as `_assemblePdfDoc` does. A plain `libDoc.save()` keeps the
  // original's object numbers, duplicate definitions, linearization dict and /Count lies, so pdf.js re-reads the
  // copy with the same quirks and C1/C1b/C2/countHidesFirst compare equal (measured on the first run of this probe).
  const [copy, saveMs] = await time(async () => {
    const out = await PDFDocument.create({ updateMetadata: false });
    for (const pg of await out.copyPages(libDoc, libDoc.getPageIndices())) out.addPage(pg);
    return out.save();
  });
  const [orig, origOpenMs] = await time(() => open(bytes));
  const [cp, copyOpenMs] = await time(() => open(copy));
  const [tO, textOrigMs] = await time(() => fingerprints(orig.doc, 'text'));
  const [tC, textCopyMs] = await time(() => fingerprints(cp.doc, 'text'));
  const [oO, opsOrigMs] = await time(() => fingerprints(orig.doc, 'ops'));
  const [oC, opsCopyMs] = await time(() => fingerprints(cp.doc, 'ops'));
  const res = {
    guardMs, saveMs, origOpenMs, copyOpenMs, textOrigMs, textCopyMs, opsOrigMs, opsCopyMs,
    pages: orig.doc.numPages, copyPages: cp.doc.numPages,
    textMismatch: mismatches(tO, tC), opsMismatch: mismatches(oO, oC), guard,
  };
  await orig.task.destroy();
  await cp.task.destroy();
  return res;
}

const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { min: s[0], median: s[Math.floor(s.length / 2)] };
};

describe.skipIf(files.length === 0 || !process.env.WS8_COST)('WS8 cost probe', () => {
  beforeAll(async () => {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // The first loadPdfDocument installs the drop recorder; do it outside any timed pass.
    const d = await PDFDocument.create();
    d.addPage();
    await loadPdfDocument(await d.save(), { viewerCheck: false });
  });

  it('catches the audited shapes and stays silent on their controls', async () => {
    const cases: Array<{ name: string; bytes: Uint8Array; expectFlag: boolean }> = [
      { name: 'xref clean', bytes: buildXrefShapePdf('clean'), expectFlag: false },
      { name: 'xref dupFirst', bytes: buildXrefShapePdf('dupFirst'), expectFlag: true },
      { name: 'count countHonest', bytes: buildXrefCountPdf('countHonest'), expectFlag: true },
      { name: 'count countShort (P3a)', bytes: buildXrefCountPdf('countShort'), expectFlag: false },
      { name: 'count countLong (P3a)', bytes: buildXrefCountPdf('countLong'), expectFlag: false },
      { name: 'pages countHonest', bytes: buildPageOrderPdf('countHonest'), expectFlag: false },
      { name: 'pages countHidesFirst', bytes: buildPageOrderPdf('countHidesFirst'), expectFlag: true },
    ];
    // The closing audit's page-walk fixtures are gitignored scratch; use them when present.
    for (const [f, flag] of [['C1.pdf', true], ['C1b.pdf', true], ['C2.pdf', true], ['C2ctl.pdf', true]] as const) {
      if (existsSync(resolve(AUDIT, f))) cases.push({ name: `audit ${f}`, bytes: new Uint8Array(readFileSync(resolve(AUDIT, f))), expectFlag: flag });
    }
    // The audit's xref shapes (P1–P9), dumped from its probe scripts by `DUMP=var/claude/ws8/pshapes` (gitignored).
    // Divergent shapes must flag; P3a (both readers repair the table the same way) must not. The P-shape controls were
    // written as controls for the mirror: the probe must flag exactly the ones the shipped guard refuses.
    const PSHAPES = resolve(OUT, 'pshapes');
    const controls: string[] = [];
    for (const f of existsSync(PSHAPES) ? readdirSync(PSHAPES).sort() : []) {
      const bytes = new Uint8Array(readFileSync(resolve(PSHAPES, f)));
      if (f.includes('control')) { controls.push(f); cases.push({ name: `p ${f}`, bytes, expectFlag: false }); continue; }
      cases.push({ name: `p ${f}`, bytes, expectFlag: !f.startsWith('P3a_') });
    }
    const rows: Array<Record<string, unknown>> = [];
    const unopenable: string[] = [];
    for (const c of cases) {
      let p: Pass;
      try {
        p = await pass(c.bytes);
      } catch (e) {
        // pdf.js (or pdf-lib) cannot open the original at all: the app never loads such a file
        // (`documentLoader.ts` stops on the open error), so there is nothing WS8 would compare.
        unopenable.push(c.name);
        rows.push({ name: c.name, expectFlag: c.expectFlag, flagged: null, guard: `UNOPENABLE ${(e as Error).name}`,
          pages: 0, copyPages: 0, textMismatch: [], opsMismatch: [] });
        continue;
      }
      const flagged = p.pages !== p.copyPages || p.textMismatch.length > 0 || p.opsMismatch.length > 0;
      const isControl = controls.some(f => c.name === `p ${f}`);
      rows.push({ name: c.name, expectFlag: isControl ? p.guard !== 'loaded' : c.expectFlag, flagged, guard: p.guard, pages: p.pages, copyPages: p.copyPages,
        textMismatch: p.textMismatch, opsMismatch: p.opsMismatch });
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, 'shapes.json'), JSON.stringify(rows, null, 2));
    for (const r of rows) {
      if (unopenable.includes(r.name as string)) continue;
      expect({ name: r.name, flagged: r.flagged }).toEqual({ name: r.name, flagged: r.expectFlag });
    }
  }, 120_000);

  it('measures the cost on every corpus file and reports false alarms', async () => {
    const report = [];
    const load = loadavg()[0];
    for (const f of files) {
      const bytes = new Uint8Array(readFileSync(resolve(CORPUS, f)));
      const passes: Pass[] = [];
      for (let i = 0; i < RUNS; i++) passes.push(await pass(bytes));
      const k = (key: keyof Pass) => stat(passes.map(p => p[key] as number));
      const first = passes[0];
      report.push({
        file: f, pages: first.pages, copyPages: first.copyPages, guard: first.guard,
        textMismatchPages: first.textMismatch, opsMismatchPages: first.opsMismatch,
        guardMs: k('guardMs'), saveMs: k('saveMs'), origOpenMs: k('origOpenMs'), copyOpenMs: k('copyOpenMs'),
        textOrigMs: k('textOrigMs'), textCopyMs: k('textCopyMs'), opsOrigMs: k('opsOrigMs'), opsCopyMs: k('opsCopyMs'),
      });
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, 'cost.json'), JSON.stringify({ runs: RUNS, loadAtStart: load, loadAtEnd: loadavg()[0], report }, null, 2));
    // Recorded, then asserted: a real file whose two sides fingerprint differently is a WS8 false alarm.
    for (const r of report) {
      expect({ file: r.file, pages: r.copyPages, text: r.textMismatchPages, ops: r.opsMismatchPages })
        .toEqual({ file: r.file, pages: r.pages, text: [], ops: [] });
    }
  }, 3_600_000);
});
