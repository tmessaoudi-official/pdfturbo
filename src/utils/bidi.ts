/**
 * Shared char-level bidi engine (UAX#9) over bidi-js.
 *   logicalToVisual — user-typed logical text → display (visual) order, brackets mirrored.
 *   visualToLogical — pdf.js visual-order text → logical order (bounded inverse).
 *   visualRuns      — logical text → runs in visual L→R order, each run's text LOGICAL
 *                     (so the overlay shapes Arabic via fontkit and draws Latin LTR).
 *
 * bidi-js is logical→visual; visualToLogical is a strong APPROXIMATION (perfect inversion
 * from visual order alone is impossible). Every call falls back to the raw string on a
 * bidi-js throw — never a regression below prior behavior.
 */
import bidiFactory, { type BidiApi } from 'bidi-js';

export type BidiBase = 'ltr' | 'rtl' | 'auto';

let _bidi: BidiApi | null = null;
function _api(): BidiApi {
  if (!_bidi) _bidi = bidiFactory();
  return _bidi;
}
function _explicit(base: BidiBase): 'ltr' | 'rtl' | null {
  return base === 'auto' ? null : base;
}

/** Logical (typed) text → visual display order, brackets mirrored. */
export function logicalToVisual(text: string, base: BidiBase = 'auto'): string {
  if (!text) return text;
  try {
    const b = _api();
    const levels = b.getEmbeddingLevels(text, _explicit(base));
    return b.getReorderedString(text, levels);
  } catch {
    return text;
  }
}

// Char types that lay out left-to-right inside an RTL line (UAX#9): strong-L plus
// European numbers and their adjacent separators/terminators. AN (Arabic-Indic digits)
// stay RTL.
const _STRONG_LTR = new Set(['L', 'EN']);
const _NEUTRAL = new Set(['WS', 'ON', 'ES', 'ET', 'CS']);

/** First strong character → base direction (UAX#9 P2/P3); defaults RTL. */
function _baseRtl(text: string, base: BidiBase, b: BidiApi): boolean {
  if (base !== 'auto') return base === 'rtl';
  for (const ch of text) {
    const t = b.getBidiCharTypeName(ch);
    if (t === 'L') return false;
    if (t === 'R' || t === 'AL') return true;
  }
  return true;
}

/**
 * Visual-order text → logical order (bounded inverse). LTR-base lines return unchanged.
 * Reverse the whole line, then for each maximal run of LTR-type/neutral chars: if the run
 * contains a strong-LTR char, re-reverse it (recovers embedded Latin words & numbers);
 * otherwise (a pure-neutral run in RTL context) un-mirror its brackets.
 */
export function visualToLogical(text: string, base: BidiBase = 'auto'): string {
  if (!text) return text;
  try {
    const b = _api();
    if (!_baseRtl(text, base, b)) return text; // identity for LTR
    const cps = [...text]; // code points (Arabic/Latin are BMP; non-BMP is a documented edge)
    cps.reverse();
    const typ = cps.map((c) => b.getBidiCharTypeName(c));
    const cand = (i: number): boolean => _STRONG_LTR.has(typ[i]) || _NEUTRAL.has(typ[i]);
    let i = 0;
    while (i < cps.length) {
      if (!cand(i)) {
        i++;
        continue;
      }
      let j = i;
      let hasStrong = false;
      while (j < cps.length && cand(j)) {
        if (_STRONG_LTR.has(typ[j])) hasStrong = true;
        j++;
      }
      if (hasStrong) {
        // Re-reverse only the inner span: boundary WHITESPACE stays put (else an
        // inter-word space migrates to the run's far end). Interior spaces and
        // number separators (ES/ET/CS) ride along inside the reversal.
        let lo = i;
        let hi = j - 1;
        while (lo < hi && typ[lo] === 'WS') lo++;
        while (hi > lo && typ[hi] === 'WS') hi--;
        for (; lo < hi; lo++, hi--) {
          const tmp = cps[lo];
          cps[lo] = cps[hi];
          cps[hi] = tmp;
        }
      } else {
        for (let k = i; k < j; k++) {
          const mirror = b.getMirroredCharacter(cps[k]);
          if (mirror) cps[k] = mirror;
        }
      }
      i = j;
    }
    return cps.join('');
  } catch {
    return text;
  }
}

/**
 * Order visually-L→R items into logical reading order at ITEM granularity (UAX#9 L2):
 * split into maximal same-direction runs, then for an RTL line emit runs right-to-left —
 * RTL-item runs reversed, embedded LTR-item runs kept forward. Item internals are NEVER
 * touched, so multi-char tokens (a logical-order span like "PDF"/"لام") stay verbatim and
 * any token→source map is preserved. Consumed by copy + search.
 */
export function logicalItemOrder<T>(itemsLToR: readonly T[], isRtl: (t: T) => boolean): T[] {
  const runs: T[][] = [];
  for (const it of itemsLToR) {
    const r = isRtl(it);
    const last = runs[runs.length - 1];
    if (last && isRtl(last[0]) === r) last.push(it);
    else runs.push([it]);
  }
  const out: T[] = [];
  for (let s = runs.length - 1; s >= 0; s--) {
    const run = runs[s];
    if (isRtl(run[0])) for (let i = run.length - 1; i >= 0; i--) out.push(run[i]);
    else out.push(...run);
  }
  return out;
}

/** Base paragraph direction (UAX#9 P2/P3 first-strong); defaults 'rtl' when no strong char. */
export function baseDirection(text: string): 'rtl' | 'ltr' {
  try {
    return _baseRtl(text, 'auto', _api()) ? 'rtl' : 'ltr';
  } catch {
    return 'ltr';
  }
}

export interface BidiVisualRun {
  /** The run's LOGICAL substring (RTL runs are NOT pre-reversed — fontkit shapes them). */
  text: string;
  rtl: boolean;
}

/**
 * Logical text → runs in visual left-to-right order. Uses bidi-js reordered indices to
 * place runs; each run's `text` is rebuilt in LOGICAL order so the overlay can shape an
 * Arabic run with fontkit (which itself emits visual glyphs) and draw an LTR run directly.
 * Bracket display-mirroring inside the overlay is a documented residual (fontkit draws the
 * logical glyph); the copy/search/DOCX surfaces handle bracket mirroring.
 */
export function visualRuns(text: string, base: BidiBase = 'auto'): BidiVisualRun[] {
  if (!text) return [];
  try {
    const b = _api();
    const levels = b.getEmbeddingLevels(text, _explicit(base));
    const order = b.getReorderedIndices(text, levels); // visual order of UTF-16 indices
    const out: BidiVisualRun[] = [];
    let cur: { idx: number[]; rtl: boolean } | null = null;
    for (const k of order) {
      const rtl = (levels.levels[k] & 1) === 1;
      if (!cur || cur.rtl !== rtl) {
        cur = { idx: [], rtl };
        out.push({ text: '', rtl });
      }
      cur.idx.push(k);
      // Rebuild this run's LOGICAL text: an RTL run's visual indices descend in logical
      // order, so sort ascending to recover logical; an LTR run's visual order IS logical.
      const sorted = rtl ? [...cur.idx].sort((a, c) => a - c) : cur.idx;
      out[out.length - 1].text = sorted.map((n) => text[n]).join('');
    }
    return out;
  } catch {
    return [{ text, rtl: false }];
  }
}
