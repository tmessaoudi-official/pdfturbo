/**
 * OCR language support + validation — Agent O.
 *
 * Pure module (no tesseract.js import). Defines the curated set of OCR
 * languages the UI offers and validates/normalizes user-supplied codes before
 * they reach the engine. Tesseract uses ISO-639-2/T 3-letter codes; multiple
 * languages are joined with "+" (e.g. "eng+fra").
 */

/** One selectable OCR language: the tesseract code + the locale key for its label. */
export interface OcrLanguageDef {
  /** ISO-639-2/T 3-letter tesseract code, e.g. "eng". */
  code: string;
  /** Whether the script is right-to-left (Arabic) — UI hint only. */
  rtl: boolean;
}

/**
 * Curated language set. Kept small on purpose — each language is a separate
 * traineddata file fetched at runtime (~1–15 MB each), so the UI offers a
 * focused list rather than all 100+ tesseract languages. Matches the app's
 * own EN/FR/AR locale trio plus a few common Latin-script languages.
 */
export const OCR_LANGUAGES: readonly OcrLanguageDef[] = [
  { code: 'eng', rtl: false },
  { code: 'fra', rtl: false },
  { code: 'ara', rtl: true },
  { code: 'deu', rtl: false },
  { code: 'spa', rtl: false },
  { code: 'ita', rtl: false },
  { code: 'por', rtl: false },
  { code: 'nld', rtl: false },
] as const;

/** Default language when none is chosen — matches the app's default locale. */
export const DEFAULT_OCR_LANGUAGE = 'eng';

/** Single 3-letter code shape (lowercase a–z, exactly 3 chars). */
const _SINGLE_CODE_RE = /^[a-z]{3}$/;

/** Set of supported single codes, for O(1) membership checks. */
const _SUPPORTED = new Set<string>(OCR_LANGUAGES.map((l) => l.code));

/**
 * True when `code` is a single supported tesseract language code.
 * Case-insensitive; does NOT accept "+"-joined lists (use `isValidLanguage`).
 */
export function isSupportedLanguage(code: string): boolean {
  return _SUPPORTED.has(code.trim().toLowerCase());
}

/**
 * Normalize a raw language string into tesseract's canonical form:
 *   - lowercased, trimmed
 *   - "+"-separated parts trimmed individually, empties dropped
 *   - duplicate codes removed (preserving first-seen order)
 *
 * Does NOT validate membership — pair with `isValidLanguage` for that.
 * Returns "" for input that contains no usable parts.
 */
export function normalizeLanguageCode(raw: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const part of raw.toLowerCase().split('+')) {
    const p = part.trim();
    if (p.length === 0 || seen.has(p)) continue;
    seen.add(p);
    parts.push(p);
  }
  return parts.join('+');
}

/**
 * True when every "+"-joined part of `raw` is a well-formed AND supported
 * tesseract code. Empty / malformed / unsupported input returns false.
 * This is the gate the engine applies before loading any language data.
 */
export function isValidLanguage(raw: string): boolean {
  const normalized = normalizeLanguageCode(raw);
  if (normalized.length === 0) return false;
  return normalized
    .split('+')
    .every((p) => _SINGLE_CODE_RE.test(p) && _SUPPORTED.has(p));
}

/**
 * Coerce any input to a usable, supported language string. Returns the
 * normalized value when valid, otherwise falls back to `DEFAULT_OCR_LANGUAGE`.
 * Used to harden the engine entry point against bad UI state.
 */
export function resolveLanguage(raw: string | undefined | null): string {
  if (raw === null || raw === undefined) return DEFAULT_OCR_LANGUAGE;
  const normalized = normalizeLanguageCode(raw);
  return isValidLanguage(normalized) ? normalized : DEFAULT_OCR_LANGUAGE;
}
