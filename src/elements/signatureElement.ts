import { PDFElement, type ElementJSON } from './annotationElement';

/** Optional approval caption (F-D D1) attached to a drawn signature. */
export interface SignatureCaption {
  /** Signer name, e.g. "Alice Martin". */
  signer?: string;
  /** Mention text, e.g. "Lu et approuvé" (editable). */
  mention?: string;
  /** Signing date as a display string, e.g. "2026-06-18". */
  signedDate?: string;
}

/**
 * Pure: approval-caption fields → display lines `[mention, "signer — date"]`,
 * dropping empty parts. Shared by the element's render path and the PDF export
 * renderer (which treats elements as plain data, no instance methods).
 */
export function buildSignatureCaptionLines(c: SignatureCaption): string[] {
  const lines: string[] = [];
  const mention = c.mention?.trim();
  if (mention) lines.push(mention);
  const who = [c.signer?.trim(), c.signedDate?.trim()].filter(Boolean).join(' — ');
  if (who) lines.push(who);
  return lines;
}

export class SignatureElement extends PDFElement {
  data: string;
  /** F-D D1 — optional approval caption (signer / mention / date) shown under the signature. */
  signer?: string;
  mention?: string;
  signedDate?: string;

  constructor(
    x: number, y: number, pageId: string, signatureData: string,
    options: { width?: number; height?: number } & SignatureCaption = {},
  ) {
    super('signature', x, y, options.width ?? 200, options.height ?? 80, pageId);
    this.data = signatureData;
    this.signer = options.signer;
    this.mention = options.mention;
    this.signedDate = options.signedDate;
  }

  /** True when any caption field is set — gates the caption band so plain signatures stay unchanged. */
  hasCaption(): boolean {
    return !!(this.signer?.trim() || this.mention?.trim() || this.signedDate?.trim());
  }

  /** Caption lines: [mention, "signer — date"] — only the non-empty parts. */
  captionLines(): string[] {
    return buildSignatureCaptionLines(this);
  }

  render(_container: HTMLElement, canvasOffset: { left: number; top: number }, scale = 1): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'pdf-element signature-element';
    div.dataset.id = String(this.id);
    this.applyStyles(div, canvasOffset, scale);

    if (this.hasCaption()) {
      // Image band on top, caption band at the bottom — keeps the drawn signature
      // and the "who/when" legible without overlap.
      const captionBand = Math.min(this.height * 0.34, 22);
      const imgLayer = document.createElement('div');
      Object.assign(imgLayer.style, {
        position: 'absolute', left: '0', top: '0', right: '0',
        height: `${(this.height - captionBand) * scale}px`,
        backgroundImage: `url(${this.data})`,
        backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
      });
      const cap = document.createElement('div');
      cap.className = 'signature-caption';
      Object.assign(cap.style, {
        position: 'absolute', left: '0', right: '0', bottom: '0',
        height: `${captionBand * scale}px`,
        fontSize: `${Math.max(6, captionBand * 0.42) * scale}px`,
        lineHeight: '1.1', textAlign: 'center', color: '#111',
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      });
      cap.textContent = this.captionLines().join(' · ');
      div.appendChild(imgLayer);
      div.appendChild(cap);
    } else {
      div.style.backgroundImage = `url(${this.data})`;
      div.style.backgroundSize = 'contain';
      div.style.backgroundRepeat = 'no-repeat';
      div.style.backgroundPosition = 'center';
    }

    div.appendChild(this.createRotationHandle());
    div.appendChild(this.createControls());
    div.appendChild(this.createResizeHandle());
    return div;
  }

  applyStyles(div: HTMLDivElement, canvasOffset: { left: number; top: number }, scale = 1): void {
    div.style.left = (canvasOffset.left + this.x * scale) + 'px';
    div.style.top = (canvasOffset.top + this.y * scale) + 'px';
    div.style.width = (this.width * scale) + 'px';
    div.style.height = (this.height * scale) + 'px';
  }

  override toJSON(): ElementJSON {
    const json: ElementJSON = { ...super.toJSON(), data: this.data };
    if (this.signer?.trim()) json['signer'] = this.signer;
    if (this.mention?.trim()) json['mention'] = this.mention;
    if (this.signedDate?.trim()) json['signedDate'] = this.signedDate;
    return json;
  }
}
