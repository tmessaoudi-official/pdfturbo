/**
 * findReplace — pure matching core for the DOCX editor's find/replace. Matches are
 * computed PER TEXTBLOCK over the block's flattened `textContent`, so a query can
 * span multiple runs/marks (e.g. half-bold). Each match carries ProseMirror document
 * positions, so the plugin can decorate and replace without re-deriving geometry.
 *
 * Ceiling: matches never cross a textblock (paragraph) boundary; regex `^`/`$`
 * anchor per block, not per document.
 */
import type { Node as PMNode } from 'prosemirror-model';

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface FindMatch {
  /** ProseMirror doc position, inclusive. */
  from: number;
  /** ProseMirror doc position, exclusive. */
  to: number;
  /** Regex capture groups (regex mode only). */
  groups?: string[];
}

export type FindResult =
  | { ok: true; matches: FindMatch[] }
  | { ok: false; error: 'invalid-regex' | 'empty-query' };

const WORD = /\w/;
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch);
}

interface BlockHit {
  start: number;
  end: number;
  groups?: string[];
}

/** All hits of `query` within a single block string. May throw on invalid regex. */
function matchBlock(text: string, query: string, opts: FindOptions): BlockHit[] {
  const out: BlockHit[] = [];
  if (opts.regex) {
    const pattern = opts.wholeWord ? `\\b(?:${query})\\b` : query;
    const re = new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi'); // may throw → caller catches
    for (let mm = re.exec(text); mm !== null; mm = re.exec(text)) {
      out.push({ start: mm.index, end: mm.index + mm[0].length, groups: mm.slice(1) });
      if (mm[0].length === 0) re.lastIndex += 1; // zero-length guard against infinite loop
    }
    return out;
  }
  const hay = opts.caseSensitive ? text : text.toLowerCase();
  const needle = opts.caseSensitive ? query : query.toLowerCase();
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
    const end = i + needle.length;
    if (!opts.wholeWord || (!isWordChar(text[i - 1]) && !isWordChar(text[end]))) {
      out.push({ start: i, end });
    }
  }
  return out;
}

/** Find every match of `query` in `doc`, searched per textblock. */
export function findMatches(doc: PMNode, query: string, opts: FindOptions): FindResult {
  if (query === '') return { ok: false, error: 'empty-query' };
  const matches: FindMatch[] = [];
  try {
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true; // recurse into containers (lists, blockquotes)
      const text = node.textContent;
      if (text) {
        for (const hit of matchBlock(text, query, opts)) {
          // pos = block's own position; +1 skips its open token to reach content.
          matches.push({ from: pos + 1 + hit.start, to: pos + 1 + hit.end, groups: hit.groups });
        }
      }
      return false; // a textblock's children are inline → no nested textblocks
    });
  } catch {
    return { ok: false, error: 'invalid-regex' };
  }
  return { ok: true, matches };
}

/** Expand `$1`/`$2`… capture refs in a replacement template (regex mode). */
export function expandReplacement(template: string, groups: string[] | undefined): string {
  if (!groups) return template;
  return template.replace(/\$(\d+)/g, (_m, d: string) => groups[Number(d) - 1] ?? '');
}
