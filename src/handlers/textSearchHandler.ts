import { isArabicText, reverseRtlText } from '../utils/flowDoc';

export interface MatchResult {
  pageId: string;
  x: number; // scale=1 canvas coords
  y: number;
  width: number;
  height: number;
}

interface RawTextItem {
  str: string;
  transform: number[]; // [a,b,c,d,tx,ty] — tx/ty are baseline position in PDF user space
  width: number;       // advance width in PDF user space units
  height: number;      // approximate font height in PDF user space units
}

// Inline 2×3 affine transform — avoids relying on pdfjsLib.Util TS types
function applyTransform(p: [number, number], m: number[]): [number, number] {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

interface LogicalLineToken { itemIndex: number; start: number; end: number; }
export interface LogicalLine { text: string; tokens: LogicalLineToken[]; rtl: boolean; }

function _median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Reconstruct per-LINE logical text from per-glyph text items, with a token map back to
 * source items. pdf.js v6 splits Arabic into ONE item per glyph in VISUAL (L→R) order as
 * presentation forms, so a logical multi-glyph query never fits a single `item.str` — the
 * per-item matcher in `search()` finds nothing. This groups items into rows by baseline y,
 * orders each row into logical reading order (RTL → x-descending), folds each glyph to its
 * base letter (`reverseRtlText` = codepoint-reverse + NFKC), infers word spaces from x-gaps,
 * and records each item's [start,end) offset in the line so a match can be mapped to the
 * covering items' union box. Pure → jsdom-testable.
 *
 * Ordering rule (verified against real pdf.js v6 output): SINGLE-glyph items are emitted in
 * VISUAL position order (their reading order is recovered by sorting on x), but MULTI-char
 * items keep their NATIVE source (LOGICAL) char order (e.g. the trailing "لام" of "السلام" is
 * one item, chars in logical order). So we order items by reading position (RTL → x-descending)
 * and fold each item with NFKC ONLY — never reverse an item's internal chars (that scrambled
 * multi-char items, the "السلام"→"لسمال" bug). Special multi-glyph ligatures whose item text is
 * itself reordered by the shaper (e.g. "الله") remain a documented ceiling.
 */
export function buildLogicalLines(
  items: ReadonlyArray<{ str: string; transform: number[]; width: number; height: number }>,
): LogicalLine[] {
  const idx = items.map((it, i) => ({ it, i })).filter((x) => x.it.str.length > 0);
  if (!idx.length) return [];

  const medianH = _median(idx.map((x) => x.it.height).filter((h) => h > 0)) || 10;
  const medianW = _median(idx.map((x) => x.it.width).filter((w) => w > 0)) || medianH * 0.5;
  const rowTol = Math.max(3, medianH * 0.6);

  // Cluster into rows by baseline y (transform[5]); PDF y grows upward → top row = highest y.
  const byY = [...idx].sort((a, b) => b.it.transform[5] - a.it.transform[5] || a.it.transform[4] - b.it.transform[4]);
  const rows: { it: { str: string; transform: number[]; width: number; height: number }; i: number }[][] = [];
  for (const cell of byY) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].it.transform[5] - cell.it.transform[5]) <= rowTol) row.push(cell);
    else rows.push([cell]);
  }

  return rows.map((row) => {
    const byX = [...row].sort((a, b) => a.it.transform[4] - b.it.transform[4]); // visual L→R
    const rtlVotes = byX.reduce((n, c) => n + (isArabicText(c.it.str) ? 1 : 0), 0);
    const rtl = rtlVotes * 2 > byX.length;
    const order = rtl ? [...byX].reverse() : byX; // logical reading order
    let text = '';
    const tokens: LogicalLineToken[] = [];
    for (let k = 0; k < order.length; k++) {
      if (k > 0) {
        const a = order[k - 1].it, b = order[k].it;
        const left = a.transform[4] <= b.transform[4] ? a : b;
        const right = a.transform[4] <= b.transform[4] ? b : a;
        if (right.transform[4] - (left.transform[4] + left.width) > medianW * 0.4) text += ' ';
      }
      const piece = order[k].it.str.normalize('NFKC'); // order (not internal reversal) gives logical
      const start = text.length;
      text += piece;
      tokens.push({ itemIndex: order[k].i, start, end: text.length });
    }
    return { text, tokens, rtl };
  });
}

export class TextSearchHandler {
  // Cache raw text items per pageId (viewport-independent)
  private _cache = new Map<string, RawTextItem[]>();
  private static readonly MAX_CACHE_SIZE = 20;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async buildIndex(page: any, pageId: string): Promise<void> {
    if (this._cache.has(pageId)) {
      // LRU promotion: move to end of Map insertion order
      const items = this._cache.get(pageId) as RawTextItem[];
      this._cache.delete(pageId);
      this._cache.set(pageId, items);
      return;
    }
    // Evict oldest entry if at capacity
    if (this._cache.size >= TextSearchHandler.MAX_CACHE_SIZE) {
      const oldestKey = this._cache.keys().next().value as string;
      this._cache.delete(oldestKey);
    }
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = content.items.filter((item: any) => typeof item.str === 'string' && item.str.length > 0) as RawTextItem[];
    this._cache.set(pageId, items);
  }

  /** Search the current page. Returns match positions in scale=1 canvas coordinates. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  search(query: string, pageId: string, viewport: any, currentScale: number, opts: { caseSensitive?: boolean; useRegex?: boolean } = {}): MatchResult[] {
    if (!query.trim()) return [];
    const items = this._cache.get(pageId);
    if (!items) return [];

    const caseSensitive = opts.caseSensitive ?? false;
    const useRegex      = opts.useRegex ?? false;
    let pattern: RegExp;
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      pattern = useRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch { return []; }

    // Arabic / presentation-form fallback (#6b): pdf.js returns RTL source text as
    // VISUAL-order, pre-shaped PRESENTATION-FORM glyphs, but the user types LOGICAL-order
    // BASE letters — so the raw `pattern` above never matches Arabic. `normPattern` matches
    // an NFKC-normalized query (non-global → safe for boolean `.test`) against the
    // reordered/normalized item text below.
    const normQuery = query.normalize('NFKC');
    let normPattern: RegExp | null = null;
    try {
      const nflags = caseSensitive ? '' : 'i';
      normPattern = useRegex
        ? new RegExp(normQuery, nflags)
        : new RegExp(normQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), nflags);
    } catch { normPattern = null; }

    const results: MatchResult[] = [];
    const vt = viewport.transform as number[];

    for (const item of items) {
      const canvasPt  = applyTransform([item.transform[4], item.transform[5]], vt);
      const scaleInVp = Math.hypot(vt[0], vt[1]) || currentScale;
      const totalW    = item.width * scaleInVp;
      const charW     = totalW / (item.str.length || 1);
      const h         = item.height * scaleInVp;
      const y         = canvasPt[1] - h * 0.9;

      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      let rawMatched = false;
      while ((m = pattern.exec(item.str)) !== null) {
        rawMatched = true;
        const matchX = canvasPt[0] + m.index * charW;
        const matchW = Math.max(charW, m[0].length * charW);
        results.push({
          pageId,
          x:      matchX / currentScale,
          y:      y      / currentScale,
          width:  matchW / currentScale,
          height: h      / currentScale,
        });
        if (m[0].length === 0) { pattern.lastIndex++; } // guard against zero-length match infinite loop
      }

      // Arabic / ligature fallback — only when the raw (visual/presentation-form) pass found
      // nothing. Test the normalized query against the logical reorder (reverseRtlText: visual→
      // logical + presentation-form→base) and the plain NFKC fold (single glyphs / Latin
      // ligatures like ﬁ). On a hit, highlight the WHOLE item: sub-character RTL positioning is
      // unreliable because the visual glyph index ≠ logical character index (documented partial).
      if (!rawMatched && normPattern && !isArabicText(normQuery)) {
        const reordered = reverseRtlText(item.str);
        const nfkc      = item.str.normalize('NFKC');
        const hit =
          (reordered !== item.str && normPattern.test(reordered)) ||
          (nfkc !== item.str && nfkc !== reordered && normPattern.test(nfkc));
        if (hit) {
          results.push({
            pageId,
            x:      canvasPt[0] / currentScale,
            y:      y           / currentScale,
            width:  totalW      / currentScale,
            height: h           / currentScale,
          });
        }
      }
    }

    // Arabic cross-item line pass. pdf.js splits Arabic into per-glyph items, so a multi-glyph
    // logical query never fits a single item.str — the per-item passes above find nothing.
    // Reconstruct logical line text spanning items (`buildLogicalLines`) and match there,
    // mapping each match back to its covering items' union box. Gated to Arabic queries: Latin
    // is fully served per-item above, and this gate prevents double-counting Latin matches.
    if (normPattern && isArabicText(normQuery)) {
      const gflags = (caseSensitive ? '' : 'i') + 'g';
      let lineRe: RegExp;
      try {
        lineRe = useRegex
          ? new RegExp(normQuery, gflags)
          : new RegExp(normQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), gflags);
      } catch { lineRe = null as unknown as RegExp; }
      const scaleInVp = Math.hypot(vt[0], vt[1]) || currentScale;
      if (lineRe) {
        for (const line of buildLogicalLines(items)) {
          if (!line.rtl || !line.text) continue;
          lineRe.lastIndex = 0;
          let lm: RegExpExecArray | null;
          while ((lm = lineRe.exec(line.text)) !== null) {
            const s = lm.index, e = lm.index + lm[0].length;
            if (lm[0].length === 0) { lineRe.lastIndex++; continue; }
            let minX = Infinity, minY = Infinity, maxR = -Infinity, maxB = -Infinity, found = false;
            for (const tok of line.tokens) {
              if (tok.start >= e || tok.end <= s) continue; // no overlap with [s,e)
              const it = items[tok.itemIndex];
              const cp = applyTransform([it.transform[4], it.transform[5]], vt);
              const w = it.width * scaleInVp;
              const hh = it.height * scaleInVp;
              const yy = cp[1] - hh * 0.9;
              minX = Math.min(minX, cp[0]); minY = Math.min(minY, yy);
              maxR = Math.max(maxR, cp[0] + w); maxB = Math.max(maxB, yy + hh);
              found = true;
            }
            if (found) {
              results.push({
                pageId,
                x:      minX / currentScale,
                y:      minY / currentScale,
                width:  (maxR - minX) / currentScale,
                height: (maxB - minY) / currentScale,
              });
            }
          }
        }
      }
    }
    return results;
  }

  clearCache(): void {
    this._cache.clear();
  }

  invalidatePage(pageId: string): void {
    this._cache.delete(pageId);
  }
}
