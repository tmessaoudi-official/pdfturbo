/**
 * Text-script primitives shared by the flow export, copy, search, true-edit and the overlay: Arabic detection, line
 * direction by letters, logical word order and producer bracket mirroring, and the word-space rule (moved verbatim from
 * utils/flowDoc.ts, architecture step 2; `letterCount` is now exported because flowDoc still uses it).
 */
import { logicalItemOrder, mirroredChar, visualToLogical } from './bidi';

// Insert a space when the horizontal gap exceeds this fraction of the font size.
const SPACE_GAP = 0.15;

/**
 * Whether a word space belongs between two consecutive words in reading order, given the empty gap between their
 * boxes: wider than `SPACE_GAP` of the smaller font size, and neither side already carries whitespace. The one rule the
 * DOCX export and the edit-text prefill share (limits row 51 — the prefill joined with '' and dropped it).
 */
export function needsWordSpace(gap: number, prev: { text: string; size: number }, next: { text: string; size: number }): boolean {
  return gap > SPACE_GAP * Math.min(prev.size, next.size) && !/\s$/.test(prev.text) && !/^\s/.test(next.text);
}

/** Unicode ranges that are Arabic script (block, supplement, extended-A, presentation forms). */
const _ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** True when the string contains any Arabic-script codepoint. */
export function isArabicText(s: string): boolean {
  return _ARABIC_RE.test(s);
}

/**
 * Reverse a string by codepoint (surrogate-pair-safe) and NFKC-normalize the result — the text search's FALLBACK
 * match only (`textSearchHandler`), tried after a raw miss. The export does NOT use it since limits row 19: pdf.js
 * already returns every RTL item in logical order (`runBidiTransform` runs UAX#9 L2 on each text chunk,
 * pdf.worker.mjs), so reversing it spelled every Arabic word backwards in DOCX / Markdown / text. A genuinely mixed
 * Arabic+Latin string gets char-level bidi instead of a blanket reversal.
 */
export function reverseRtlText(s: string): string {
  if (isArabicText(s) && /[A-Za-z0-9]/.test(s)) {
    return visualToLogical(s, 'rtl').normalize('NFKC');
  }
  return [...s].reverse().join('').normalize('NFKC');
}

/** Letters in a word — the strong characters its pdf.js `dir` speaks for. Digits, punctuation and spaces are not. */
export function letterCount(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

/**
 * The base direction of a line or paragraph: RTL when its RTL items carry more LETTERS than its LTR ones. Counting
 * letters, not items, is limits row 19: `النص (RTL) هنا` is two Arabic items and three Latin/punctuation ones, and an
 * item majority read it left-to-right. `null` when nothing carries a letter (a line of digits or punctuation).
 */
export function letterDirection(parts: ReadonlyArray<{ text: string; rtl: boolean }>): boolean | null {
  let r = 0, l = 0;
  for (const p of parts) {
    const n = letterCount(p.text);
    if (p.rtl) r += n; else l += n;
  }
  return r + l === 0 ? null : r > l;
}

/**
 * The direction of a text-layer ROW of per-glyph spans or items (copy, search): RTL when more than half of the spans
 * that carry a letter are Arabic. A span with no letter — a bracket, digits, a full stop — abstains, as a letter-less
 * item does in {@link letterDirection}: counting it against RTL read `النص (RTL) هنا` (two Arabic spans, three others)
 * as English (limits row 43). Arabic marks still vote Arabic; this is a span count, not a letter count, because pdf.js
 * emits Arabic one glyph per span and a letter count would let one long Latin word outvote a whole Arabic line.
 * A row with no letter at all is not RTL.
 */
export function rowIsRtl(texts: readonly string[]): boolean {
  let rtl = 0, voters = 0;
  for (const t of texts) {
    if (isArabicText(t)) { rtl++; voters++; }
    else if (letterCount(t) > 0) voters++;
  }
  return rtl * 2 > voters;
}

/**
 * Order one line's words into LOGICAL reading order. pdf.js returns each item's text already in logical order, so
 * only the ORDER of the items is decided here; their text is left as it is (NFKC-folded when RTL, for presentation
 * forms).
 *
 * The base direction is {@link letterDirection} (falling back to an item majority when no word has a letter). Each
 * word's direction is its pdf.js `dir`, except a NEUTRAL word — no letters and not RTL: brackets, full stops,
 * digits — which takes the direction of its strong neighbours when they agree and the line's otherwise, the line
 * direction standing in past either end (UAX#9 N1/N2 at item granularity). Then {@link logicalItemOrder} applies L2 at
 * item granularity for either base: an Arabic phrase split across two items inside an English line reads right to
 * left, and a Latin run inside an Arabic line stays forward. A neutral that resolved to RTL is marked `rtl`, so it
 * joins the Arabic run it sits in.
 *
 * Not modelled: a producer that draws RTL glyphs in logical order (pdf.js then reverses them into visual order, and
 * its own copy is wrong the same way), explicit embeddings, and bidi inside one item (pdf.js has resolved it).
 */
export function orderLineWords<T extends { x: number; width: number; rtl: boolean; text: string }>(
  words: T[],
  baseRtl?: boolean,
): { words: T[]; rtl: boolean } {
  const byLetters = letterDirection(words);
  const rtl = baseRtl
    ?? byLetters
    ?? (words.length > 0 && words.reduce((n, x) => n + (x.rtl ? 1 : 0), 0) * 2 > words.length);
  const visual = [...words].sort((a, b) => a.x - b.x); // page left→right
  // A word without letters is NEUTRAL whatever its flag says: pdf.js marks Arabic-Indic digits rtl, and this function
  // marks a neutral it resolved to RTL as rtl, so a second pass over its own output (`buildParagraph`'s tiebreak) must
  // not read those back as strong.
  const letterStrong = visual.map(w => (letterCount(w.text) > 0 ? w.rtl : null));
  // UAX#9 W7 at item granularity: a number touching a Latin item belongs to it (`v` + `2.0.0` in an Arabic line is
  // `v2.0.0`, not `2.0.0v` — Chrome draws them as two items).
  const strong = letterStrong.map((d, i) =>
    d === null && /\d/.test(visual[i].text) && (letterStrong[i - 1] === false || letterStrong[i + 1] === false) ? false : d);
  const resolved = strong.map((d, i) => {
    if (d !== null) return d;
    let left: boolean | null = null, right: boolean | null = null;
    for (let k = i - 1; k >= 0 && left === null; k--) left = strong[k];
    for (let k = i + 1; k < strong.length && right === null; k++) right = strong[k];
    const a = left ?? rtl, b = right ?? rtl;
    return a === b ? a : rtl;
  });
  const dirOf = new Map(visual.map((w, i) => [w, resolved[i]]));
  const ordered = logicalItemOrder(visual, w => dirOf.get(w) as boolean, rtl)
    .map(w => (dirOf.get(w) ? { ...w, rtl: true, text: w.text.normalize('NFKC') } : { ...w, rtl: false }));
  return { words: mirrorShapeBrackets(ordered), rtl };
}

const OPENING = new Set(['(', '[', '{']);
const CLOSING = new Set([')', ']', '}']);

/** True when the brackets in `text` never close before they open and all close. */
function bracketsBalanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (OPENING.has(ch)) depth++;
    else if (CLOSING.has(ch) && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Producers disagree on what a mirrored bracket glyph MEANS. In an RTL run the glyph drawn for a logical `(` looks like
 * `)`; LibreOffice's ToUnicode maps it to the logical `(`, Chrome's (arabic-allcases.pdf) to the shape `)`. pdf.js
 * mirrors nothing. So a line whose logical bracket order closes before it opens (`)RTL(`) and balances once its
 * RTL-placed bracket-only items are mirrored came from a shape-mapping producer, and those items are mirrored;
 * a line that already balances is left alone. A bracket glued inside a larger LTR item cannot be reached here.
 */
export function mirrorShapeBrackets<T extends { rtl: boolean; text: string }>(words: T[]): T[] {
  const joined = words.map(w => w.text).join('');
  if (!/[()[\]{}]/.test(joined) || bracketsBalanced(joined)) return words;
  const isBracketOnly = (t: string) => /^[\s()[\]{}]+$/.test(t);
  const mirrored = words.map(w => (w.rtl && isBracketOnly(w.text)
    ? { ...w, text: [...w.text].map(c => (OPENING.has(c) || CLOSING.has(c) ? mirroredChar(c) ?? c : c)).join('') }
    : w));
  return bracketsBalanced(mirrored.map(w => w.text).join('')) ? mirrored : words;
}
