import Sortable from 'sortablejs';
import type { ILayoutStorage } from './layoutStorage';

const STORAGE_KEY = 'pdfturbo_toolbar_order';

type ToolbarEntry = string | { type: 'submenu'; id: string; children: string[] };

let _submenuCounter = 0;

export class ToolbarCustomizer {
  private readonly _defaultOrder: string[];
  private _sortable: Sortable | null = null;

  constructor(
    private readonly _container: HTMLElement,
    private readonly _storage: ILayoutStorage,
  ) {
    this._defaultOrder = this._readOrder();
  }

  /** Enable drag-and-drop reordering via SortableJS. */
  enableDragDrop(): void {
    if (this._sortable) return;
    this._sortable = new Sortable(this._container, {
      animation: 150,
      delay: 300,
      delayOnTouchOnly: true,
      filter: '.toolbar-sep,.toolbar-spacer',
      onEnd: () => { this.save(); },
    });
  }

  /** Disable drag-and-drop reordering. */
  disableDragDrop(): void {
    this._sortable?.destroy();
    this._sortable = null;
  }

  /** Restore persisted group order (including submenus) by reordering live DOM nodes. */
  restore(): void {
    const raw = this._storage.load(STORAGE_KEY);
    if (!raw) return;
    let entries: ToolbarEntry[];
    try { entries = JSON.parse(raw) as ToolbarEntry[]; } catch { return; }
    for (const entry of entries) {
      if (typeof entry === 'string') {
        const el = document.getElementById(entry);
        if (el && this._container.contains(el)) this._container.appendChild(el);
      } else {
        let wrap = document.getElementById(entry.id);
        if (!wrap) {
          wrap = this._createSubmenuWrap(entry.id);
          this._container.appendChild(wrap);
        }
        const flyout = wrap.querySelector('.toolbar-submenu-flyout') as HTMLElement;
        for (const childId of entry.children) {
          const child = document.getElementById(childId);
          if (child) flyout.appendChild(child);
        }
      }
    }
  }

  /** Persist current group order (including submenu structure) to storage. */
  save(): void {
    this._storage.save(STORAGE_KEY, JSON.stringify(this._readEntries()));
  }

  /** Reset to original DOM order, removing any submenus, and clear storage. */
  reset(): void {
    for (const sm of Array.from(this._container.querySelectorAll('.toolbar-submenu'))) {
      const flyout = sm.querySelector('.toolbar-submenu-flyout');
      if (flyout) {
        while (flyout.firstChild) this._container.insertBefore(flyout.firstChild, sm);
      }
      sm.remove();
    }
    this._applyOrder(this._defaultOrder);
    this._storage.clear(STORAGE_KEY);
  }

  /**
   * Merge two toolbar groups into a submenu wrapper.
   * The target group is replaced in-place by the wrapper; the source group is appended inside.
   * Returns the submenu wrapper id, or null if either group is not found.
   */
  mergeGroups(targetId: string, sourceId: string): string | null {
    const target = document.getElementById(targetId);
    const source = document.getElementById(sourceId);
    if (!target || !source) return null;
    if (!this._container.contains(target) || !this._container.contains(source)) return null;
    if (targetId === sourceId) return null;

    const submenuId = `tbg-sub-${++_submenuCounter}`;
    const wrap = this._createSubmenuWrap(submenuId);
    const flyout = wrap.querySelector('.toolbar-submenu-flyout') as HTMLElement;

    // Insert wrapper where target currently sits, then move both groups inside
    this._container.insertBefore(wrap, target);
    flyout.appendChild(target);
    flyout.appendChild(source);

    this.save();
    return submenuId;
  }

  private _createSubmenuWrap(id: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'toolbar-group toolbar-submenu';
    wrap.id = id;
    const trigger = document.createElement('button');
    trigger.className = 'btn toolbar-submenu-trigger';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'true');
    const flyout = document.createElement('div');
    flyout.className = 'toolbar-submenu-flyout';
    wrap.appendChild(trigger);
    wrap.appendChild(flyout);
    return wrap;
  }

  private _readOrder(): string[] {
    return Array.from(this._container.children)
      .map(el => el.id)
      .filter(id => id.length > 0);
  }

  private _readEntries(): ToolbarEntry[] {
    return Array.from(this._container.children)
      .filter(el => el.id.length > 0)
      .map(el => {
        if (el.classList.contains('toolbar-submenu')) {
          const children = Array.from(
            el.querySelector('.toolbar-submenu-flyout')?.children ?? []
          ).map(c => c.id).filter(id => id.length > 0);
          return { type: 'submenu' as const, id: el.id, children };
        }
        return el.id;
      });
  }

  private _applyOrder(order: string[]): void {
    for (const id of order) {
      const el = document.getElementById(id);
      if (el && this._container.contains(el)) this._container.appendChild(el);
    }
  }
}
