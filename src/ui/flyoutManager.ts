export type FlyoutCloseCondition = 'aria-pressed' | 'closest-aria-pressed' | 'any-click';

export interface FlyoutConfig {
  /** Wrapper element that receives the `.open` class. */
  wrap: HTMLElement;
  /** Toggle button — gets `aria-expanded` updated. */
  trigger: HTMLButtonElement;
  /** The panel element to position below the trigger. */
  flyout: HTMLElement;
  /** When to auto-close the flyout on a click inside the panel. */
  closeWhen?: FlyoutCloseCondition;
}

export class FlyoutManager {
  private _entries: FlyoutConfig[] = [];

  register(cfg: FlyoutConfig): void {
    this._entries.push(cfg);

    cfg.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = cfg.wrap.classList.toggle('open');
      cfg.trigger.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        this._position(cfg);
      }
    });

    if (cfg.closeWhen) {
      const cond = cfg.closeWhen;
      cfg.flyout.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        let shouldClose = false;
        if (cond === 'any-click') shouldClose = true;
        else if (cond === 'aria-pressed') shouldClose = target.hasAttribute('aria-pressed');
        else if (cond === 'closest-aria-pressed') shouldClose = !!target.closest('[aria-pressed]');
        if (shouldClose) this.close(cfg);
      });
    }
  }

  close(cfg: FlyoutConfig): void {
    cfg.wrap.classList.remove('open');
    cfg.trigger.setAttribute('aria-expanded', 'false');
  }

  closeAll(): void {
    this._entries.forEach(cfg => this.close(cfg));
  }

  /** Wire document-level outside-click to close any flyout whose wrap doesn't contain the target. */
  wireGlobalClose(): void {
    document.addEventListener('click', (e) => {
      for (const cfg of this._entries) {
        if (!cfg.wrap.contains(e.target as Node)) {
          this.close(cfg);
        }
      }
    });
  }

  private _position(cfg: FlyoutConfig): void {
    const rect = cfg.trigger.getBoundingClientRect();
    cfg.flyout.style.top  = (rect.bottom + 4) + 'px';
    cfg.flyout.style.left = rect.left + 'px';
  }
}
