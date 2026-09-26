/**
 * Limits row 12 (B6) — which of two translated labels the OCR progress row shows.
 *
 * tesseract.js reports a `status` string with every progress event. Its values are engine internals, not an
 * API (7.0.0 emits 'loading tesseract core', 'initializing tesseract', 'loading language traineddata',
 * 'initializing api' and 'recognizing text'), so they are CLASSIFIED rather than shown: anything about
 * loading or initialising is the model phase, recognition is the recognition phase, and anything else
 * returns `null` so the caller keeps the label it already shows. A renamed status therefore degrades to a
 * slightly stale label — never to a raw English string in a French UI, never to an empty one.
 * `tests/ocr/ocrStatus.test.ts` reads the installed engine's strings and fails if one stops classifying.
 */
export const OCR_LABEL_LOADING = 'progress.ocrLoadingModel';
export const OCR_LABEL_RECOGNIZING = 'progress.ocrRecognizing';

export function ocrStatusLabelKey(status: string): typeof OCR_LABEL_LOADING | typeof OCR_LABEL_RECOGNIZING | null {
  if (/recogni[sz]/i.test(status)) return OCR_LABEL_RECOGNIZING;
  if (/load|initiali[sz]/i.test(status)) return OCR_LABEL_LOADING;
  return null;
}
