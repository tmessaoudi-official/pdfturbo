/**
 * OCR engine — Agent O.
 *
 * The ONLY module that touches tesseract.js, and it does so via a DYNAMIC
 * import (`await import('tesseract.js')`) — never a static top-level import.
 * Rationale: tesseract.js ships a multi-MB WASM core plus per-language
 * traineddata fetched at runtime, so it must stay out of the main bundle and
 * load only when the user actually invokes OCR.
 *
 * ── OFFLINE CAVEAT ────────────────────────────────────────────────────────
 * By default tesseract.js fetches the WASM core and each `<lang>.traineddata.gz`
 * from its CDN (jsDelivr / unpkg) on first use. This means the FIRST OCR run
 * for a given language REQUIRES NETWORK ACCESS. For fully offline operation,
 * pass `langPath` (and a matching `corePath`/`workerPath` at the call site, if
 * bundled) pointing at locally-served assets. For v1 the default CDN fetch is
 * acceptable and is documented as a known requirement.
 *
 * The tesseract module is reached through a swappable loader (`_loadTesseract`)
 * so tests can inject a mock without installing the WASM dependency.
 */

import { resolveLanguage } from './languages';
import { mapTesseractResult, type RawTesseractPage } from './tesseractMapper';
import type { OcrImageInput, OcrOptions, OcrResult } from './ocrTypes';

/**
 * Minimal structural type for the slice of tesseract.js v7's API we use.
 * We deliberately do NOT `import type` from 'tesseract.js' so this file
 * type-checks whether or not the (optional, heavy) dependency is installed,
 * and so the static module graph stays free of it.
 */
export interface TesseractRecognizeResult {
  data: RawTesseractPage;
}

export interface TesseractLike {
  recognize(
    image: OcrImageInput,
    lang: string,
    options?: { logger?: (m: { status?: string; progress?: number }) => void; langPath?: string },
  ): Promise<TesseractRecognizeResult>;
}

/**
 * Loader seam. In production this dynamic-imports the real module; tests
 * override it via `setTesseractLoader` to inject a mock. The dynamic import is
 * wrapped in a function so it is never evaluated at module-eval time.
 */
let _loadTesseract: () => Promise<TesseractLike> = async () => {
  // Dynamic import, resolved at RUNTIME only:
  //   - The module specifier is built indirectly so neither Vite's static
  //     import-analysis nor a bundler eagerly resolves/inlines the heavy WASM
  //     dependency at build time — it loads lazily on first OCR use.
  //   - `/* @vite-ignore */` tells Vite to skip static analysis of this import
  //     (the module is an optional dependency, present at runtime). A non-literal
  //     specifier also means tsc types the import as `any`, so no static
  //     'tesseract.js' type resolution is required in the type-check env either.
  const moduleName = ['tesseract', 'js'].join('.');
  const mod = (await import(/* @vite-ignore */ moduleName)) as unknown as TesseractLike;
  return mod;
};

/**
 * Override the tesseract loader. Test-only seam — call with a mock that returns
 * a `TesseractLike`. Returns the previous loader so a test can restore it.
 */
export function setTesseractLoader(
  loader: () => Promise<TesseractLike>,
): () => Promise<TesseractLike> {
  const prev = _loadTesseract;
  _loadTesseract = loader;
  return prev;
}

/**
 * Run OCR on one rendered page image and return a structured text layer.
 *
 * The caller (parent app) is responsible for rasterizing a pdf.js page to a
 * canvas first (see the wiring spec); this core is DOM/pdf.js-agnostic and only
 * consumes the image source tesseract accepts directly.
 *
 * @param image   canvas / bitmap / blob / data-URL of the rendered page.
 * @param options language code (validated), optional progress callback, langPath.
 * @returns       `{ words, text, confidence, language }`.
 * @throws        Error (prefixed `ocr:`) if recognition fails — caller surfaces it.
 */
export async function recognizePage(
  image: OcrImageInput,
  options: OcrOptions,
): Promise<OcrResult> {
  const language = resolveLanguage(options.language);
  const Tesseract = await _loadTesseract();

  const recognizeOptions: {
    logger?: (m: { status?: string; progress?: number }) => void;
    langPath?: string;
  } = {};

  if (options.onProgress) {
    const cb = options.onProgress;
    recognizeOptions.logger = (m) => {
      cb({ status: m.status ?? '', progress: typeof m.progress === 'number' ? m.progress : 0 });
    };
  }
  if (options.langPath !== undefined) {
    recognizeOptions.langPath = options.langPath;
  }

  try {
    const result = await Tesseract.recognize(image, language, recognizeOptions);
    return mapTesseractResult(result?.data, language);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ocr: recognition failed for language "${language}": ${message}`);
  }
}
