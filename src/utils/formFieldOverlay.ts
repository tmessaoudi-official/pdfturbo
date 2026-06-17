import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';

interface PdfChoiceOption { exportValue: string; displayValue: string }

interface PdfAnnotation {
  subtype: string;
  fieldType?: string;
  fieldName?: string;
  fieldValue?: string;
  rect: number[];
  alternativeText?: string;
  readOnly?: boolean;
  multiLine?: boolean;
  maxLen?: number | null;
  // Button (fieldType 'Btn') discriminators + the widget's on/export value.
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  buttonValue?: string | null;
  // Choice (fieldType 'Ch') props.
  combo?: boolean;
  multiSelect?: boolean;
  options?: PdfChoiceOption[];
}

/**
 * Is this widget a field type we render an interactive control for? Text,
 * checkbox, radio, and choice (dropdown / listbox) are supported. Push-buttons
 * (Btn without checkBox/radioButton) and signatures carry no fillable value and
 * are counted "unsupported" (warned once), never rendered.
 */
function _isSupported(a: PdfAnnotation): boolean {
  if (a.subtype !== 'Widget') return false;
  if (a.fieldType === 'Tx' || a.fieldType === 'Ch') return true;
  if (a.fieldType === 'Btn') return !!(a.checkBox || a.radioButton);
  return false;
}

export class FormFieldOverlay {
  private _nodes: HTMLElement[] = [];
  private _container: HTMLElement;

  constructor(container: HTMLElement) {
    this._container = container;
  }

  async render(
    page: PDFPageProxy,
    viewport: PageViewport,
    canvasOffset: { left: number; top: number },
    values: Record<string, string>,
    onValueChange: (fieldName: string, value: string) => void,
  ): Promise<{ unsupportedCount: number }> {
    this.clear();
    const annotations = await page.getAnnotations() as PdfAnnotation[];
    const widgets = annotations.filter(a => a.subtype === 'Widget');
    const supported = widgets.filter(_isSupported);
    const unsupported = widgets.filter(a => !_isSupported(a));

    // Radio buttons share one logical field (fieldName); each option is its own
    // widget annotation. Group them so they render as one <input name> set.
    for (const field of supported) {
      const rect = this._placeRect(field, viewport, canvasOffset);
      if (!rect) continue;
      const name: string = field.fieldName ?? '';

      if (field.fieldType === 'Tx') {
        this._renderText(field, rect, name, values, onValueChange);
      } else if (field.fieldType === 'Btn' && field.checkBox) {
        this._renderCheckbox(field, rect, name, values, onValueChange);
      } else if (field.fieldType === 'Btn' && field.radioButton) {
        this._renderRadio(field, rect, name, values, onValueChange);
      } else if (field.fieldType === 'Ch') {
        this._renderChoice(field, rect, name, values, onValueChange);
      }
    }
    return { unsupportedCount: unsupported.length };
  }

  /** Convert a field's PDF rect to a viewport-positioned box; null if too small. */
  private _placeRect(
    field: PdfAnnotation,
    viewport: PageViewport,
    canvasOffset: { left: number; top: number },
  ): { left: number; top: number; w: number; h: number } | null {
    const vr: number[] = viewport.convertToViewportRectangle(field.rect);
    const left = Math.min(vr[0], vr[2]);
    const top = Math.min(vr[1], vr[3]);
    const w = Math.abs(vr[2] - vr[0]);
    const h = Math.abs(vr[3] - vr[1]);
    if (w < 2 || h < 2) return null;
    return {
      left: canvasOffset.left + left,
      top: canvasOffset.top + top,
      w,
      h,
    };
  }

  private _position(el: HTMLElement, rect: { left: number; top: number; w: number; h: number }): void {
    Object.assign(el.style, {
      position: 'absolute',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.w}px`,
      height: `${rect.h}px`,
    });
  }

  private _renderText(
    field: PdfAnnotation,
    rect: { left: number; top: number; w: number; h: number },
    name: string,
    values: Record<string, string>,
    onValueChange: (fieldName: string, value: string) => void,
  ): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-field-overlay';
    input.value = values[name] ?? (field.fieldValue ?? '');
    if (field.alternativeText) input.placeholder = field.alternativeText;
    this._position(input, rect);
    input.addEventListener('input', () => onValueChange(name, input.value));
    this._mount(input);
  }

  private _renderCheckbox(
    field: PdfAnnotation,
    rect: { left: number; top: number; w: number; h: number },
    name: string,
    values: Record<string, string>,
    onValueChange: (fieldName: string, value: string) => void,
  ): void {
    // On-value is the widget's export value; default to "On" (PDF spec default).
    const onValue = field.buttonValue || 'On';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'form-field-overlay';
    // Stored value is the on-value when ticked, "" when unticked. Fall back to
    // the field's own value (the source PDF's saved state) if nothing stored.
    const stored = values[name] ?? (field.fieldValue ?? '');
    input.checked = stored !== '' && stored !== 'Off';
    this._position(input, rect);
    if (field.alternativeText) input.title = field.alternativeText;
    input.addEventListener('change', () => onValueChange(name, input.checked ? onValue : ''));
    this._mount(input);
  }

  private _renderRadio(
    field: PdfAnnotation,
    rect: { left: number; top: number; w: number; h: number },
    name: string,
    values: Record<string, string>,
    onValueChange: (fieldName: string, value: string) => void,
  ): void {
    const optionValue = field.buttonValue || '';
    const input = document.createElement('input');
    input.type = 'radio';
    input.className = 'form-field-overlay';
    input.name = `ffo-radio-${name}`; // group the option widgets by field name
    input.value = optionValue;
    const stored = values[name] ?? (field.fieldValue ?? '');
    input.checked = optionValue !== '' && stored === optionValue;
    this._position(input, rect);
    if (field.alternativeText) input.title = field.alternativeText;
    input.addEventListener('change', () => { if (input.checked) onValueChange(name, optionValue); });
    this._mount(input);
  }

  private _renderChoice(
    field: PdfAnnotation,
    rect: { left: number; top: number; w: number; h: number },
    name: string,
    values: Record<string, string>,
    onValueChange: (fieldName: string, value: string) => void,
  ): void {
    const isMulti = !field.combo && !!field.multiSelect;
    const select = document.createElement('select');
    select.className = 'form-field-overlay';
    if (isMulti) {
      select.multiple = true;
    } else if (!field.combo) {
      // List box (single-select): show it as a sized list, not a dropdown.
      select.size = Math.max(2, Math.min((field.options?.length ?? 2), 6));
    }
    const stored = values[name] ?? (field.fieldValue ?? '');
    const selectedSet = new Set(stored === '' ? [] : stored.split('\n'));

    // A combo box gets a leading blank entry so "nothing selected" is reachable.
    if (field.combo) {
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '';
      select.appendChild(blank);
    }
    for (const opt of field.options ?? []) {
      const o = document.createElement('option');
      o.value = opt.exportValue;
      o.textContent = opt.displayValue;
      if (selectedSet.has(opt.exportValue)) o.selected = true;
      select.appendChild(o);
    }
    this._position(select, rect);
    if (field.alternativeText) select.title = field.alternativeText;
    select.addEventListener('change', () => {
      const chosen = Array.from(select.selectedOptions)
        .map(o => o.value)
        .filter(v => v !== '');
      // Single-value fields store the lone value; multi-select joins with "\n".
      onValueChange(name, isMulti ? chosen.join('\n') : (chosen[0] ?? ''));
    });
    this._mount(select);
  }

  private _mount(el: HTMLElement): void {
    this._container.appendChild(el);
    this._nodes.push(el);
  }

  clear(): void {
    this._nodes.forEach(n => n.remove());
    this._nodes = [];
  }

  setPointerEvents(enabled: boolean): void {
    const pe = enabled ? 'auto' : 'none';
    this._nodes.forEach(n => { n.style.pointerEvents = pe; });
  }
}
