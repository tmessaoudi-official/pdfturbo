import type { AppDOMRefs } from './uiController';
import type { FormattingService } from '../core/formattingService';
import type { TextElement } from '../elements/textElement';
import type { TextCaseMode } from '../utils/textCase';
import { trapFocus } from '../utils/focusTrap';
import { COLOR_PRESETS, getRecentColors, pushRecentColor } from '../utils/recentColors';
import { t } from '../utils/i18n';

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
    // #QA-2026-06-23 P3 #26 — the background color reuses the SHARED presets+recent palette
    // (same recentColors store as the toolbar), not a lone picker. The native input stays as
    // the full-spectrum "custom color" entry. Live-apply on input; record recent on commit.
    ui.textBgColor.addEventListener('input', () =>
      svc.setTextBackground(ui.textBgColor.value),
    );
    ui.textBgColor.addEventListener('change', () => {
      pushRecentColor(ui.textBgColor.value);
      this._renderBgSwatches();
    });
    ui.textBgNoneBtn.addEventListener('click', () => svc.clearTextBackground());
    this._renderBgSwatches();

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
    this._renderBgSwatches(); // refresh recent colors that may have changed since last open
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

  /**
   * Render the shared color palette (presets + recently-used) into #textBgSwatchRow — the same
   * `recentColors` store the toolbar uses (#QA P3 #26). A swatch click applies the background and
   * records it as recent; the trailing "custom" swatch opens the native full-spectrum picker.
   */
  private _renderBgSwatches(): void {
    const { ui, svc } = this._ctx;
    const row = ui.textBgSwatchRow;
    if (!row) return;
    row.innerHTML = '';
    const seen = new Set<string>();
    for (const hex of [...COLOR_PRESETS, ...getRecentColors()]) {
      const norm = hex.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      const btn = document.createElement('button');
      btn.className = 'color-swatch';
      btn.style.background = norm;
      btn.title = norm;
      btn.addEventListener('click', () => {
        ui.textBgColor.value = norm;
        svc.setTextBackground(norm);
        pushRecentColor(norm);
        this._renderBgSwatches();
      });
      row.appendChild(btn);
    }
    const custom = document.createElement('button');
    custom.className = 'color-swatch color-swatch-custom';
    custom.title = t('toolbar.customColorTitle');
    custom.setAttribute('aria-label', t('toolbar.customColorTitle'));
    custom.addEventListener('click', () => ui.textBgColor.click());
    row.appendChild(custom);
  }
}
