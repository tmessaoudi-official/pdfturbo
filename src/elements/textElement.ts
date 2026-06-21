import { PDFElement, type ElementJSON } from './annotationElement';

export type TextAlign = 'left' | 'center' | 'right';

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
    input.addEventListener('input', (e) => { this.text = (e.target as HTMLInputElement).value; });

    div.appendChild(input);
    div.appendChild(this.createRotationHandle());
    div.appendChild(this.createControls());
    div.appendChild(this.createResizeHandle());
    return div;
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
    input.style.lineHeight = this.lineHeight !== undefined ? String(this.lineHeight) : '';
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
      ...(this.opacity !== undefined ? { opacity: this.opacity } : {}) };
  }
}
