import Sortable from 'sortablejs';
import type { ILayoutStorage } from './layoutStorage';

const STORAGE_KEY = 'pdfturbo_toolbar_order';

/** CSS filter for SortableJS — these elements cannot be dragged. */
const DRAG_FILTER = '.toolbar-sep,.toolbar-spacer,input[type="file"],.toolbar-submenu-trigger,.draw-flyout,.file-menu-dropdown';

/** CSS selector for individually draggable items within a group. */
const DRAG_ITEMS = '.btn,.draw-flyout-wrap,.file-menu-wrap';

/**
 * Companion elements that must follow their button when moved.
 * Key = button id, Value = companion element id.
 */
const COMPANIONS: Record<string, string> = {
  addImageBtn: 'addImageInput',
};

type GroupEntry   = { type: 'group';   id: string; items: string[] };
type SubmenuEntry = { type: 'submenu'; id: string; items: string[] };
type LayoutEntry  = GroupEntry | SubmenuEntry;

interface SavedLayout {
  version: 'v2';
  groups: LayoutEntry[];
}

let _submenuCounter = 0;

export class ToolbarCustomizer {
  private readonly _initial: SavedLayout;
  private _sortable: Sortable | null = null;
  private _groupSortables: Sortable[] = [];

  constructor(
    private readonly _container: HTMLElement,
    private readonly _storage: ILayoutStorage,
  ) {
    this._initial = this._snapshot();
  }

  /** Enable individual-button drag-and-drop. Creates nested Sortable instances. */
  enableDragDrop(): void {
    if (this._sortable) return;
    this._attachGroupSortables();
    // Top-level container sortable: reorders groups themselves.
    // Buttons are excluded at this level — inner sortables handle them.
    this._sortable = new Sortable(this._container, {
      group: { name: 'toolbar-groups', pull: false, put: false },
      animation: 150,
      delay: 200,
      delayOnTouchOnly: true,
      draggable: '.toolbar-group',
      filter: `${DRAG_FILTER},${DRAG_ITEMS}`,
      onEnd: () => this.save(),
    });
  }

  /** Disable all drag-and-drop (container + all group sortables). */
  disableDragDrop(): void {
    for (const s of this._groupSortables) s.destroy();
    this._groupSortables = [];
    this._sortable?.destroy();
    this._sortable = null;
  }

  /**
   * Restore persisted button order (including submenu structure) by
   * reordering live DOM nodes. Must be called before enableDragDrop().
   */
  restore(): void {
    const raw = this._storage.load(STORAGE_KEY);
    if (!raw) return;
    let layout: SavedLayout;
    try {
      const parsed = JSON.parse(raw) as { version?: string };
      // Silently skip legacy format (plain string array).
      if (parsed.version !== 'v2') return;
      layout = parsed as SavedLayout;
    } catch { return; }

    for (const entry of layout.groups) {
      if (entry.type === 'submenu') {
        let wrap = document.getElementById(entry.id);
        if (!wrap) {
          wrap = this._createSubmenuWrap(entry.id);
          this._container.appendChild(wrap);
        }
        const flyout = wrap.querySelector('.toolbar-submenu-flyout') as HTMLElement;
        for (const itemId of entry.items) {
          this._moveItemTo(itemId, flyout);
        }
      } else {
        const groupEl = document.getElementById(entry.id);
        if (!groupEl) continue;
        for (const itemId of entry.items) {
          this._moveItemTo(itemId, groupEl);
        }
      }
    }
  }

  /** Persist current button positions (per group) to storage. */
  save(): void {
    this._storage.save(STORAGE_KEY, JSON.stringify(this._snapshot()));
  }

  /** Reset to factory layout: dissolve submenus, restore original button order, clear storage. */
  reset(): void {
    // Dissolve all submenus, returning children to the container temporarily.
    for (const sm of Array.from(this._container.querySelectorAll('.toolbar-submenu'))) {
      const flyout = sm.querySelector('.toolbar-submenu-flyout');
      if (flyout) {
        while (flyout.firstChild) this._container.insertBefore(flyout.firstChild, sm);
      }
      sm.remove();
    }
    // Restore each group's original button order.
    for (const entry of this._initial.groups) {
      if (entry.type !== 'group') continue;
      const groupEl = document.getElementById(entry.id);
      if (!groupEl) continue;
      for (const itemId of entry.items) {
        this._moveItemTo(itemId, groupEl);
      }
    }
    this._storage.clear(STORAGE_KEY);
    // Refresh nested sortables since the DOM was restructured.
    if (this._sortable) {
      for (const s of this._groupSortables) s.destroy();
      this._groupSortables = [];
      this._attachGroupSortables();
    }
  }

  /**
   * Merge two toolbar groups into a submenu wrapper.
   * The target group is replaced in-place by the wrapper; the source follows inside.
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

    this._container.insertBefore(wrap, target);
    flyout.appendChild(target);
    flyout.appendChild(source);

    this.save();
    // Refresh nested sortables to include the new submenu flyout.
    if (this._sortable) {
      for (const s of this._groupSortables) s.destroy();
      this._groupSortables = [];
      this._attachGroupSortables();
    }
    return submenuId;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Attach a Sortable instance to each group and submenu flyout, enabling
   * button-level drag-and-drop with cross-group movement.
   */
  private _attachGroupSortables(): void {
    // Groups at container level
    const allGroups = Array.from(this._container.querySelectorAll('.toolbar-group'));
    for (const group of allGroups) {
      const isSubmenu = group.classList.contains('toolbar-submenu');
      const target = isSubmenu
        ? (group.querySelector('.toolbar-submenu-flyout') as HTMLElement | null)
        : (group as HTMLElement);
      if (!target) continue;

      const sortable = new Sortable(target, {
        group: { name: 'toolbar-buttons', pull: true, put: true },
        animation: 150,
        delay: 200,
        delayOnTouchOnly: true,
        filter: DRAG_FILTER,
        draggable: DRAG_ITEMS,
        onEnd: (evt) => {
          this._handleButtonMove(evt);
          this.save();
        },
      });
      this._groupSortables.push(sortable);
    }
  }

  /** After a button drag completes, move any companion element to follow the button. */
  private _handleButtonMove(evt: Sortable.SortableEvent): void {
    const item = evt.item as HTMLElement;
    const companionId = item.id ? COMPANIONS[item.id] : undefined;
    if (!companionId) return;
    const companion = document.getElementById(companionId);
    if (!companion || !evt.to) return;
    const next = item.nextSibling;
    if (next) evt.to.insertBefore(companion, next);
    else evt.to.appendChild(companion);
  }

  /** Move an element (and its companion) to a container. */
  private _moveItemTo(id: string, container: Element): void {
    const el = document.getElementById(id);
    if (!el) return;
    container.appendChild(el);
    const companionId = COMPANIONS[id];
    if (companionId) {
      const companion = document.getElementById(companionId);
      if (companion) container.appendChild(companion);
    }
  }

  /** Snapshot the current layout: groups and their ordered button IDs. */
  private _snapshot(): SavedLayout {
    const groups: LayoutEntry[] = [];
    for (const el of Array.from(this._container.children)) {
      if (!(el instanceof HTMLElement) || !el.id) continue;
      if (el.classList.contains('toolbar-submenu')) {
        const flyout = el.querySelector('.toolbar-submenu-flyout');
        const items = flyout
          ? Array.from(flyout.children)
              .filter((c): c is HTMLElement => c instanceof HTMLElement && !!c.id)
              .map(c => c.id)
          : [];
        groups.push({ type: 'submenu', id: el.id, items });
      } else if (el.classList.contains('toolbar-group')) {
        const items = Array.from(el.children)
          .filter((c): c is HTMLElement =>
            c instanceof HTMLElement &&
            !!c.id &&
            !c.classList.contains('toolbar-sep') &&
            !c.matches('input[type="file"]'))
          .map(c => c.id);
        groups.push({ type: 'group', id: el.id, items });
      }
    }
    return { version: 'v2', groups };
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
}
