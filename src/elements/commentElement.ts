import { PDFElement, type ElementJSON } from './annotationElement';
import { t } from '../utils/i18n';

export interface CommentOptions {
  color?: string;
  text?: string;
  width?: number;
  height?: number;
}

export class CommentElement extends PDFElement {
  color: string;
  text: string;

  constructor(x: number, y: number, pageId: string, opts: CommentOptions = {}) {
    super('comment', x, y, opts.width ?? 200, opts.height ?? 120, pageId);
    this.color = opts.color ?? '#FFFDE7';
    this.text  = opts.text  ?? '';
  }

  render(container: HTMLElement, canvasOffset: { left: number; top: number }, scale: number): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-element comment-element';
    wrapper.dataset['id'] = String(this.id);
    Object.assign(wrapper.style, {
      position: 'absolute',
      left:   `${canvasOffset.left + this.x * scale}px`,
      top:    `${canvasOffset.top  + this.y * scale}px`,
      width:  `${this.width  * scale}px`,
      height: `${this.height * scale}px`,
      background: this.color,
      border: '1px solid #ccc',
      borderRadius: '4px',
      boxShadow: '2px 2px 6px rgba(0,0,0,0.2)',
      overflow: 'hidden',
      boxSizing: 'border-box',
      zIndex: '20',
    });

    const textarea = document.createElement('textarea');
    Object.assign(textarea.style, {
      width: '100%',
      height: '100%',
      border: 'none',
      background: 'transparent',
      padding: '4px',
      fontSize: `${Math.round(11 * scale)}px`,
      resize: 'none',
      outline: 'none',
      fontFamily: 'sans-serif',
      boxSizing: 'border-box',
    });
    textarea.value = this.text;
    textarea.placeholder = t('comment.placeholder');
    textarea.addEventListener('input', () => {
      this.text = textarea.value;
      textarea.dispatchEvent(
        new CustomEvent('element:autosave', { bubbles: true, composed: true })
      );
    });
    textarea.addEventListener('click', e => e.stopPropagation());

    wrapper.appendChild(textarea);
    wrapper.appendChild(this.createRotationHandle());
    wrapper.appendChild(this.createControls());
    wrapper.appendChild(this.createResizeHandle());
    container.appendChild(wrapper);
    return wrapper;
  }

  override toJSON(): ElementJSON {
    return { ...super.toJSON(), color: this.color, text: this.text };
  }
}
