import type { DocumentModel } from './documentModel';
import type { PDFElement } from '../elements/annotationElement';
import type { TextElement } from '../elements/textElement';
import type { CommentElement } from '../elements/commentElement';
import type { TextSearchHandler, MatchResult } from '../handlers/textSearchHandler';

export type { MatchResult };

export interface SearchContext {
  documentModel: DocumentModel;
  elements: PDFElement[];
  textSearchHandler: TextSearchHandler;
  zoomScale: number;
}

export class SearchManager {
  caseSensitive = false;
  regex = false;

  private _matches: MatchResult[] = [];
  private _index = -1;
  private _gen = 0;

  get matches(): readonly MatchResult[] { return this._matches; }
  get currentIndex(): number { return this._index; }
  get currentMatch(): MatchResult | null { return this._matches[this._index] ?? null; }
  get count(): number { return this._matches.length; }

  clear(): void {
    this._matches = [];
    this._index = -1;
  }

  next(): void {
    if (!this._matches.length) return;
    this._index = (this._index + 1) % this._matches.length;
  }

  prev(): void {
    if (!this._matches.length) return;
    this._index = (this._index - 1 + this._matches.length) % this._matches.length;
  }

  /**
   * Run a full search across the WHOLE document (G13). Returns false if the
   * search was superseded by a newer call (stale generation) before it could
   * complete.
   *
   * Matches are collected in document order — page order, then in-page order:
   * for every page that has a source PDF we render the pdf.js text layer and
   * search it; overlay text/comment elements are matched on every page
   * (including blank/source-less pages, which the pdf.js pass skips).
   *
   * Cost note: a large document means one `getTextContent` call per source
   * page. That is acceptable for an explicit find — pdf.js caches per page and
   * `textSearchHandler` keeps an LRU of decoded text items — so no extra
   * caching infra is added here; we just loop.
   */
  async run(query: string, ctx: SearchContext): Promise<boolean> {
    const myGen = ++this._gen;
    this._matches = [];
    this._index = -1;

    if (!query.trim() || ctx.documentModel.pages.length === 0) return true;

    // pdf.js text-layer pass — every page that has a source PDF, in page order.
    for (const docPage of ctx.documentModel.pages) {
      const src = ctx.documentModel.sourcePdfs.get(docPage.sourcePdfId);
      if (!src) continue; // blank / source-less page — overlay-only (handled below)

      const page = await src.doc.getPage(docPage.sourcePageNum);
      if (myGen !== this._gen) return false; // superseded mid-async → bail promptly
      await ctx.textSearchHandler.buildIndex(page, docPage.id);
      if (myGen !== this._gen) return false;

      // Each page uses its OWN rotation (source rotate + user rotation).
      const effectiveRotation = ((page.rotate + (docPage.rotation ?? 0)) % 360 + 360) % 360;
      const viewport = page.getViewport({ scale: ctx.zoomScale, rotation: effectiveRotation });
      const pageMatches = ctx.textSearchHandler.search(query, docPage.id, viewport, ctx.zoomScale, {
        caseSensitive: this.caseSensitive,
        useRegex: this.regex,
      });
      this._matches.push(...pageMatches); // already pageId-tagged
    }

    // Overlay text boxes and comments — matched on EVERY page (incl. blank).
    for (const docPage of ctx.documentModel.pages) {
      for (const el of ctx.elements) {
        if (el.pageId !== docPage.id) continue;
        if (el.type === 'text') {
          const te = el as TextElement;
          if (te.text && this._matchesQuery(te.text, query))
            this._matches.push({ pageId: docPage.id, x: te.x, y: te.y, width: te.width, height: te.height, elementId: te.id });
        } else if (el.type === 'comment') {
          const ce = el as CommentElement;
          if (ce.text && this._matchesQuery(ce.text, query))
            this._matches.push({ pageId: docPage.id, x: ce.x, y: ce.y, width: ce.width, height: ce.height, elementId: ce.id });
        }
      }
    }

    if (this._matches.length > 0) this._index = 0;
    return true;
  }

  private _matchesQuery(text: string, query: string): boolean {
    if (this.regex) {
      if (!isSafeSearchRegex(query)) return false;
      try { return new RegExp(query, this.caseSensitive ? '' : 'i').test(text); } catch { return false; }
    }
    const haystack = this.caseSensitive ? text : text.toLowerCase();
    return haystack.includes(this.caseSensitive ? query : query.toLowerCase());
  }
}

/** Guard against catastrophic backtracking (ReDoS). Rejects patterns that are
 *  too long or contain nested quantifier structures known to cause exponential
 *  backtracking in V8's non-backtracking NFA. Shared with overlay find&replace. */
export function isSafeSearchRegex(pattern: string): boolean {
  if (pattern.length > 200) return false;
  // Nested quantifiers: (a+)+ / (a*)* / (a+)? etc.
  if (/\([^)]*[+*][^)]*\)[+*?]/.test(pattern)) return false;
  // Alternation inside repeated group: (a|b)+
  if (/\([^)]*\|[^)]*\)[+*]/.test(pattern)) return false;
  return true;
}
