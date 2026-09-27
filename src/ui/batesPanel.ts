import type { AppDOMRefs } from './uiController';
import type { IErrorReporter } from '../core/errorReporter';
import { normalizeBatesSettings, type BatesSettings } from '../export/batesStamp';
import { trapFocus } from '../utils/focusTrap';

/**
 * Bates / page-numbering config modal (#61b). UI glue over the pure stamp engine
 * in src/export/batesStamp.ts — the stamp itself is drawn during export inside
 * buildPageOverlays, so this panel only edits the settings object. Mirrors
 * WatermarkPanel but has no live preview canvas (Bates is export-only by design).
 */

/** What a blank or unreadable form field falls back to. Ranges and the start-number cap come from
 * `normalizeBatesSettings`, the same check a restored session goes through (limits row 28). */
const FORM_DEFAULTS: BatesSettings = {
  enabled: false, mode: 'page', prefix: '', startNumber: 1, digits: 6, position: 'br', fontSize: 10, color: '#555555',
};

/** Parse an int field, returning `fallback` only for blank/NaN input — so a
 * deliberately-typed 0 is preserved (the `parseInt(...) || fallback` idiom would
 * silently rewrite 0). Clamping to floors is applied by the caller. */
function intOr(raw: string, fallback: number): number {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

export interface IBatesContext {
  readonly ui: AppDOMRefs;
  readonly bates: BatesSettings;
  setBates(b: BatesSettings): void;
  autosave(): void;
  readonly reportError: IErrorReporter;
  readonly exportPreviewOpen: boolean;
  showExportPreview(): void;
}

export class BatesPanel {
  private _trapCleanup: (() => void) | null = null;

  constructor(private readonly _ctx: IBatesContext) {}

  setupListeners(): void {
    this._ctx.ui.batesMode.addEventListener('change', () => this._syncModeVisibility());
  }

  open(): void {
    const ui = this._ctx.ui;
    const b = this._ctx.bates;
    ui.batesEnabled.checked = b.enabled;
    ui.batesMode.value = b.mode;
    ui.batesPrefix.value = b.prefix;
    ui.batesStart.value = String(b.startNumber);
    ui.batesDigits.value = String(b.digits);
    ui.batesPosition.value = b.position;
    ui.batesFontSize.value = String(b.fontSize);
    ui.batesColor.value = b.color;
    this._syncModeVisibility();
    ui.batesModal.classList.add('active');
    this._trapCleanup?.();
    this._trapCleanup = trapFocus(
      ui.batesModal.querySelector('.watermark-content') as HTMLElement,
      ui.batesBtn,
    );
  }

  close(): void {
    this._ctx.ui.batesModal.classList.remove('active');
    this._trapCleanup?.();
    this._trapCleanup = null;
  }

  apply(): void {
    const ui = this._ctx.ui;
    const bates = normalizeBatesSettings({
      enabled: ui.batesEnabled.checked,
      mode: ui.batesMode.value === 'bates' ? 'bates' : 'page',
      prefix: ui.batesPrefix.value,
      startNumber: intOr(ui.batesStart.value, FORM_DEFAULTS.startNumber),
      digits: intOr(ui.batesDigits.value, FORM_DEFAULTS.digits),
      position: ui.batesPosition.value,
      fontSize: intOr(ui.batesFontSize.value, FORM_DEFAULTS.fontSize),
      color: ui.batesColor.value,
    }, FORM_DEFAULTS);
    this._ctx.setBates(bates);
    this.close();
    this.syncBtn();
    this._ctx.autosave();
    this._ctx.reportError.info(bates.enabled ? 'toast.batesEnabled' : 'toast.batesDisabled');
    if (this._ctx.exportPreviewOpen) this._ctx.showExportPreview();
  }

  syncBtn(): void {
    this._ctx.ui.batesBtn.classList.toggle('active', this._ctx.bates.enabled);
  }

  private _syncModeVisibility(): void {
    const batesMode = this._ctx.ui.batesMode.value === 'bates';
    this._ctx.ui.batesNumberingGroup.style.display = batesMode ? '' : 'none';
  }
}
