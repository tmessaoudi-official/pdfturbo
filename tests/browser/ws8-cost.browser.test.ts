/**
 * WS8 step 1 — the go/no-go cost of the viewer check in a REAL browser, with pdf.js's real worker
 * (docs/plans/ws8-viewer-check.plan.md). The Node probe (`tests/tools/ws8Cost.test.ts`) runs pdf.js in-process,
 * so it measures CPU, not what the user feels; this measures main-thread long tasks during one WS8 pass.
 *
 * Opt-in: needs `VITE_WS8_COST=1` and the gitignored corpus (`var/corpus`, `scripts/c9-corpus-fetch.sh`), so it
 * skips in CI and in an ordinary `npm run test:browser`. Run:
 *   VITE_WS8_COST=1 npx vitest run --config vitest.browser.config.ts tests/browser/ws8-cost.browser.test.ts
 * Result lines are printed with the prefix `WS8COST`.
 */
/* oxlint-disable no-console -- this probe's output IS its console lines */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { PDFDocument } from '@cantoo/pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const FILES = ['report-irs-pub17.pdf', 'report-census-income.pdf', 'form-irs-1040.pdf'];
const MAIN_THREAD_BUDGET_MS = 200;
const enabled = Boolean(import.meta.env.VITE_WS8_COST);

async function fingerprints(doc: pdfjsLib.PDFDocumentProxy): Promise<string[]> {
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const text = (tc.items as Array<{ str?: string; transform: number[] }>)
      .filter(i => typeof i.str === 'string').map(i => `${i.str}@${i.transform[4].toFixed(2)},${i.transform[5].toFixed(2)}`).join('|');
    const ol = await page.getOperatorList({ annotationMode: pdfjsLib.AnnotationMode.DISABLE });
    out.push(`${text.length}:${text.slice(0, 64)}#${Array.from(ol.fnArray).join(',').length}`);
    page.cleanup();
  }
  return out;
}

describe.skipIf(!enabled)('WS8 cost in the browser (step 1 go/no-go)', () => {
  it.each(FILES)('%s — one viewer-check pass stays off the main thread', async file => {
    const res = await fetch(`/@fs/stack/projects/pdfturbo/var/corpus/${file}`);
    if (!res.ok) { console.log(`WS8COST ${file} SKIPPED (corpus absent)`); return; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    // The app already holds this document (documentLoader); open it outside the measured window.
    const original = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;

    const longTasks: Array<{ start: number; ms: number }> = [];
    const obs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) longTasks.push({ start: e.startTime, ms: Math.round(e.duration) });
    });
    obs.observe({ type: 'longtask', buffered: false });
    const t0 = performance.now();
    const libDoc = await PDFDocument.load(bytes, { updateMetadata: false });
    const t1 = performance.now();
    const fresh = await PDFDocument.create({ updateMetadata: false });
    for (const pg of await fresh.copyPages(libDoc, libDoc.getPageIndices())) fresh.addPage(pg);
    const copyBytes = await fresh.save();
    const t2 = performance.now();
    const copy = await pdfjsLib.getDocument({ data: copyBytes }).promise;
    const [a, b] = [await fingerprints(original), await fingerprints(copy)];
    const t3 = performance.now();
    await new Promise<void>(r => { setTimeout(r, 50); }); // let the observer flush
    obs.disconnect();
    await copy.loadingTask.destroy();
    await original.loadingTask.destroy();

    const mismatched = a.map((f, i) => (f === b[i] ? 0 : i + 1)).filter(Boolean);
    // pdf-lib's own parse (t0..t1) already happens on today's export path; WS8's NEW work is t1..t3.
    const phase = (lo: number, hi: number) => longTasks.filter(x => x.start >= lo && x.start < hi).map(x => x.ms);
    const parseTasks = phase(t0, t1);
    const copyTasks = phase(t1, t2);
    const viewerTasks = phase(t2, t3 + 50);
    const maxTask = Math.max(0, ...copyTasks, ...viewerTasks);
    console.log(`WS8COST ${JSON.stringify({
      file, pages: a.length, libLoadMs: Math.round(t1 - t0), copySaveMs: Math.round(t2 - t1), viewerMs: Math.round(t3 - t2),
      totalMs: Math.round(t3 - t0), parseTasks, copyTasks, viewerTasks, maxNewLongTaskMs: maxTask, mismatched,
    })}`);
    expect(mismatched).toEqual([]);
    expect(maxTask).toBeLessThanOrEqual(MAIN_THREAD_BUDGET_MS);
  }, 300_000);
});
