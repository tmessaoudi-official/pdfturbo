/**
 * M2 panel round 2 (P1). An export read the app's element list LIVE across its awaits: `closeDocument` empties that
 * very array (`elements.splice(0)`) and an undo splices it too, so a close landing while the sources load left the
 * export seeing no redaction — the redacted page was copied as vector text and shipped with the secret, under a
 * success toast. The PDF and image exports now take the element list and the page list once, when the export starts.
 * Reproduced first by the reviewer's probe, then here: `{ rasterCalls: 0, secretInBytes: true }`.
 */
import { describe, it, expect, vi } from 'vitest';
import { PDFDocument, StandardFonts, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import type { IExportContext } from '../../src/export/exportService';

const state = {
  duringLoad: null as null | (() => void), elements: [] as unknown[], pages: [] as unknown[], rasterCalls: 0,
  /** What the rasteriser was handed: the page's rotation, each element's geometry, the Bates page number and total. */
  rasterSaw: [] as unknown[],
};

vi.mock('../../src/utils/pdfLoadGuard', async orig => {
  const m = await orig<Record<string, unknown>>();
  return {
    ...m,
    loadPdfDocument: async (...a: unknown[]) => {
      const d = await (m.loadPdfDocument as (...x: unknown[]) => Promise<unknown>)(...a);
      state.duringLoad?.(); // the close / undo lands while the export awaits its sources
      return d;
    },
  };
});
vi.mock('../../src/export/exportPipeline', async orig => {
  const m = await orig<Record<string, unknown>>();
  return {
    ...m,
    rasterizePageWithRedactions: (_s: unknown, p: { rotation?: number; crop?: unknown }, e: Array<{ x: number; y: number; rotation?: number }>, target: PDFDocument, ...rest: unknown[]) => {
      state.rasterCalls++;
      state.rasterSaw.push({ rotation: p.rotation, crop: (p as { crop?: unknown }).crop, elements: e.map(el => [el.x, el.y, el.rotation]), pageNumber: rest[5], docTotal: rest[6] });
      target.addPage([300, 400]); // the burn itself is pinned elsewhere; here only WHETHER the page is rasterised
      return Promise.resolve();
    },
  };
});
const { ExportService } = await import('../../src/export/exportService');

const SECRET = 'TOPSECRET-4242';
const HEX = Buffer.from(SECRET).toString('hex').toUpperCase(); // pdf-lib's drawText writes a hex string

async function sourceBytes(text = SECRET): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const p = d.addPage([300, 400]);
  p.drawText(text, { x: 40, y: 300, size: 14, font: await d.embedFont(StandardFonts.Helvetica) });
  return d.save({ useObjectStreams: false });
}

/** Every decodable stream of the file, upper-cased latin1. */
async function allStreams(bytes: Uint8Array): Promise<string> {
  const d = await PDFDocument.load(bytes);
  let t = '';
  for (const [, obj] of d.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    try { t += Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1').toUpperCase(); } catch { /* not decodable */ }
  }
  return t;
}

const redaction = { id: 'r1', type: 'redaction', pageId: 'p1', x: 30, y: 80, width: 200, height: 40, rotation: 0 };
const closeDocument = () => { state.elements.splice(0); };

async function exportWith(path: 'pdf' | 'page' | 'range', duringLoad: (() => void) | null) {
  state.duringLoad = duringLoad;
  state.rasterCalls = 0;
  state.rasterSaw = [];
  state.elements = [{ ...redaction }];
  // A full-page crop: the in-place case edits it, to pin that the snapshot holds its own copy.
  state.pages = [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0, crop: { x: 0, y: 0, width: 300, height: 400 } }];
  const downloads: Blob[] = [];
  const infos: string[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      get pageCount() { return state.pages.length; },
      get pages() { return state.pages; },
      sourcePdfs: new Map([['s1', { bytes: await sourceBytes() }]]),
      watermark: { enabled: false },
    },
    get elements() { return state.elements; },
    formValues: {},
    currentFilename: 'x.pdf',
    exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info: (k: string) => { infos.push(k); }, warn: () => {}, error: () => {} },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob) => void })._downloadBlob = b => { downloads.push(b); };
  if (path === 'pdf') await svc.downloadPDF();
  else if (path === 'range') await svc.downloadPageRange([0]);
  else await svc.downloadPage(0);
  state.duringLoad = null;
  const bytes = downloads[0] ? new Uint8Array(await downloads[0].arrayBuffer()) : new Uint8Array();
  return {
    files: downloads.length,
    rasterCalls: state.rasterCalls,
    secretInBytes: bytes.length ? (await allStreams(bytes)).includes(HEX) : null,
    pages: bytes.length ? (await PDFDocument.load(bytes)).getPageCount() : 0,
  };
}

const SAFE = { files: 1, rasterCalls: 1, secretInBytes: false, pages: 1 };

describe('an export uses the document as it was when the export started (M2 panel round 2)', () => {
  it('the probe can see the secret: the plain source carries it', async () => {
    expect((await allStreams(await sourceBytes())).includes(HEX)).toBe(true);
  });

  it.each(['pdf', 'page'] as const)('control (%s): no close — the redacted page is rasterised, the secret absent', async path => {
    expect(await exportWith(path, null)).toEqual(SAFE);
  });

  it.each(['pdf', 'page'] as const)('a close while the sources load still burns the redaction (%s)', async path => {
    expect(await exportWith(path, closeDocument)).toEqual(SAFE);
  });

  // M2 panel round 3: the copies were shallow, so an undo that writes the LIVE page or element in place — the page
  // turned back (RotatePageCmd + TransformAnnotationsCmd), a box moved or turned back (MoveResizeCmd,
  // RotateElementCmd) — still reached an export already running. The rasteriser reads the page's rotation and the
  // elements' geometry at different awaits, so such an undo could pair one state's rotation with the other's boxes.
  // `range` too: its page list is chosen before the save dialog and swapped for the snapshot's pages by id.
  it.each(['pdf', 'page', 'range'] as const)('an in-place undo mid-export does not reach the rasteriser (%s)', async path => {
    const undoInPlace = () => {
      const page = state.pages[0] as { rotation: number; crop: { width: number } };
      page.rotation = 90;
      page.crop.width = 100; // SetPageCropCmd replaces the crop; this edits it in place, the harder case
      Object.assign(state.elements[0] as object, { x: 0, y: 0, rotation: 45 });
    };
    expect(await exportWith(path, undoInPlace)).toEqual(SAFE);
    expect(state.rasterSaw).toEqual([{
      rotation: 0, crop: { x: 0, y: 0, width: 300, height: 400 }, elements: [[30, 80, 0]], pageNumber: 1, docTotal: 1,
    }]);
  });

  // M2 round 4 (R4-1): the source PDFs were read live, and `ReplaceSourcePdfBytesCmd` writes `bytes` on the live source
  // object. Two sources load one after the other, so a true-edit delete undone while the first loads put the deleted
  // text back into the second. Reproduced first by the correctness lens: `{ secretInBytes: true }`.
  it('a true-edit undone while the sources load does not reach a later source (R4-1)', async () => {
    state.duringLoad = null;
    state.elements = [];
    state.pages = [
      { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 },
      { id: 'p2', sourcePdfId: 's2', sourcePageNum: 1, rotation: 0 },
    ];
    const orig = await sourceBytes();
    const s2 = { bytes: await sourceBytes('EDITED') }; // the secret deleted by a true-edit
    const downloads: Blob[] = [];
    const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
    const errors: unknown[] = [];
    const ctx = {
      documentModel: {
        get pageCount() { return state.pages.length; },
        get pages() { return state.pages; },
        sourcePdfs: new Map<string, unknown>([['s1', { bytes: await sourceBytes('PUBLIC') }], ['s2', s2]]),
        watermark: { enabled: false },
      },
      get elements() { return state.elements; },
      formValues: {}, currentFilename: 'x.pdf', exportPassword: null,
      inkLayer: { getStrokes: () => [] },
      reportError: { info: () => {}, warn: () => {}, error: (_k: string, e: unknown) => { errors.push(e); } },
      progress: { begin: () => handle },
      cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
    } as unknown as IExportContext;
    const svc = new ExportService(ctx);
    (svc as unknown as { _downloadBlob: (b: Blob) => void })._downloadBlob = b => { downloads.push(b); };
    state.duringLoad = () => { s2.bytes = orig; }; // the undo, on the live source
    await svc.downloadPDF();
    state.duringLoad = null;
    expect(errors).toEqual([]);
    expect(downloads).toHaveLength(1);
    const text = await allStreams(new Uint8Array(await downloads[0].arrayBuffer()));
    expect(text.includes(HEX), 'the deleted secret is back in the file').toBe(false);
    expect(text.includes(Buffer.from('EDITED').toString('hex').toUpperCase()), 'the edited page is exported').toBe(true);
  });

  it('a page added to the document mid-export (an undo of a delete) is not exported', async () => {
    const restore = () => { state.pages.push({ id: 'p2', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }); };
    expect(await exportWith('pdf', restore)).toEqual(SAFE);
  });
});
