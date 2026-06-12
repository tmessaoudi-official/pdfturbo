import { t } from '../utils/i18n';
import type { ProgressHandle, IProgressManager } from '../contracts/progressManager';

export type { ProgressHandle, IProgressManager } from '../contracts/progressManager';

export class ProgressManager implements IProgressManager {
  private _overlay: HTMLElement;
  private _label: HTMLElement;
  private _active = 0;

  constructor(overlay: HTMLElement, label: HTMLElement) {
    this._overlay = overlay;
    this._label = label;
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
      done: finish,
      failed: finish,
    };
  }

  private _show(labelKey: string, params?: Record<string, unknown>): void {
    const msg = t(labelKey, params as Record<string, string | number> | undefined);
    this._label.textContent = msg;
    this._overlay.setAttribute('aria-label', msg);
    this._overlay.classList.add('active');
  }

  private _hide(): void {
    this._overlay.classList.remove('active');
    this._label.textContent = '';
    this._overlay.setAttribute('aria-label', '');
  }
}
