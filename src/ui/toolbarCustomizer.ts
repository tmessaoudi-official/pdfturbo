import type { ILayoutStorage } from './layoutStorage';

const STORAGE_KEY = 'pdfturbo_toolbar_order';

export class ToolbarCustomizer {
  private readonly _defaultOrder: string[];

  constructor(
    private readonly _container: HTMLElement,
    private readonly _storage: ILayoutStorage,
  ) {
    this._defaultOrder = this._readOrder();
  }

  /** Restore persisted group order by reordering live DOM nodes. */
  restore(): void {
    const raw = this._storage.load(STORAGE_KEY);
    if (!raw) return;
    let order: string[];
    try { order = JSON.parse(raw) as string[]; } catch { return; }
    this._applyOrder(order);
  }

  /** Persist current group order to storage. */
  save(): void {
    this._storage.save(STORAGE_KEY, JSON.stringify(this._readOrder()));
  }

  /** Reset to original DOM order and clear persisted storage. */
  reset(): void {
    this._applyOrder(this._defaultOrder);
    this._storage.clear(STORAGE_KEY);
  }

  /** Read ids of toolbar children in their current DOM order. */
  private _readOrder(): string[] {
    return Array.from(this._container.children)
      .map(el => el.id)
      .filter(id => id.length > 0);
  }

  /** Reorder live DOM nodes to match the given id array (missing ids are skipped). */
  private _applyOrder(order: string[]): void {
    for (const id of order) {
      const el = document.getElementById(id);
      if (el && this._container.contains(el)) {
        this._container.appendChild(el);
      }
    }
  }
}
