import { reverseRtlText } from '../utils/flowDoc';

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
      if (!rawMatched && normPattern) {
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
    return results;
  }

  clearCache(): void {
    this._cache.clear();
  }

  invalidatePage(pageId: string): void {
    this._cache.delete(pageId);
  }
}
