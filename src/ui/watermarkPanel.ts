import type { AppDOMRefs } from './uiController';
import type { WatermarkSettings } from '../core/documentModel';
import type { IErrorReporter } from '../core/errorReporter';
import { trapFocus } from '../utils/focusTrap';
import { hexToRgbValues } from '../utils/geometry';

export interface IWatermarkContext {
  readonly ui: AppDOMRefs;
  readonly watermark: WatermarkSettings;
  setWatermark(wm: WatermarkSettings): void;
  readonly zoomScale: number;
  autosave(): void;
  readonly reportError: IErrorReporter;
  readonly exportPreviewOpen: boolean;
  showExportPreview(): void;
}

export class WatermarkPanel {
  private _trapCleanup: (() => void) | null = null;

  constructor(private readonly _ctx: IWatermarkContext) {}

  setupListeners(): void {
    const update = () => this._updatePreview();
    const ui = this._ctx.ui;
    ui.wmText.addEventListener('input', update);
    ui.wmColor.addEventListener('input', update);
    ui.wmFontSize.addEventListener('input', () => {
      ui.wmFontSizeDisplay.textContent = ui.wmFontSize.value;
      update();
    });
    ui.wmOpacity.addEventListener('input', () => {
      ui.wmOpacityDisplay.textContent = ui.wmOpacity.value;
      update();
    });
    ui.wmAngle.addEventListener('input', () => {
      ui.wmAngleDisplay.textContent = ui.wmAngle.value;
      update();
    });
    ui.wmDensity.addEventListener('input', () => {
      ui.wmDensityDisplay.textContent = ui.wmDensity.value;
      update();
    });
  }

  open(): void {
    const ui = this._ctx.ui;
    const wm = this._ctx.watermark;
    ui.wmEnabled.checked = wm.enabled;
    ui.wmText.value = wm.text;
    ui.wmColor.value = wm.color;
    ui.wmFontSize.value = String(wm.fontSize);
    ui.wmFontSizeDisplay.textContent = String(wm.fontSize);
    const opPct = Math.round(wm.opacity * 100);
    ui.wmOpacity.value = String(opPct);
    ui.wmOpacityDisplay.textContent = String(opPct);
    ui.wmAngle.value = String(wm.angle);
    ui.wmAngleDisplay.textContent = String(wm.angle);
    const density = wm.density ?? 3;
    ui.wmDensity.value = String(density);
    ui.wmDensityDisplay.textContent = String(density);
    ui.watermarkModal.classList.add('active');
    this._updatePreview();
    this._trapCleanup?.();
    this._trapCleanup = trapFocus(
      ui.watermarkModal.querySelector('.watermark-content') as HTMLElement,
      ui.watermarkBtn,
    );
  }

  close(): void {
    this._ctx.ui.watermarkModal.classList.remove('active');
    this._trapCleanup?.();
    this._trapCleanup = null;
  }

  apply(): void {
    const ui = this._ctx.ui;
    const wm: WatermarkSettings = {
      enabled: ui.wmEnabled.checked,
      text: ui.wmText.value || 'WATERMARK',
      color: ui.wmColor.value,
      fontSize: parseInt(ui.wmFontSize.value, 10) || 60,
      opacity: parseInt(ui.wmOpacity.value, 10) / 100,
      angle: parseInt(ui.wmAngle.value, 10),
      density: parseInt(ui.wmDensity.value, 10) || 3,
    };
    this._ctx.setWatermark(wm);
    this.close();
    this.syncBtn();
    this._ctx.autosave();
    this._ctx.reportError.info(wm.enabled ? 'toast.watermarkEnabled' : 'toast.watermarkDisabled');
    if (this._ctx.exportPreviewOpen) this._ctx.showExportPreview();
  }

  syncBtn(): void {
    this._ctx.ui.watermarkBtn.classList.toggle('active', this._ctx.watermark.enabled);
  }

  drawOnCanvas(ctx: CanvasRenderingContext2D, screenW: number, screenH: number, wm: WatermarkSettings, scale?: number): void {
    if (!wm.enabled || !wm.text) return;
    const effectiveScale = scale ?? this._ctx.zoomScale;
    const fontSize = wm.fontSize * effectiveScale;
    ctx.font = `${fontSize}px Helvetica, Arial, sans-serif`;
    const textWidth = ctx.measureText(wm.text).width;
    const count = Math.max(1, Math.min(5, wm.density ?? 3));
    const stepX = Math.max(textWidth * 1.2, screenW / (count + 0.5));
    const stepY = Math.max(fontSize * 2.5, screenH / (count + 0.5));
    const col = hexToRgbValues(wm.color);
    ctx.fillStyle = `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${wm.opacity})`;
    ctx.textBaseline = 'alphabetic';
    const angleRad = wm.angle * Math.PI / 180;
    for (let y = -(stepY / 2); y < screenH + stepY; y += stepY) {
      for (let x = -(stepX / 2); x < screenW + stepX; x += stepX) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angleRad);
        ctx.fillText(wm.text, -textWidth / 2, 0);
        ctx.restore();
      }
    }
  }

  private _updatePreview(): void {
    const canvas = this._ctx.ui.wmPreviewCanvas;
    const w = canvas.offsetWidth || 300;
    const h = canvas.offsetHeight || 80;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const realFontSize = parseInt(this._ctx.ui.wmFontSize.value, 10) || 60;
    const previewScale = h / 842;
    const liveWm: WatermarkSettings = {
      enabled: true,
      text: this._ctx.ui.wmText.value || 'WATERMARK',
      color: this._ctx.ui.wmColor.value,
      fontSize: realFontSize,
      opacity: parseInt(this._ctx.ui.wmOpacity.value, 10) / 100,
      angle: parseInt(this._ctx.ui.wmAngle.value, 10),
      density: parseInt(this._ctx.ui.wmDensity.value, 10) || 3,
    };
    this.drawOnCanvas(ctx, w, h, liveWm, previewScale);
  }
}
