import { t } from '../utils/i18n';
import type { ProgressHandle, IProgressManager } from '../contracts/progressManager';

export type { ProgressHandle, IProgressManager } from '../contracts/progressManager';

export class ProgressManager implements IProgressManager {
  private _overlay: HTMLElement;
  private _label: HTMLElement;
  private _bar?: HTMLProgressElement;
  private _active = 0;

  constructor(overlay: HTMLElement, label: HTMLElement, bar?: HTMLProgressElement) {
    this._overlay = overlay;
    this._label = label;
    this._bar = bar;
  }

  begin(labelKey: string, params?: Record<string, unknown>): ProgressHandle {
    this._active++;
    this._show(labelKey, params);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this._active = Math.max(0, this._active - 1);
      if (this._active === 0) this._hide();
    };

    return {
      update: (key, p) => { if (!done) this._show(key, p); },
      setFraction: (f) => { if (!done) this._setFraction(f); },
      done: finish,
      failed: finish,
    };
  }

  /** Render determinate progress (0..1) or revert to indeterminate when null. */
  private _setFraction(fraction: number | null): void {
    if (fraction === null) {
      this._overlay.classList.remove('determinate');
      return;
    }
    const clamped = Math.min(1, Math.max(0, fraction));
    if (this._bar) this._bar.value = clamped;
    this._overlay.classList.add('determinate');
  }

  private _show(labelKey: string, params?: Record<string, unknown>): void {
    const msg = t(labelKey, params as Record<string, string | number> | undefined);
    this._label.textContent = msg;
    this._overlay.setAttribute('aria-label', msg);
    this._overlay.classList.add('active');
  }

  private _hide(): void {
    this._overlay.classList.remove('active');
    this._overlay.classList.remove('determinate');
    if (this._bar) this._bar.value = 0;
    this._label.textContent = '';
    this._overlay.setAttribute('aria-label', '');
  }
}
