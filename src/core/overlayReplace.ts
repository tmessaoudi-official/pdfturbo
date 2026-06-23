import { isSafeSearchRegex } from './searchManager';

export interface ReplaceOpts {
  caseSensitive: boolean;
  regex: boolean;
}

/** Escape a string so it is matched literally inside a RegExp. */
function _escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace EVERY occurrence of `query` in `text` with `replacement` for the PDF overlay
 * find & replace feature. Mirrors the find matcher's semantics (case sensitivity + regex toggle):
 *
 * - regex mode: `replacement` supports `$1` capture-group references; an invalid pattern or one
 *   that fails the shared ReDoS guard returns the text UNCHANGED (never throws).
 * - literal mode: `query` and `replacement` are both treated literally (a `$` in the replacement
 *   is NOT a capture ref).
 *
 * An empty query returns the text unchanged. Pure — callers wrap the result in an undoable command.
 */
export function applyReplacement(text: string, query: string, replacement: string, opts: ReplaceOpts): string {
  if (!query) return text;
  const flags = opts.caseSensitive ? 'g' : 'gi';
  if (opts.regex) {
    if (!isSafeSearchRegex(query)) return text;
    try {
      return text.replace(new RegExp(query, flags), replacement);
    } catch {
      return text; // invalid pattern → no-op
    }
  }
  // Literal mode: match the literal query; emit the literal replacement ($ kept literal).
  const re = new RegExp(_escapeRegExp(query), flags);
  return text.replace(re, () => replacement);
}
