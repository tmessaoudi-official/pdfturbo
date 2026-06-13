import { trapFocus } from '../utils/focusTrap';

export class PanelFocusTrapService {
  private _cleanup: (() => void) | null = null;

  getCleanup(): (() => void) | null { return this._cleanup; }
  setCleanup(fn: (() => void) | null): void { this._cleanup = fn; }

  togglePanel(
    toggleFn: () => void,
    panel: Element,
    trapTargetSelector: string,
    triggerBtn: HTMLElement,
  ): void {
    toggleFn();
    if (panel.classList.contains('active')) {
      this._cleanup?.();
      this._cleanup = trapFocus(
        panel.querySelector(trapTargetSelector) as HTMLElement,
        triggerBtn,
      );
    } else {
      this._cleanup?.();
      this._cleanup = null;
    }
  }
}
