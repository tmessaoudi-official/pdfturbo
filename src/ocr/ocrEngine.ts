/**
 * OCR engine — Agent O.
 *
 * The ONLY module that touches tesseract.js, and it does so via a DYNAMIC
 * import (`await import('tesseract.js')`) — never a static top-level import.
 * Rationale: tesseract.js ships a multi-MB WASM core plus per-language
 * traineddata fetched at runtime, so it must stay out of the main bundle and
 * load only when the user actually invokes OCR.
 *
 * ── ASSET PATHS (CSP-critical) ────────────────────────────────────────────
 * By default tesseract.js fetches the WASM core, the worker script and each
 * `<lang>.traineddata.gz` from its CDN (jsDelivr). The app's CSP
 * (`connect-src 'self' blob:`) BLOCKS those cross-origin fetches, so the CDN
 * defaults make OCR fail in production. Callers MUST pass `corePath`,
 * `workerPath` and `langPath` pointing at 'self'-served assets (vendored by
 * `scripts/prepare-ocr-assets.mjs`; path-built by `ocrAssetPaths` in the
 * handler). All three are forwarded verbatim to tesseract's worker options.
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

/** Worker options passed to `createWorker` (a subset of tesseract's WorkerOptions). */
export interface TesseractWorkerOptions {
  logger?: (m: { status?: string; progress?: number }) => void;
  /** Local 'self'-served asset paths — required in this app (CSP blocks the CDN). */
  langPath?: string;
  corePath?: string;
  workerPath?: string;
}

/** Output flags telling tesseract WHICH data to return (`recognize`'s 3rd arg). */
export interface TesseractOutputFormats {
  text?: boolean;
  /**
   * Block/word geometry. MUST be true to get per-word boxes: tesseract.js v6+
   * returns ONLY `data.text` by default (`data.blocks` is null), so without this
   * the word layer is empty and OCR adds nothing. Word data lives nested under
   * `data.blocks[].paragraphs[].lines[].words[]` (see the mapper).
   */
  blocks?: boolean;
}

/** A tesseract worker — the API surface we use from `createWorker`. */
export interface TesseractWorker {
  recognize(
    image: OcrImageInput,
    options?: Record<string, unknown>,
    output?: TesseractOutputFormats,
  ): Promise<TesseractRecognizeResult>;
  terminate(): Promise<unknown>;
}

/**
 * Minimal structural type for the slice of tesseract.js v7's API we use. We
 * deliberately do NOT `import type` from 'tesseract.js' so this file stays
 * decoupled from tesseract's full type surface and tests can inject a mock.
 *
 * We use `createWorker` (not the `recognize` convenience) because only the
 * worker's `recognize(image, opts, output)` lets us request `blocks` output —
 * the convenience helper hardcodes `{ text: true }` and so never returns words.
 */
export interface TesseractLike {
  createWorker(
    langs: string,
    oem?: number,
    options?: TesseractWorkerOptions,
  ): Promise<TesseractWorker>;
}

/**
 * Loader seam. In production this dynamic-imports the real module; tests
 * override it via `setTesseractLoader` to inject a mock. The dynamic import is
 * wrapped in a function so it is never evaluated at module-eval time.
 */
let _loadTesseract: () => Promise<TesseractLike> = async () => {
  // Literal dynamic import. Vite code-splits 'tesseract.js' into its own chunk
  // that is fetched only on first OCR use (the heavy WASM core stays out of the
  // main bundle), AND the specifier resolves correctly in BOTH the dev server
  // and the production build.
  //
  // The earlier `import(/* @vite-ignore */ indirectName)` form was wrong: with
  // @vite-ignore + a non-literal specifier, Vite leaves a bare `tesseract.js`
  // specifier in the output, which the browser cannot resolve (no import map)
  // → `Failed to resolve module specifier 'tesseract.js'`, so OCR never loaded.
  // The cast keeps this file decoupled from tesseract's full type surface.
  const mod = (await import('tesseract.js')) as unknown as TesseractLike;
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

  const workerOptions: TesseractWorkerOptions = {};
  if (options.onProgress) {
    const cb = options.onProgress;
    workerOptions.logger = (m) => {
      cb({ status: m.status ?? '', progress: typeof m.progress === 'number' ? m.progress : 0 });
    };
  }
  // Forward local 'self'-served asset paths so tesseract never hits its
  // CSP-blocked CDN defaults (see the ASSET PATHS note above).
  if (options.langPath !== undefined) {
    workerOptions.langPath = options.langPath;
  }
  if (options.corePath !== undefined) {
    workerOptions.corePath = options.corePath;
  }
  if (options.workerPath !== undefined) {
    workerOptions.workerPath = options.workerPath;
  }

  // oem 1 = LSTM-only (matches the *-lstm WASM cores we vendor).
  let worker: TesseractWorker;
  try {
    worker = await Tesseract.createWorker(language, 1, workerOptions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ocr: failed to load engine for language "${language}": ${message}`);
  }

  try {
    // `blocks: true` is REQUIRED — without it tesseract returns only `data.text`
    // and no per-word geometry, so the recognized text layer would be empty.
    const result = await worker.recognize(image, {}, { text: true, blocks: true });
    return mapTesseractResult(result?.data, language);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ocr: recognition failed for language "${language}": ${message}`);
  } finally {
    // Free the WASM worker; a failure to terminate must not mask a result/error.
    try {
      await worker.terminate();
    } catch {
      /* ignore terminate errors */
    }
  }
}
