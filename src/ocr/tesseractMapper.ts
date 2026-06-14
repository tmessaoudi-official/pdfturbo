/**
 * Tesseract result mapper — Agent O.
 *
 * Pure transformation from tesseract.js's `recognize()` output into the OCR
 * core's stable `OcrResult` shape. This module does NOT import tesseract.js —
 * it operates on a minimal structural interface (`RawTesseractPage`) that
 * matches tesseract's documented output, so it is fully unit-testable in jsdom
 * without the WASM dependency and is decoupled from tesseract's exact types.
 *
 * Defensive on missing/partial fields: tesseract's `words` array can be absent
 * or contain entries with a missing bbox or confidence depending on the
 * recognition path, so every field is normalized.
 */

import type { OcrBBox, OcrResult, OcrWord } from './ocrTypes';

/** Minimal shape of a tesseract bbox (top-left origin, image pixels). */
export interface RawTesseractBBox {
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
}

/** Minimal shape of a single tesseract word. */
export interface RawTesseractWord {
  text?: string;
  bbox?: RawTesseractBBox;
  confidence?: number;
}

/** Minimal shape of tesseract's `recognize()` `.data` page object. */
export interface RawTesseractPage {
  text?: string;
  confidence?: number;
  words?: RawTesseractWord[];
}

/** Coerce a value to a finite number, falling back to `fallback`. */
function _finite(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/**
 * Normalize a raw bbox into an `OcrBBox`, guaranteeing x0<=x1 and y0<=y1.
 * Missing coordinates default to 0. Swaps inverted corners defensively.
 */
export function normalizeBBox(raw: RawTesseractBBox | undefined): OcrBBox {
  const x0 = _finite(raw?.x0, 0);
  const y0 = _finite(raw?.y0, 0);
  const x1 = _finite(raw?.x1, 0);
  const y1 = _finite(raw?.y1, 0);
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
}

/** Clamp a confidence value into the 0–100 range. */
export function clampConfidence(c: unknown): number {
  const n = _finite(c, 0);
  return Math.max(0, Math.min(100, n));
}

/**
 * Map a single raw tesseract word to an `OcrWord`. Returns `null` when the word
 * has no usable text (empty / whitespace-only) — the caller drops these so the
 * text layer never carries empty boxes.
 */
export function mapWord(raw: RawTesseractWord | undefined): OcrWord | null {
  const text = (raw?.text ?? '').trim();
  if (text.length === 0) return null;
  return {
    text,
    bbox: normalizeBBox(raw?.bbox),
    confidence: clampConfidence(raw?.confidence),
  };
}

/**
 * Map a full tesseract page result into an `OcrResult`.
 *
 * @param page     tesseract's `result.data` object.
 * @param language the (already normalized) language code used for the run.
 */
export function mapTesseractResult(
  page: RawTesseractPage | undefined,
  language: string,
): OcrResult {
  const rawWords = Array.isArray(page?.words) ? page.words : [];
  const words: OcrWord[] = [];
  for (const w of rawWords) {
    const mapped = mapWord(w);
    if (mapped !== null) words.push(mapped);
  }

  const rawConfidence = page?.confidence;
  const hasConfidence = typeof rawConfidence === 'number' && Number.isFinite(rawConfidence);

  return {
    words,
    text: (page?.text ?? '').replace(/\r\n/g, '\n').trimEnd(),
    confidence: hasConfidence ? clampConfidence(rawConfidence) : null,
    language,
  };
}
