/**
 * CONFIRMING BLOCKER (`it.fails`) — a non-zero CropBox origin shifts the whole flow-export LAYOUT.
 * See tests/blockers/README.md for the convention: the assertion states the CORRECT behaviour, and
 * `it.fails` makes the suite go RED the day someone fixes it, so the ceiling cannot rot unnoticed.
 *
 * ── What this is, and what it is NOT ──────────────────────────────────────────────
 * This is NOT a leak. The redaction filter on this path is correct at any CropBox origin as of
 * 2026-08-28 (`redactionRectToPageSpace`, pinned by redaction-crop-origin.browser.test.ts). What
 * remains is a LAYOUT defect on the same pages, found while fixing that leak.
 *
 * `reconstructPage` is handed `vp.width`/`vp.height` — the CROP dimensions — as the page box, but
 * the words, images, rules and link rects it receives are all in ABSOLUTE user space. On the usual
 * `/CropBox [0 0 w h]` page those frames coincide. Give the page a non-zero origin and every
 * position in the flow model is offset by that origin, so the DOCX/Markdown/text export gets wrong
 * margins (they are derived from word bounding boxes against the page box), wrong image anchor
 * offsets, and a reading order computed against a box the coordinates do not belong to.
 *
 * ── Why it was NOT fixed with the leak ────────────────────────────────────────────
 * The fix is not "subtract the origin from the words". Items, rules, links, images AND the
 * position-keyed `colorMap` (`${round(x)},${round(y)}`) would all have to move in lockstep;
 * normalising a subset silently breaks colour, underline and hyperlink matching, which are matched
 * BY position. That is a change with its own design and its own guards, so it is pinned here rather
 * than bundled into a security fix.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { FlowDoc } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type Ext = { _extractFlowDoc(): Promise<FlowDoc> };

/** MediaBox 400×400, CropBox [50 50 350 350] → a 300×300 visible box at origin (50,50). */
async function buildCroppedPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  page.setCropBox(50, 50, 300, 300);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Absolute y = 300, i.e. 50pt below the crop TOP (which is at absolute y 350).
  page.drawText('WORD', { x: 100, y: 300, size: 14, font, color: rgb(0, 0, 0) });
  return doc.save();
}

function makeSvc(doc: pdfjsLib.PDFDocumentProxy): Ext {
  return new ExportService({
    documentModel: {
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { doc, bytes: new Uint8Array() }]]),
    },
    elements: [],
  } as unknown as IExportContext) as unknown as Ext;
}

describe('CropBox origin vs flow-export layout (confirming blocker)', () => {
  /** CONTROL — passes today. At origin (0,0) the two frames coincide and the y is right. */
  it('reports a correct y when the CropBox origin is (0,0)', async () => {
    const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
    const d = await PDFDocument.create();
    const p = d.addPage([300, 300]);
    const f = await d.embedFont(StandardFonts.Helvetica);
    p.drawText('WORD', { x: 100, y: 250, size: 14, font: f, color: rgb(0, 0, 0) });
    const doc = await pdfjsLib.getDocument({ data: (await d.save()).slice(0) }).promise;
    const flow = await makeSvc(doc)._extractFlowDoc();
    expect(flow.pages[0].paragraphs[0].y).toBeCloseTo(250, 0);
  });

  it.fails('reports a CROP-RELATIVE y when the CropBox origin is non-zero', async () => {
    const doc = await pdfjsLib.getDocument({ data: (await buildCroppedPdf()).slice(0) }).promise;
    const flow = await makeSvc(doc)._extractFlowDoc();
    const page = flow.pages[0];
    // The page box the model reports is the CROP box: 300×300.
    expect(page.height).toBeCloseTo(300, 0);
    // The word sits 50pt below the crop top, so in that 300-high box its y-up coordinate is 250.
    // TODAY it reports the ABSOLUTE 300 — a y equal to the full page height, i.e. sitting exactly
    // on the top edge of a box it is actually 50pt inside. That is the whole defect in one number.
    expect(page.paragraphs[0].y).toBeCloseTo(250, 0);
  });
});
