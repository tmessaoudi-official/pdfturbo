import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { isArabicText } from './flowDoc';
import { reconstructLogicalText, type SpanGeom } from './rtlClipboard';
import { isAllowedUrlScheme } from './urlScheme';

type AnnRecord = { subtype: string; url?: string; rect: [number, number, number, number] };

export class TextLayerManager {
  private readonly _container: HTMLElement;
  private _textDiv: HTMLElement | null = null;
  private _linkDiv: HTMLElement | null = null;
  private _textLayer: pdfjsLib.TextLayer | null = null;
  private _gen = 0;

  constructor(container: HTMLElement) {
    this._container = container;
  }

  async render(page: PDFPageProxy, viewport: PageViewport, canvasOffset: { left: number; top: number }): Promise<void> {
    const myGen = ++this._gen;
    this._destroy();

    const textDiv = document.createElement('div');
    textDiv.className = 'textLayer';
    Object.assign(textDiv.style, {
      position: 'absolute',
      left:   `${canvasOffset.left}px`,
      top:    `${canvasOffset.top}px`,
      width:  `${Math.round(viewport.width)}px`,
      height: `${Math.round(viewport.height)}px`,
    });
    // pdfjs-dist v6 sizes the text layer via CSS round() functions that depend on
    // --total-scale-factor. Without this variable the computed width/height is 0.
    textDiv.style.setProperty('--total-scale-factor', `${viewport.scale}`);
    textDiv.style.setProperty('--scale-round-x', '1px');
    textDiv.style.setProperty('--scale-round-y', '1px');
    this._container.appendChild(textDiv);
    this._textDiv = textDiv;
    // #6: rewrite Arabic copies to logical, spaced, base-letter text. pdf.js builds
    // the layer as per-glyph, visual-order, presentation-form spans with no spaces,
    // so a native copy yields un-pasteable garbage; reconstruct from span geometry.
    textDiv.addEventListener('copy', (e) => this._onCopy(e));

    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container: textDiv,
      viewport,
    });
    this._textLayer = textLayer;

    try {
      await textLayer.render();
    } catch {
      return; // cancelled by a newer render call
    }

    if (myGen !== this._gen) return;

    // #6c: align span DOM order with visual order so an Arabic drag-selection
    // highlights without holes (pdf.js emits per-glyph RTL spans whose DOM order
    // isn't monotonic in x). No-op for LTR-dominant pages.
    alignSpanOrderToVisual(textDiv);

    await this._renderLinks(page, viewport, canvasOffset, myGen);
  }

  /**
   * Copy handler (#6): for an Arabic selection, replace the clipboard with logical,
   * spaced, base-letter text reconstructed from the selected glyph spans' geometry.
   * Non-Arabic selections fall through to the browser's native copy (our space-from-
   * gap heuristic must not touch correct LTR text).
   */
  private _onCopy(e: ClipboardEvent): void {
    const sel = window.getSelection();
    const raw = sel?.toString() ?? '';
    if (!raw || !isArabicText(raw) || !this._textDiv || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const spans: SpanGeom[] = [];
    this._textDiv.querySelectorAll('span').forEach((el) => {
      const text = el.textContent ?? '';
      if (!text || !range.intersectsNode(el)) return;
      const r = el.getBoundingClientRect();
      spans.push({ text, left: r.left, right: r.right, top: r.top, height: r.height });
    });
    const logical = reconstructLogicalText(spans);
    if (logical && e.clipboardData) {
      e.clipboardData.setData('text/plain', logical);
      e.preventDefault();
    }
  }

  private async _renderLinks(
    page: PDFPageProxy,
    viewport: PageViewport,
    canvasOffset: { left: number; top: number },
    gen: number
  ): Promise<void> {
    const annotations = (await page.getAnnotations()) as AnnRecord[];
    if (gen !== this._gen) return;

    const linkDiv = document.createElement('div');
    linkDiv.className = 'annotationLayer';
    Object.assign(linkDiv.style, {
      position: 'absolute',
      left:   `${canvasOffset.left}px`,
      top:    `${canvasOffset.top}px`,
      width:  `${Math.round(viewport.width)}px`,
      height: `${Math.round(viewport.height)}px`,
    });

    for (const ann of annotations) {
      // Scheme allowlist (#QA-2026-06-23 P3 #14): the URL comes from an untrusted PDF Link
      // annotation. Skip rendering a clickable <a> for javascript:/data:/file:/etc. — only
      // http/https/mailto (and schemeless) become links; anything else is dropped silently.
      if (ann.subtype !== 'Link' || !ann.url || !isAllowedUrlScheme(ann.url)) continue;

      const vr = [
        ...viewport.convertToViewportPoint(ann.rect[0], ann.rect[1]),
        ...viewport.convertToViewportPoint(ann.rect[2], ann.rect[3])
      ];
      const left = Math.min(vr[0], vr[2]);
      const top  = Math.min(vr[1], vr[3]);
      const w    = Math.abs(vr[2] - vr[0]);
      const h    = Math.abs(vr[3] - vr[1]);
      if (w < 2 || h < 2) continue;

      const a = document.createElement('a');
      a.className = 'linkAnnotation';
      a.href = ann.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      Object.assign(a.style, {
        position: 'absolute',
        left:     `${left}px`,
        top:      `${top}px`,
        width:    `${w}px`,
        height:   `${h}px`,
        cursor:   'pointer',
        display:  'block',
      });
      linkDiv.appendChild(a);
    }

    this._container.appendChild(linkDiv);
    this._linkDiv = linkDiv;
  }

  setPointerEvents(enabled: boolean): void {
    const pe = enabled ? 'auto' : 'none';
    if (this._textDiv) this._textDiv.style.pointerEvents = pe;
    this._linkDiv?.querySelectorAll<HTMLAnchorElement>('.linkAnnotation').forEach(el => {
      el.style.pointerEvents = pe;
    });
  }

  clear(): void {
    this._destroy();
  }

  private _destroy(): void {
    this._textLayer?.cancel();
    this._textLayer = null;
    this._textDiv?.remove();
    this._textDiv = null;
    this._linkDiv?.remove();
    this._linkDiv = null;
  }
}

/**
 * #6c — align text-layer span DOM order with visual reading order (top, then left).
 *
 * pdf.js v6 emits Arabic source text as one per-glyph span each, positioned in
 * visual order but appended to the DOM in an order that is NOT monotonic in x
 * (measured on a real Arabic PDF: 55 ascending / 17 descending x-transitions on a
 * 73-span line). The browser renders a selection as the rectangles of the spans
 * in the DOM range between the two carets, so a contiguous drag selects a
 * DOM-contiguous range that is VISUALLY fragmented — the highlight shows holes
 * (selected glyphs interleaved with unselected ones; ~45% of the band was gaps).
 *
 * Re-appending spans in visual (top, then left) order makes a DOM-contiguous range
 * visually contiguous, so the highlight tracks the drag with only natural word-gap
 * spacing (measured: gaps dropped from 114px → 21px on a 15-glyph range). Spans are
 * absolutely positioned, so reordering is visually invisible and does not move any
 * glyph. Copy (#6) re-sorts by geometry, so its output is unaffected by DOM order;
 * the app's own search/highlight does not depend on pdf.js's findController.
 *
 * Gated to RTL/Arabic-DOMINANT pages: reordering an LTR page by (top, left) would
 * break pdf.js's reading order for multi-column layouts. Returns true if reordered.
 */
export function alignSpanOrderToVisual(container: HTMLElement): boolean {
  const spans = [...container.querySelectorAll<HTMLElement>('span')];
  const withText = spans.filter((s) => (s.textContent ?? '').trim().length > 0);
  if (withText.length < 2) return false;
  // Only reorder RTL/Arabic-dominant pages — an LTR page is already in reading
  // order, and reordering a multi-column LTR layout by (top, left) would read
  // across columns instead of down them.
  const rtl = withText.reduce((n, s) => n + (isArabicText(s.textContent ?? '') ? 1 : 0), 0);
  if (rtl * 2 <= withText.length) return false;
  // Measure once, then re-append in visual order via a single fragment (one reflow).
  const measured = spans.map((s) => {
    const r = s.getBoundingClientRect();
    return { s, t: r.top, l: r.left };
  });
  measured.sort((a, b) => (Math.abs(a.t - b.t) > 3 ? a.t - b.t : a.l - b.l));
  const frag = document.createDocumentFragment();
  for (const m of measured) frag.appendChild(m.s);
  container.appendChild(frag);
  return true;
}
