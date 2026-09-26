// @vitest-environment jsdom
/**
 * Limits row 12 (B6) — `runOcr` shows WHICH phase OCR is in. It showed a static "Recognizing text…" through
 * the model download too, because the callback was typed `{progress}` and dropped `status`. Driven on a
 * prototype-only instance, as `ocrRefusalToast.test.ts` does.
 */
import { describe, it, expect, vi } from 'vitest';
import { PDFTurboApp } from '../../src/core/pdfTurboApp';
import { initI18n, t } from '../../src/utils/i18n';
import type { OcrRunProgress } from '../../src/handlers/ocrHandler';

function makeApp(events: OcrRunProgress[], seen: string[]) {
  const app = Object.create(PDFTurboApp.prototype) as PDFTurboApp;
  const label = document.createElement('div');
  const ui = {
    ocrLangSelect: { value: 'eng' },
    ocrModeSelect: { value: 'searchable' },
    ocrProgress: { value: 0 },
    ocrProgressLabel: label,
    ocrProgressRow: document.createElement('div'),
    runOcrModal: document.createElement('button'),
    ocrBtn: document.createElement('button'),
  };
  Object.defineProperty(app, 'ui', { value: ui });
  Object.defineProperty(app, 'reportError', { value: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() } });
  Object.assign(app as unknown as Record<string, unknown>, {
    _ocrHandler: {
      run: vi.fn((_l: string, _m: string, cb: (p: OcrRunProgress) => void) => {
        seen.push(label.textContent ?? '');
        for (const e of events) { cb(e); seen.push(label.textContent ?? ''); }
        return Promise.resolve(1);
      }),
    },
    closeOcrModal: vi.fn(),
  });
  return { app, label };
}

describe('runOcr — the progress label follows the engine phase (limits row 12)', () => {
  it('starts on "loading", switches to "recognizing", and keeps the label on an unknown status', async () => {
    await initI18n();
    const seen: string[] = [];
    const { app } = makeApp([
      { status: 'loading language traineddata', progress: 0.5 },
      { status: 'initializing api', progress: 1 },
      { status: 'recognizing text', progress: 0.3 },
      { status: 'some future status', progress: 0.4 },
      { status: 'recognizing text', progress: 1 },
    ], seen);
    await app.runOcr();
    const L = t('progress.ocrLoadingModel'), R = t('progress.ocrRecognizing');
    expect(L).not.toBe(R);
    expect(seen).toEqual([L, L, L, R, R, R]);
  });
});
