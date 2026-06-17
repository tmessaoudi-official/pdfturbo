import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { isArabicText } from './flowDoc';
import { reconstructLogicalText, type SpanGeom } from './rtlClipboard';

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
      if (ann.subtype !== 'Link' || !ann.url) continue;

      const vr = viewport.convertToViewportRectangle(ann.rect);
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
