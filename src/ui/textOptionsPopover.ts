import type { AppDOMRefs } from './uiController';
import type { FormattingService } from '../core/formattingService';
import type { TextElement } from '../elements/textElement';
import type { TextCaseMode } from '../utils/textCase';
import { trapFocus } from '../utils/focusTrap';

/**
 * "Text ⋮" options popover (#formattingGroup).  Wires advanced text-formatting
 * controls (line height, opacity, background, case transforms, clear formatting,
 * format painter) to FormattingService.  Mirrors BatesPanel structurally so it
 * behaves identically to the other watermark-modal dialogs (trapFocus, Esc, close).
 */

function floatOr(raw: string, fallback: number): number {
  const n = parseFloat(raw);
  return Number.isNaN(n) ? fallback : n;
}

export interface ITextOptionsContext {
  readonly ui: AppDOMRefs;
  readonly svc: FormattingService;
  readonly selectedText: TextElement | null;
}

export class TextOptionsPopover {
  private _trapCleanup: (() => void) | null = null;

  constructor(private readonly _ctx: ITextOptionsContext) {}

  setupListeners(): void {
    const { ui, svc } = this._ctx;

    ui.textOptionsBtn.addEventListener('click', () => this.open());
    ui.textOptionsCloseBtn.addEventListener('click', () => this.close());

    ui.textLineHeight.addEventListener('change', () =>
      svc.setLineHeight(floatOr(ui.textLineHeight.value, 1.2)),
    );
    ui.textOpacity.addEventListener('input', () =>
      svc.setTextOpacity(floatOr(ui.textOpacity.value, 1)),
    );
    ui.textBgColor.addEventListener('input', () =>
      svc.setTextBackground(ui.textBgColor.value),
    );
    ui.textBgNoneBtn.addEventListener('click', () => svc.clearTextBackground());

    const caseBtn = (el: HTMLButtonElement, mode: TextCaseMode) =>
      el.addEventListener('click', () => svc.transformCase(mode));
    caseBtn(ui.textCaseUpperBtn, 'upper');
    caseBtn(ui.textCaseLowerBtn, 'lower');
    caseBtn(ui.textCaseTitleBtn, 'title');

    ui.clearFmtBtn.addEventListener('click', () => svc.clearFormatting());
    ui.formatPainterBtn.addEventListener('click', () => {
      if (svc.copyTextStyle()) {
        ui.formatPainterBtn.classList.add('btn-active-fmt');
      }
    });

    // Slice 2 — stroke (width only; outline uses the element's fill color) / spacing / scale / super-sub
    ui.textStrokeWidth?.addEventListener('input', () => {
      const w = parseFloat(ui.textStrokeWidth?.value ?? '0');
      if (!Number.isFinite(w) || w <= 0) svc.clearTextStroke();
      else svc.setTextStroke(w);
    });
    ui.charSpacingInput?.addEventListener('input', () =>
      svc.setCharSpacing(floatOr(ui.charSpacingInput?.value ?? '0', 0)),
    );
    ui.horizontalScaleInput?.addEventListener('input', () =>
      svc.setHorizontalScale(floatOr(ui.horizontalScaleInput?.value ?? '100', 100)),
    );
    ui.superscriptBtn?.addEventListener('click', () => {
      const cur = this._ctx.selectedText?.baselineShift;
      svc.setBaselineShift(cur === 'super' ? null : 'super');
    });
    ui.subscriptBtn?.addEventListener('click', () => {
      const cur = this._ctx.selectedText?.baselineShift;
      svc.setBaselineShift(cur === 'sub' ? null : 'sub');
    });
  }

  open(): void {
    const { ui } = this._ctx;
    const te = this._ctx.selectedText;
    if (te) {
      ui.textLineHeight.value = String(te.lineHeight ?? 1.2);
      ui.textOpacity.value    = String(te.opacity ?? 1);
      if (te.backgroundColor) {
        ui.textBgColor.value = te.backgroundColor;
      }
      // Slice 2
      if (ui.textStrokeWidth) ui.textStrokeWidth.value = String(te.strokeWidth ?? 0);
      if (ui.charSpacingInput) ui.charSpacingInput.value = String(te.charSpacing ?? 0);
      if (ui.horizontalScaleInput) ui.horizontalScaleInput.value = String(te.horizontalScale ?? 100);
    }
    ui.textOptionsModal.classList.add('active');
    this._trapCleanup?.();
    this._trapCleanup = trapFocus(
      ui.textOptionsModal.querySelector('.watermark-content') as HTMLElement,
      ui.textOptionsBtn,
    );
  }

  close(): void {
    this._ctx.ui.textOptionsModal.classList.remove('active');
    this._trapCleanup?.();
    this._trapCleanup = null;
  }
}
