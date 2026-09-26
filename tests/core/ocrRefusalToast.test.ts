// @vitest-environment jsdom
/**
 * WS7 round 15 (completeness P3): the searchable OCR layer is built with pdf-lib, so a load-guard refusal
 * reaches `PDFTurboApp.runOcr` — which showed it as "OCR failed — please try again", a retry that can never
 * work. Driven on a prototype-only instance, the same technique as `signRectPrefill.test.ts`: `ui` and
 * `reportError` are prototype getters, so they are shadowed with `defineProperty`.
 */
import { describe, it, expect, vi } from 'vitest';
import { PDFTurboApp } from '../../src/core/pdfTurboApp';
import { PdfXrefMismatchError } from '../../src/utils/pdfLoadGuard';
import { SearchableLayerError } from '../../src/ocr/searchableTextLayer';

function makeApp(failure: unknown) {
  const app = Object.create(PDFTurboApp.prototype) as PDFTurboApp;
  const ui = {
    ocrLangSelect: { value: 'eng' },
    ocrModeSelect: { value: 'searchable' },
    ocrProgress: { value: 0 },
    ocrProgressLabel: document.createElement('div'),
    ocrProgressRow: document.createElement('div'),
    runOcrModal: document.createElement('button'),
    ocrBtn: document.createElement('button'),
  };
  const reportError = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() };
  Object.defineProperty(app, 'ui', { value: ui });
  Object.defineProperty(app, 'reportError', { value: reportError });
  Object.assign(app as unknown as Record<string, unknown>, {
    _ocrHandler: { run: vi.fn(() => Promise.reject(failure)) },
    closeOcrModal: vi.fn(),
  });
  return { app, reportError, ui };
}

describe('runOcr — a load-guard refusal is shown as a refusal', () => {
  it('the searchable layer over a refused source', async () => {
    const err = new PdfXrefMismatchError(['5 0 R']);
    const { app, reportError, ui } = makeApp(err);
    await app.runOcr();
    expect(reportError.error).toHaveBeenCalledWith('toast.pdfLoadRefused', err);
    expect(ui.runOcrModal.disabled).toBe(false);
  });

  it('any other failure keeps "OCR failed" (control)', async () => {
    const err = new Error('worker crashed');
    const { app, reportError } = makeApp(err);
    await app.runOcr();
    expect(reportError.error).toHaveBeenCalledWith('toast.ocrFailed', err);
  });

  it('a rotated page keeps its own warning (control)', async () => {
    const { app, reportError } = makeApp(new SearchableLayerError('ROTATED_PAGE'));
    await app.runOcr();
    expect(reportError.warn).toHaveBeenCalledWith('toast.ocrRotatedUnsupported');
    expect(reportError.error).not.toHaveBeenCalled();
  });
});
