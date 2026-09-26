/**
 * A6 — a failed thumbnail render of a REDACTED page fails closed.
 *
 * `renderThumbnailWithOverlays` used to catch everything and return null, and null tells the thumbnail
 * panel "no overlays here, use the plain source raster" — so a redacted page whose composite failed was
 * shown on screen WITHOUT its burn. It now rejects when the page carries a redaction (the panel then
 * shows "preview unavailable"), and keeps resolving null for an unredacted page, whose plain raster
 * hides nothing. Each rejection case has an unredacted twin, so "it throws" cannot pass because every
 * failure now throws.
 */
import { describe, it, expect } from 'vitest';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { TextElement } from '../../src/elements/textElement';
import { RedactionElement } from '../../src/elements/redactionElement';
import type { PDFElement } from '../../src/elements/annotationElement';

function service(elements: PDFElement[], sourcePdfId = 'blank'): { svc: ExportService; silenced: unknown[] } {
  const silenced: unknown[] = [];
  const ctx = {
    documentModel: {
      pageCount: 1, currentPageIndex: 0,
      pages: [{ id: 'p1', sourcePdfId, sourcePageNum: 1, rotation: 0, blankWidth: 300, blankHeight: 300 }],
      sourcePdfs: new Map(), watermark: { enabled: false }, bates: { enabled: false },
    },
    elements, formValues: {}, currentFilename: 'x.pdf', exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info() {}, warn() {}, error() {}, silent(e: unknown) { silenced.push(e); } },
    progress: { begin: () => ({ done() {}, failed() {}, update() {}, setFraction() {} }) },
    cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
  } as unknown as IExportContext;
  return { svc: new ExportService(ctx), silenced };
}

const text = (): PDFElement => Object.assign(new TextElement(20, 20, 'p1'), { text: 'hello' }) as unknown as PDFElement;
const redaction = (): PDFElement => new RedactionElement(20, 20, 50, 20, 'p1', '#000000') as unknown as PDFElement;

/** Make the composite fail the way any bake error would. */
function breakBake(svc: ExportService): void {
  (svc as unknown as { _applyOverlaysToPage: () => Promise<void> })._applyOverlaysToPage =
    () => Promise.reject(new Error('bake failed'));
}

describe('A6 — a failed redacted thumbnail never falls back to the plain page', () => {
  it('a redacted page whose composite fails REJECTS (the panel shows "preview unavailable")', async () => {
    const { svc, silenced } = service([text(), redaction()]);
    breakBake(svc);
    await expect(svc.renderThumbnailWithOverlays(0)).rejects.toThrow(/redacted page 1/);
    expect(silenced).toHaveLength(1); // the underlying cause is still reported
  });

  it('CONTROL: the same failure on an unredacted page still resolves null (the plain raster hides nothing)', async () => {
    const { svc } = service([text()]);
    breakBake(svc);
    await expect(svc.renderThumbnailWithOverlays(0)).resolves.toBeNull();
  });

  it('a redacted page whose source document is missing REJECTS instead of resolving null', async () => {
    const { svc } = service([redaction()], 'gone');
    await expect(svc.renderThumbnailWithOverlays(0)).rejects.toThrow(/redacted page 1/);
  });

  it('CONTROL: an unredacted page whose source is missing still resolves null', async () => {
    const { svc } = service([text()], 'gone');
    await expect(svc.renderThumbnailWithOverlays(0)).resolves.toBeNull();
  });

  it('a page with nothing to composite still resolves null without rendering', async () => {
    const { svc } = service([]);
    await expect(svc.renderThumbnailWithOverlays(0)).resolves.toBeNull();
  });
});
