/**
 * WS8 step 5 — a layer the source switches OFF stays OFF in the export (docs/archive/plans/ws8-viewer-check.plan.md).
 *
 * `copyPages` copies the groups a page references but not the catalog's `/OCProperties`, so every viewer showed every
 * layer. `copySourcePages` carries it with the same object copier. Read back with pdf.js, which is what renders the
 * export and every rasterised export path.
 */
import { describe, it, expect } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { carryLayers, copySourcePages } from '../../src/export/copySourcePages';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { buildLayerPdf } from '../utils/_viewerCheckFixture';

async function layerVisibility(bytes: Uint8Array): Promise<boolean[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0), verbosity: 0 }).promise;
  try {
    const config = await doc.getOptionalContentConfig();
    return [...(config as unknown as Iterable<[string, { visible: boolean }]>)].map(([, g]) => g.visible);
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function copied(src: Uint8Array, carry: boolean): Promise<Uint8Array> {
  const dest = await PDFDocument.create();
  const { pages: [page], ocProperties } = await copySourcePages(dest, await PDFDocument.load(src), [0]);
  dest.addPage(page);
  if (carry && ocProperties) await carryLayers(dest, ocProperties);
  return dest.save();
}

function assembler(sources: Uint8Array[]): ExportService {
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: sources.length,
      currentPageIndex: 0,
      pages: sources.map((_, i) => ({ id: `p${i}`, sourcePdfId: `s${i}`, sourcePageNum: 1, rotation: 0 })),
      sourcePdfs: new Map(sources.map((bytes, i) => [`s${i}`, { bytes }])),
      watermark: { enabled: false },
      bates: { enabled: false },
    },
    elements: [],
    formValues: {},
    currentFilename: 'layers.pdf',
    exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info() {}, warn() {}, error() {} },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  return new ExportService(ctx);
}

describe('copySourcePages — layer settings travel with the pages', () => {
  it('keeps a layer the source switches OFF hidden, where a plain copy showed it', async () => {
    const src = buildLayerPdf('OFF');
    expect(await layerVisibility(src)).toEqual([false]);
    expect(await layerVisibility(await copied(src, false))).toEqual([]); // the bug: no layer settings at all
    expect(await layerVisibility(await copied(src, true))).toEqual([false]);
  });

  it('keeps an ON layer ON (control)', async () => {
    expect(await layerVisibility(await copied(buildLayerPdf('ON'), true))).toEqual([true]);
  });

  it('points /OCProperties at the SAME group objects the page references — viewers match groups by reference', async () => {
    const doc = await PDFDocument.load(await copied(buildLayerPdf('OFF'), true));
    const ocgs = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('OCGs'), PDFArray);
    const props = doc.getPage(0).node.Resources()?.lookup(PDFName.of('Properties'), PDFDict);
    if (!props) throw new Error('the copied page has no /Properties');
    expect(props.get(PDFName.of('L1'))).toBeInstanceOf(PDFRef);
    expect(ocgs.get(0)).toBe(props.get(PDFName.of('L1')));
  });
});

describe('the assembled export — WS8 step 5', () => {
  it('carries the one layered source\'s settings', async () => {
    expect(await layerVisibility(await assembler([buildLayerPdf('OFF')]).assemblePdfBytes())).toEqual([false]);
  });

  it('carries them when only one of several sources is layered', async () => {
    const plain = await (await PDFDocument.create()).save();
    const withPage = await PDFDocument.load(plain);
    withPage.addPage([100, 100]);
    const bytes = await assembler([await withPage.save(), buildLayerPdf('OFF')]).assemblePdfBytes();
    expect(await layerVisibility(bytes)).toEqual([false]);
  });

  it('REFUSES two layered sources when one of them hides a layer', async () => {
    const err = await assembler([buildLayerPdf('ON'), buildLayerPdf('OFF')]).assemblePdfBytes().catch((e: unknown) => e);
    expect((err as Error).name).toBe('ExportLayersConflictError');
  });

  it('exports two layered sources whose layers are all ON — nothing is hidden, so nothing is lost (control)', async () => {
    const bytes = await assembler([buildLayerPdf('ON'), buildLayerPdf('ON')]).assemblePdfBytes();
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });
});
