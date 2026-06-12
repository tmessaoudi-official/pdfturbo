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
   * Run a full search on the current page. Returns false if the search was
   * superseded by a newer call (stale generation) before it could complete.
   */
  async run(query: string, ctx: SearchContext): Promise<boolean> {
    const myGen = ++this._gen;
    this._matches = [];
    this._index = -1;

    const docPage = ctx.documentModel.currentPage;
    if (!query.trim() || !docPage) return true;

    const src = ctx.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return true;

    const page = await src.doc.getPage(docPage.sourcePageNum);
    await ctx.textSearchHandler.buildIndex(page, docPage.id);
    if (myGen !== this._gen) return false;

    const effectiveRotation = ((page.rotate + (docPage.rotation ?? 0)) % 360 + 360) % 360;
    const viewport = page.getViewport({ scale: ctx.zoomScale, rotation: effectiveRotation });
    this._matches = ctx.textSearchHandler.search(query, docPage.id, viewport, ctx.zoomScale, {
      caseSensitive: this.caseSensitive,
      useRegex: this.regex,
    });

    if (myGen !== this._gen) return false;

    // Also match user-added text boxes and comments on the current page
    for (const el of ctx.elements) {
      if (el.pageId !== docPage.id) continue;
      if (el.type === 'text') {
        const te = el as TextElement;
        if (te.text && this._matchesQuery(te.text, query))
          this._matches.push({ pageId: docPage.id, x: te.x, y: te.y, width: te.width, height: te.height });
      } else if (el.type === 'comment') {
        const ce = el as CommentElement;
        if (ce.text && this._matchesQuery(ce.text, query))
          this._matches.push({ pageId: docPage.id, x: ce.x, y: ce.y, width: ce.width, height: ce.height });
      }
    }

    if (this._matches.length > 0) this._index = 0;
    return true;
  }

  private _matchesQuery(text: string, query: string): boolean {
    if (this.regex) {
      if (!_isSafeRegex(query)) return false;
      try { return new RegExp(query, this.caseSensitive ? '' : 'i').test(text); } catch { return false; }
    }
    const haystack = this.caseSensitive ? text : text.toLowerCase();
    return haystack.includes(this.caseSensitive ? query : query.toLowerCase());
  }
}

/** Guard against catastrophic backtracking (ReDoS). Rejects patterns that are
 *  too long or contain nested quantifier structures known to cause exponential
 *  backtracking in V8's non-backtracking NFA. */
function _isSafeRegex(pattern: string): boolean {
  if (pattern.length > 200) return false;
  // Nested quantifiers: (a+)+ / (a*)* / (a+)? etc.
  if (/\([^)]*[+*][^)]*\)[+*?]/.test(pattern)) return false;
  // Alternation inside repeated group: (a|b)+
  if (/\([^)]*\|[^)]*\)[+*]/.test(pattern)) return false;
  return true;
}
