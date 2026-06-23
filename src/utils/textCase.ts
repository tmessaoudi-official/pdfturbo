/**
 * Text case transformation utilities
 */

export type TextCaseMode = 'upper' | 'lower' | 'title';

/**
 * Apply a text case transformation.
 * - 'upper': converts to UPPERCASE
 * - 'lower': converts to lowercase
 * - 'title': capitalizes the first letter of each whitespace-delimited word,
 *   preserving original whitespace runs and newlines. The rest of each word is
 *   left UNCHANGED (CSS text-transform:capitalize semantics) so intentional
 *   internal capitals — acronyms ('RGB'), camelCase, brand names ('PDFturbo')
 *   — survive instead of being flattened to lowercase (#QA-2026-06-23 P3 #5).
 */
export function applyTextCase(text: string, mode: TextCaseMode): string {
  if (mode === 'upper') {
    return text.toUpperCase();
  }

  if (mode === 'lower') {
    return text.toLowerCase();
  }

  // 'title': split on whitespace (capturing groups preserve separators).
  // Each non-whitespace token gets ONLY its first char uppercased; the rest is
  // left as-is so intentional internal capitals are preserved (#QA P3 #5).
  return text
    .split(/(\s+)/)
    .map((tok) =>
      /\s/.test(tok) || tok.length === 0
        ? tok
        : tok[0].toUpperCase() + tok.slice(1)
    )
    .join('');
}
