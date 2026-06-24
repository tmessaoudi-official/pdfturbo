import { PDFElement, type ElementJSON } from './annotationElement';
import { baseDirection } from '../utils/bidi';
import { listMarker, type ListType } from '../utils/listMarkers';

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type TextDirection = 'auto' | 'rtl' | 'ltr';

/** Resolve a text element's effective direction: 'auto' → first-strong of its content. */
export function resolveDirection(direction: TextDirection, text: string): 'rtl' | 'ltr' {
  return direction === 'auto' ? baseDirection(text) : direction;
}

export interface TextOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  align?: TextAlign;
  multiline?: boolean;
  backgroundColor?: string;
  lineHeight?: number;
  opacity?: number;
  strokeWidth?: number;
  charSpacing?: number;
  horizontalScale?: number;
  baselineShift?: 'super' | 'sub';
  direction?: TextDirection;
  list?: ListType;
  linkUrl?: string;
}

export class TextElement extends PDFElement {
  text = '';
  fontSize: number;
  color: string;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  align: TextAlign;
  multiline: boolean;
  backgroundColor?: string;
  lineHeight?: number;
  opacity?: number;
  strokeWidth?: number;
  charSpacing?: number;
  horizontalScale?: number;
  baselineShift?: 'super' | 'sub';
  direction: TextDirection;
  list?: ListType;
  linkUrl?: string;

  constructor(x: number, y: number, pageId: string, options: TextOptions = {}) {
    super('text', x, y, options.width ?? 200, options.height ?? 30, pageId);
    this.fontSize = options.fontSize ?? 14;
    this.color = options.color ?? '#000000';
    this.fontFamily = options.fontFamily ?? 'Arial';
    this.bold = options.bold ?? false;
    this.italic = options.italic ?? false;
    this.underline = options.underline ?? false;
    this.strikethrough = options.strikethrough ?? false;
    this.align = options.align ?? 'left';
    this.multiline = options.multiline ?? true;
    this.backgroundColor = options.backgroundColor;
    this.lineHeight = options.lineHeight;
    this.opacity = options.opacity;
    this.strokeWidth = options.strokeWidth;
    this.charSpacing = options.charSpacing;
    this.horizontalScale = options.horizontalScale;
    this.baselineShift = options.baselineShift;
    this.direction = options.direction ?? 'auto';
    this.list = options.list;
    this.linkUrl = options.linkUrl;
  }

  render(_container: HTMLElement, canvasOffset: { left: number; top: number }, scale = 1): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'pdf-element text-element';
    div.dataset.id = String(this.id);
    this.applyStyles(div, canvasOffset, scale);

    const input = this.multiline
      ? document.createElement('textarea')
      : document.createElement('input');
    if (!this.multiline) (input as HTMLInputElement).type = 'text';
    input.value = this.text;
    this._applyInputFormatting(input, scale);

    // List marker gutter (Feature 2): a non-editable column of markers at the box's left
    // edge, kept out of `this.text` (no fragile prefix-and-strip that could eat user content).
    // The input is padded to make room; the gutter shares the input's font metrics.
    const gutter = this.list ? this._buildListGutter(scale) : null;
    if (gutter) {
      input.style.paddingLeft = (this.list === 'ordered' ? 2.0 : 1.4) + 'em';
    }
    input.addEventListener('input', (e) => {
      this.text = (e.target as HTMLInputElement).value;
      if (gutter) this._fillListGutter(gutter);
    });

    div.appendChild(input);
    if (gutter) div.appendChild(gutter);

    // Link affordance (Feature 3): mark the box as a hyperlink with a 🔗 badge + tooltip.
    // The text is not auto-restyled — the user controls colour/underline via the toolbar.
    if (this.linkUrl) {
      div.classList.add('text-element--linked');
      div.title = this.linkUrl;
      const badge = document.createElement('span');
      badge.className = 'text-link-badge';
      badge.textContent = '🔗';
      badge.style.pointerEvents = 'none';
      div.appendChild(badge);
    }
    div.appendChild(this.createRotationHandle());
    div.appendChild(this.createControls());
    div.appendChild(this.createResizeHandle());
    return div;
  }

  /** Create the list-marker gutter element with the input's font metrics, then fill it. */
  private _buildListGutter(scale: number): HTMLDivElement {
    const gutter = document.createElement('div');
    gutter.className = 'text-list-gutter';
    gutter.style.position = 'absolute';
    gutter.style.left = '0';
    gutter.style.top = '0';
    gutter.style.pointerEvents = 'none';
    gutter.style.whiteSpace = 'pre';
    // Width matches the input's padding-left so markers sit in the reserved column,
    // right-aligned against the text (a trailing 0.3em keeps the marker off the glyphs).
    gutter.style.width = ((this.list === 'ordered' ? 2.0 : 1.4) - 0.3) + 'em';
    gutter.style.fontSize = (this.fontSize * scale) + 'px';
    gutter.style.fontFamily = this.fontFamily;
    gutter.style.color = this.color;
    gutter.style.lineHeight = this.lineHeight !== undefined ? String(this.lineHeight) : '';
    this._fillListGutter(gutter);
    return gutter;
  }

  /** (Re)compute the per-line markers shown in the gutter from the current text. */
  private _fillListGutter(gutter: HTMLDivElement): void {
    if (!this.list) { gutter.textContent = ''; return; }
    const kind = this.list;
    let ord = 0;
    const markers = this.text.split('\n').map((line) => {
      if (line.length === 0) return '';
      ord += 1;
      return listMarker(kind, ord).trimEnd();
    });
    gutter.textContent = markers.join('\n');
  }

  _applyInputFormatting(input: HTMLInputElement | HTMLTextAreaElement, scale = 1): void {
    input.style.fontSize = (this.fontSize * scale) + 'px';
    input.style.color = this.color;
    input.style.fontFamily = this.fontFamily;
    input.style.fontWeight = this.bold ? 'bold' : 'normal';
    input.style.fontStyle = this.italic ? 'italic' : 'normal';
    const deco = [this.underline ? 'underline' : '', this.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ');
    input.style.textDecoration = deco || 'none';
    input.style.textAlign = this.align;
    input.dir = resolveDirection(this.direction, this.text);
    input.style.lineHeight = this.lineHeight !== undefined ? String(this.lineHeight) : '';
    // Slice 2 previews — outline uses the element's own fill color (palette-chosen)
    const strokeW = this.strokeWidth ?? 0;
    if (strokeW > 0) {
      input.style.setProperty('-webkit-text-stroke', `${strokeW * scale}px ${this.color}`);
    } else {
      input.style.removeProperty('-webkit-text-stroke');
    }
    const charSp = this.charSpacing ?? 0;
    input.style.letterSpacing = charSp !== 0 ? `${charSp * scale}px` : '';
    const hScale = this.horizontalScale ?? 100;
    if (hScale !== 100) {
      input.style.transformOrigin = this.align === 'right' ? 'right' : this.align === 'center' ? 'center' : 'left';
      input.style.transform = `scaleX(${hScale / 100})`;
    } else {
      input.style.transform = '';
    }
    if (this.baselineShift) {
      input.style.fontSize = (this.fontSize * 0.65 * scale) + 'px';
      input.style.verticalAlign = this.baselineShift === 'super' ? 'super' : 'sub';
    }
  }

  applyStyles(div: HTMLDivElement, canvasOffset: { left: number; top: number }, scale = 1): void {
    div.style.left = (canvasOffset.left + this.x * scale) + 'px';
    div.style.top = (canvasOffset.top + this.y * scale) + 'px';
    div.style.width = (this.width * scale) + 'px';
    div.style.height = (this.height * scale) + 'px';
    div.style.zIndex = '16';
    if (this.opacity !== undefined) div.style.opacity = String(this.opacity);
    if (this.backgroundColor) {
      const hex = this.backgroundColor.replace(/^#/, '');
      const ch = (s: string) => { const v = parseInt(s, 16); return Number.isNaN(v) ? 0 : v; };
      const r = ch(hex.substring(0, 2)), g = ch(hex.substring(2, 4)), b = ch(hex.substring(4, 6));
      div.style.background = `rgba(${r},${g},${b},1)`;
    }
  }

  override toJSON(): ElementJSON {
    return { ...super.toJSON(), text: this.text, fontSize: this.fontSize, color: this.color,
      fontFamily: this.fontFamily, bold: this.bold, italic: this.italic,
      underline: this.underline, strikethrough: this.strikethrough, align: this.align,
      multiline: this.multiline,
      ...(this.backgroundColor !== undefined ? { backgroundColor: this.backgroundColor } : {}),
      ...(this.lineHeight !== undefined ? { lineHeight: this.lineHeight } : {}),
      ...(this.opacity !== undefined ? { opacity: this.opacity } : {}),
      ...(this.strokeWidth !== undefined ? { strokeWidth: this.strokeWidth } : {}),
      ...(this.charSpacing !== undefined ? { charSpacing: this.charSpacing } : {}),
      ...(this.horizontalScale !== undefined ? { horizontalScale: this.horizontalScale } : {}),
      ...(this.baselineShift !== undefined ? { baselineShift: this.baselineShift } : {}),
      ...(this.direction !== 'auto' ? { direction: this.direction } : {}),
      ...(this.list ? { list: this.list } : {}),
      ...(this.linkUrl ? { linkUrl: this.linkUrl } : {}) };
  }
}
