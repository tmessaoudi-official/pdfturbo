/**
 * OCR core — Agent O. Public entry point.
 *
 * Client-side OCR for scanned/image PDF pages: the parent rasterizes a pdf.js
 * page to a canvas and calls `recognizePage`, which dynamic-imports tesseract.js
 * and returns a `{ words, text, confidence, language }` text layer.
 *
 * Nothing here imports tesseract.js statically — the heavy WASM dependency is
 * loaded lazily inside `recognizePage` (see `ocrEngine.ts`).
 */

export { recognizePage, setTesseractLoader } from './ocrEngine';
export type {
  TesseractLike,
  TesseractWorker,
  TesseractWorkerOptions,
  TesseractOutputFormats,
  TesseractRecognizeResult,
} from './ocrEngine';

export {
  OCR_LANGUAGES,
  DEFAULT_OCR_LANGUAGE,
  isSupportedLanguage,
  isValidLanguage,
  normalizeLanguageCode,
  resolveLanguage,
} from './languages';
export type { OcrLanguageDef } from './languages';

export {
  mapTesseractResult,
  mapWord,
  normalizeBBox,
  clampConfidence,
  flattenBlockWords,
} from './tesseractMapper';
export type {
  RawTesseractPage,
  RawTesseractWord,
  RawTesseractBBox,
  RawTesseractBlock,
  RawTesseractParagraph,
  RawTesseractLine,
} from './tesseractMapper';

export type {
  OcrBBox,
  OcrWord,
  OcrResult,
  OcrProgress,
  OcrProgressCallback,
  OcrImageInput,
  OcrOptions,
} from './ocrTypes';
