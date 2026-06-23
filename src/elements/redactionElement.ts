import { t } from '../utils/i18n';
import { PDFElement, type ElementJSON } from './annotationElement';

/**
 * Whether a CSS color is effectively black (#QA-2026-06-23 P3 #23). The redaction warning
 * border keys on "is this a content-hiding black box?"; comparing the raw string to the exact
 * literal `'#000000'` missed equivalents from imports/restore (`#000`, uppercase, `rgb(0,0,0)`).
 * Normalizes 3/6-digit hex (case-insensitive) and `rgb()` to an r=g=b=0 test.
 */
export function isBlackColor(color: string): boolean {
  const c = color.trim().toLowerCase();
  if (c === '#000' || c === '#000000') return true;
  const rgb = /^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(?:,\s*[\d.]+\s*)?\)$/.exec(c);
  return rgb !== null;
}

export class RedactionElement extends PDFElement {
  color: string;

  constructor(x: number, y: number, width: number, height: number, pageId: string, color = '#000000') {
    super('redaction', x, y, width, height, pageId);
    this.color = color;
  }

  render(container: HTMLElement, canvasOffset: { left: number; top: number }, scale: number): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-element redaction-element';
    wrapper.dataset['id'] = String(this.id);
    const isBlack = isBlackColor(this.color);
    Object.assign(wrapper.style, {
      position: 'absolute',
      left:       `${canvasOffset.left + this.x * scale}px`,
      top:        `${canvasOffset.top  + this.y * scale}px`,
      width:      `${this.width  * scale}px`,
      height:     `${this.height * scale}px`,
      background: this.color,
      border:     isBlack ? '2px dashed #c00' : '1px dashed #888',
      boxSizing:  'border-box',
      zIndex:     '15',
    });

    const burnLabel = document.createElement('span');
    burnLabel.className = 'redaction-burn-label';
    burnLabel.textContent = t('element.burnLabel');
    wrapper.appendChild(burnLabel);
    wrapper.appendChild(this.createRotationHandle());
    wrapper.appendChild(this.createControls());
    wrapper.appendChild(this.createResizeHandle());
    container.appendChild(wrapper);
    return wrapper;
  }

  override toJSON(): ElementJSON {
    return { ...super.toJSON(), color: this.color };
  }
}
