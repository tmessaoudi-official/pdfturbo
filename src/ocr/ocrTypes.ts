/**
 * OCR core types — Agent O.
 *
 * Pure, dependency-free type definitions for the client-side OCR subsystem.
 * Nothing here imports tesseract.js (a multi-MB WASM dependency); the engine
 * (`ocrEngine.ts`) dynamic-imports it at runtime. Keeping the public type
 * surface free of that import means callers can type-check against OCR results
 * without pulling the heavy dependency into the static module graph.
 */

/**
 * Axis-aligned bounding box, in PIXELS of the rasterized page image that was
 * handed to the engine. Origin is top-left (image convention), so:
 *   - x0 < x1, y0 < y1
 *   - (x0, y0) is the top-left corner, (x1, y1) the bottom-right corner.
 *
 * The caller is responsible for mapping these image-space pixels back to PDF
 * user-space (divide by the render scale, flip Y) when building a text layer.
 */
export interface OcrBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A single recognized word with its location and per-word confidence. */
export interface OcrWord {
  /** The recognized text of the word (already trimmed of surrounding whitespace). */
  text: string;
  /** Bounding box in image pixels (top-left origin). */
  bbox: OcrBBox;
  /** Tesseract per-word confidence, 0–100 (higher is better). */
  confidence: number;
}

/** Structured result of running OCR on one page image. */
export interface OcrResult {
  /** Per-word boxes — the basis for a selectable/searchable text layer. */
  words: OcrWord[];
  /** Full recognized text of the page (tesseract's `data.text`, normalized). */
  text: string;
  /** Overall page confidence, 0–100. `null` when tesseract did not report one. */
  confidence: number | null;
  /** ISO-639-2/T language code(s) actually used for this run (e.g. "eng"). */
  language: string;
}

/**
 * Progress event emitted during recognition. Tesseract reports a coarse
 * `status` string plus a `progress` fraction (0–1) for the long phases
 * (loading the WASM core, fetching language data, recognizing).
 */
export interface OcrProgress {
  /** Raw tesseract status, e.g. "loading tesseract core", "recognizing text". */
  status: string;
  /** Fraction complete for the current phase, 0–1. */
  progress: number;
}

/** Callback invoked with each progress event. */
export type OcrProgressCallback = (p: OcrProgress) => void;

/**
 * Accepted page-image inputs. The parent renders a pdf.js page to a canvas and
 * hands the canvas (or a bitmap / blob / data URL) in — the OCR core never
 * touches pdf.js or the DOM beyond reading these image sources, which tesseract
 * accepts directly.
 */
export type OcrImageInput = HTMLCanvasElement | ImageBitmap | Blob | string;

/** Options for a single OCR run. */
export interface OcrOptions {
  /**
   * Language code (ISO-639-2/T, 3-letter, e.g. "eng", "fra", "ara"). May be a
   * "+"-joined list for multi-language pages (e.g. "eng+fra"). Validated and
   * normalized via `languages.ts` before use.
   */
  language: string;
  /** Optional progress callback (tesseract emits frequent events). */
  onProgress?: OcrProgressCallback;
  /**
   * Where tesseract fetches `<lang>.traineddata.gz` from (a directory base; the
   * worker appends `/<lang>.traineddata.gz`). The app passes a local 'self'-served
   * path so OCR works under the strict CSP and fully offline. If omitted,
   * tesseract falls back to its CDN — which the production CSP blocks, so callers
   * in this app MUST supply it (see `ocrAssetPaths`).
   */
  langPath?: string;
  /**
   * Where tesseract loads the WASM core from (a directory containing the
   * `tesseract-core*.wasm.js` variants, or a specific `.js` file). Local
   * 'self'-served path for CSP-safe loading; omitting it falls back to the
   * CDN-blocked default.
   */
  corePath?: string;
  /**
   * URL of the tesseract worker script (`worker.min.js`). Local 'self'-served
   * path so the blob-wrapped worker is fetched same-origin under the CSP;
   * omitting it falls back to the CDN-blocked default.
   */
  workerPath?: string;
}
