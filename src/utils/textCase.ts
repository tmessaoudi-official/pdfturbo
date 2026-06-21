/**
 * Text case transformation utilities
 */

export type TextCaseMode = 'upper' | 'lower' | 'title';

/**
 * Apply a text case transformation.
 * - 'upper': converts to UPPERCASE
 * - 'lower': converts to lowercase
 * - 'title': capitalizes the first letter of each whitespace-delimited word,
 *   preserving original whitespace runs and newlines
 */
export function applyTextCase(text: string, mode: TextCaseMode): string {
  if (mode === 'upper') {
    return text.toUpperCase();
  }

  if (mode === 'lower') {
    return text.toLowerCase();
  }

  // 'title': split on whitespace (capturing groups preserve separators)
  // Each non-whitespace token gets its first char uppercased, rest lowercased
  return text
    .split(/(\s+)/)
    .map((tok) =>
      /\s/.test(tok) || tok.length === 0
        ? tok
        : tok[0].toUpperCase() + tok.slice(1).toLowerCase()
    )
    .join('');
}
