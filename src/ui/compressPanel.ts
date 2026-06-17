import type { AppDOMRefs } from './uiController';
import { trapFocus } from '../utils/focusTrap';
import { t } from '../utils/i18n';
import {
  clampDpi,
  clampQuality,
  COMPRESS_DPI_DEFAULT,
  COMPRESS_QUALITY_DEFAULT,
  type CompressMode,
  type CompressOptions,
} from '../export/compress';

/**
 * Compress modal (#60). UI glue over the pure compress helpers + the lossy raster
 * in ExportService. Unlike WatermarkPanel/BatesPanel (which edit a persisted
 * settings object), "Apply" here is a one-shot action: it reads the form, clamps
 * it, and fires the compress-and-download. Mirrors BatesPanel's open/close/trap
 * structure and reuses the `.watermark-modal` / `.wm-*` CSS — no new layout.
 */
export interface ICompressContext {
  readonly ui: AppDOMRefs;
  /** Run the compress + download with the chosen options. */
  compress(opts: CompressOptions): void;
}

export class CompressPanel {
  private _trapCleanup: (() => void) | null = null;

  constructor(private readonly _ctx: ICompressContext) {}

  setupListeners(): void {
    this._ctx.ui.compressMode.addEventListener('change', () => this._syncModeVisibility());
    this._ctx.ui.compressQuality.addEventListener('input', () => this._syncQualityLabel());
  }

  open(): void {
    this._syncModeVisibility();
    this._syncQualityLabel();
    this._ctx.ui.compressModal.classList.add('active');
    this._trapCleanup?.();
    this._trapCleanup = trapFocus(
      this._ctx.ui.compressModal.querySelector('.watermark-content') as HTMLElement,
      this._ctx.ui.compressBtn,
    );
  }

  close(): void {
    this._ctx.ui.compressModal.classList.remove('active');
    this._trapCleanup?.();
    this._trapCleanup = null;
  }

  apply(): void {
    const ui = this._ctx.ui;
    const mode: CompressMode = ui.compressMode.value === 'lossy' ? 'lossy' : 'lossless';
    const opts: CompressOptions = mode === 'lossy'
      ? {
          mode,
          dpi: clampDpi(parseInt(ui.compressDpi.value, 10)),
          quality: clampQuality(parseFloat(ui.compressQuality.value)),
        }
      : { mode };
    this.close();
    this._ctx.compress(opts);
  }

  private _syncModeVisibility(): void {
    const ui = this._ctx.ui;
    const lossy = ui.compressMode.value === 'lossy';
    ui.compressLossyGroup.style.display = lossy ? '' : 'none';
    // Swap the hint AND re-translate it in place (data-i18n is otherwise only read
    // at page load, so the hint would stay on whichever mode was shown first).
    const key = lossy ? 'modal.compress.hintLossy' : 'modal.compress.hintLossless';
    ui.compressModeHint.setAttribute('data-i18n', key);
    ui.compressModeHint.textContent = t(key);
  }

  private _syncQualityLabel(): void {
    const ui = this._ctx.ui;
    const q = clampQuality(parseFloat(ui.compressQuality.value));
    ui.compressQualityVal.textContent = q.toFixed(2);
  }
}

// Re-export so callers needn't reach into export/compress for the defaults.
export { COMPRESS_DPI_DEFAULT, COMPRESS_QUALITY_DEFAULT };
