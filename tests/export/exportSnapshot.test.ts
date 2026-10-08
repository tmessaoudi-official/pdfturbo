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

const state = { duringLoad: null as null | (() => void), elements: [] as unknown[], pages: [] as unknown[], rasterCalls: 0 };

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
    rasterizePageWithRedactions: (_s: unknown, _p: unknown, _e: unknown, target: PDFDocument) => {
      state.rasterCalls++;
      target.addPage([300, 400]); // the burn itself is pinned elsewhere; here only WHETHER the page is rasterised
      return Promise.resolve();
    },
  };
});
const { ExportService } = await import('../../src/export/exportService');

const SECRET = 'TOPSECRET-4242';
const HEX = Buffer.from(SECRET).toString('hex').toUpperCase(); // pdf-lib's drawText writes a hex string

async function sourceBytes(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const p = d.addPage([300, 400]);
  p.drawText(SECRET, { x: 40, y: 300, size: 14, font: await d.embedFont(StandardFonts.Helvetica) });
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

async function exportWith(path: 'pdf' | 'page', duringLoad: (() => void) | null) {
  state.duringLoad = duringLoad;
  state.rasterCalls = 0;
  state.elements = [{ ...redaction }];
  state.pages = [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }];
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

  it('a page added to the document mid-export (an undo of a delete) is not exported', async () => {
    const restore = () => { state.pages.push({ id: 'p2', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }); };
    expect(await exportWith('pdf', restore)).toEqual(SAFE);
  });
});
