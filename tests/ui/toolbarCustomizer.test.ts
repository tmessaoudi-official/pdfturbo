import { describe, it, expect, beforeEach, vi } from 'vitest';
import Sortable from 'sortablejs';
import { ToolbarCustomizer } from '../../src/ui/toolbarCustomizer';
import type { ILayoutStorage } from '../../src/ui/layoutStorage';

vi.mock('sortablejs', () => ({
  default: vi.fn().mockImplementation(function SortableMock() {
    return { destroy: vi.fn() };
  }),
}));

class FakeStorage implements ILayoutStorage {
  private _store: Record<string, string> = {};
  load(key: string): string | null { return this._store[key] ?? null; }
  save(key: string, value: string): void { this._store[key] = value; }
  clear(key: string): void { delete this._store[key]; }
}

const STORAGE_KEY = 'pdfturbo_toolbar_order';

/** Create a toolbar container with toolbar-group children, each containing buttons. */
function makeToolbar(groups: { id: string; buttons?: string[] }[]): HTMLElement {
  const toolbar = document.createElement('div');
  document.body.appendChild(toolbar);
  for (const { id: gid, buttons = [] } of groups) {
    const group = document.createElement('div');
    group.id = gid;
    group.className = 'toolbar-group';
    for (const bid of buttons) {
      const btn = document.createElement('button');
      btn.id = bid;
      btn.className = 'btn';
      group.appendChild(btn);
    }
    toolbar.appendChild(group);
  }
  return toolbar;
}

/** Convenience: get child ids of an element. Returns [] if el is null. */
function childIds(el: Element | null): string[] {
  if (!el) return [];
  return Array.from(el.children).map(c => (c as HTMLElement).id).filter(Boolean);
}

describe('ToolbarCustomizer', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    document.body.innerHTML = '';
    storage = new FakeStorage();
    vi.mocked(Sortable).mockClear();
  });

  // ── restore ────────────────────────────────────────────────────────────────

  it('restore() is a no-op when storage is empty', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a', 'b'] },
      { id: 'g2', buttons: ['c'] },
    ]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    expect(childIds(document.getElementById('g1'))).toEqual(['a', 'b']);
    expect(childIds(document.getElementById('g2'))).toEqual(['c']);
  });

  it('restore() silently ignores corrupt JSON', () => {
    const toolbar = makeToolbar([{ id: 'g1', buttons: ['a', 'b'] }]);
    storage.save(STORAGE_KEY, 'not-json{');
    const tc = new ToolbarCustomizer(toolbar, storage);
    expect(() => tc.restore()).not.toThrow();
  });

  it('restore() silently ignores legacy string-array format', () => {
    const toolbar = makeToolbar([{ id: 'g1', buttons: ['a', 'b', 'c'] }]);
    // Old format — should be silently skipped; DOM stays unchanged.
    storage.save(STORAGE_KEY, JSON.stringify(['c', 'a', 'b']));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    expect(childIds(document.getElementById('g1'))).toEqual(['a', 'b', 'c']);
  });

  it('restore() reorders buttons within a group', () => {
    const toolbar = makeToolbar([{ id: 'g1', buttons: ['a', 'b', 'c'] }]);
    storage.save(STORAGE_KEY, JSON.stringify({
      version: 'v2',
      groups: [{ type: 'group', id: 'g1', items: ['c', 'a', 'b'] }],
    }));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    expect(childIds(document.getElementById('g1'))).toEqual(['c', 'a', 'b']);
  });

  it('restore() moves a button to a different group', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a', 'b'] },
      { id: 'g2', buttons: ['c'] },
    ]);
    storage.save(STORAGE_KEY, JSON.stringify({
      version: 'v2',
      groups: [
        { type: 'group', id: 'g1', items: ['a'] },
        { type: 'group', id: 'g2', items: ['c', 'b'] },
      ],
    }));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    expect(childIds(document.getElementById('g2'))).toEqual(['c', 'b']);
  });

  it('restore() skips unknown ids not in the document', () => {
    const toolbar = makeToolbar([{ id: 'g1', buttons: ['a', 'b'] }]);
    storage.save(STORAGE_KEY, JSON.stringify({
      version: 'v2',
      groups: [{ type: 'group', id: 'g1', items: ['b', 'GHOST', 'a'] }],
    }));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    // Only real buttons are moved; GHOST is silently skipped.
    expect(childIds(document.getElementById('g1'))).toEqual(['b', 'a']);
  });

  it('restore() does not destroy live node references', () => {
    const toolbar = makeToolbar([{ id: 'g1', buttons: ['a', 'b', 'c'] }]);
    const nodeA = document.getElementById('a');
    storage.save(STORAGE_KEY, JSON.stringify({
      version: 'v2',
      groups: [{ type: 'group', id: 'g1', items: ['c', 'a', 'b'] }],
    }));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    expect(document.getElementById('a')).toBe(nodeA);
  });

  it('restore() recreates submenu wrapper and moves items inside', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a', 'b'] },
      { id: 'g2', buttons: ['c'] },
    ]);
    storage.save(STORAGE_KEY, JSON.stringify({
      version: 'v2',
      groups: [
        { type: 'submenu', id: 'tbg-sub-99', items: ['a', 'b'] },
        { type: 'group',   id: 'g2',         items: ['c'] },
      ],
    }));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    const wrap   = document.getElementById('tbg-sub-99');
    const flyout = wrap?.querySelector('.toolbar-submenu-flyout');
    expect(wrap).not.toBeNull();
    expect(flyout?.children[0]?.id).toBe('a');
    expect(flyout?.children[1]?.id).toBe('b');
  });

  // ── save ──────────────────────────────────────────────────────────────────

  it('save() persists v2 layout with group and button ids', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a', 'b'] },
      { id: 'g2', buttons: ['c'] },
    ]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.save();
    const saved = JSON.parse(storage.load(STORAGE_KEY) ?? '{}') as { version: string; groups: unknown[] };
    expect(saved.version).toBe('v2');
    expect(saved.groups).toMatchObject([
      { type: 'group', id: 'g1', items: ['a', 'b'] },
      { type: 'group', id: 'g2', items: ['c'] },
    ]);
  });

  it('save() reflects button order after restore()', () => {
    const toolbar = makeToolbar([{ id: 'g1', buttons: ['a', 'b', 'c'] }]);
    storage.save(STORAGE_KEY, JSON.stringify({
      version: 'v2',
      groups: [{ type: 'group', id: 'g1', items: ['c', 'b', 'a'] }],
    }));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    tc.save();
    const saved = JSON.parse(storage.load(STORAGE_KEY) ?? '{}') as { groups: Array<{ items: string[] }> };
    expect(saved.groups[0]?.items).toEqual(['c', 'b', 'a']);
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  it('reset() restores original button order captured at construction', () => {
    const toolbar = makeToolbar([{ id: 'g1', buttons: ['a', 'b', 'c'] }]);
    storage.save(STORAGE_KEY, JSON.stringify({
      version: 'v2',
      groups: [{ type: 'group', id: 'g1', items: ['c', 'b', 'a'] }],
    }));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();  // reorder to c, b, a
    tc.reset();    // back to a, b, c
    expect(childIds(document.getElementById('g1'))).toEqual(['a', 'b', 'c']);
  });

  it('reset() clears storage', () => {
    const toolbar = makeToolbar([{ id: 'g1', buttons: ['a', 'b', 'c'] }]);
    storage.save(STORAGE_KEY, JSON.stringify({
      version: 'v2',
      groups: [{ type: 'group', id: 'g1', items: ['c', 'b', 'a'] }],
    }));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.reset();
    expect(storage.load(STORAGE_KEY)).toBeNull();
  });

  it('reset() unwraps submenus and restores original order', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a'] },
      { id: 'g2', buttons: ['b'] },
      { id: 'g3', buttons: ['c'] },
    ]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.mergeGroups('g1', 'g2');  // wraps g1 and g2 in a submenu
    tc.reset();
    // g1 and g2 must be direct children again with their original button order.
    expect(document.getElementById('g1')?.parentElement).toBe(toolbar);
    expect(document.getElementById('g2')?.parentElement).toBe(toolbar);
    expect(childIds(document.getElementById('g1'))).toContain('a');
    expect(childIds(document.getElementById('g2'))).toContain('b');
  });

  // ── enableDragDrop / disableDragDrop ──────────────────────────────────────

  it('enableDragDrop() creates multiple Sortable instances (one per group + container)', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a'] },
      { id: 'g2', buttons: ['b'] },
    ]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.enableDragDrop();
    const MockS = vi.mocked(Sortable);
    // 2 groups + 1 container = 3 calls
    expect(MockS.mock.calls.length).toBe(3);
  });

  it('enableDragDrop() uses mobile delay options on inner sortables', () => {
    const toolbar = makeToolbar([{ id: 'g1', buttons: ['a'] }]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.enableDragDrop();
    const MockS = vi.mocked(Sortable);
    // First call is the group sortable.
    const opts = MockS.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts['delay']).toBe(200);
    expect(opts['delayOnTouchOnly']).toBe(true);
  });

  it('enableDragDrop() is idempotent — does not create additional Sortable instances', () => {
    const toolbar = makeToolbar([{ id: 'g1', buttons: ['a'] }]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.enableDragDrop();
    const countAfterFirst = vi.mocked(Sortable).mock.calls.length;
    tc.enableDragDrop();
    expect(vi.mocked(Sortable).mock.calls.length).toBe(countAfterFirst);
  });

  it('disableDragDrop() destroys all Sortable instances', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a'] },
      { id: 'g2', buttons: ['b'] },
    ]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.enableDragDrop();
    const instances = vi.mocked(Sortable).mock.results.map(r => r.value as { destroy: ReturnType<typeof vi.fn> });
    tc.disableDragDrop();
    for (const inst of instances) {
      expect(inst.destroy).toHaveBeenCalledOnce();
    }
  });

  it('disableDragDrop() is safe when DnD was never enabled', () => {
    const toolbar = makeToolbar([{ id: 'g1', buttons: ['a'] }]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    expect(() => tc.disableDragDrop()).not.toThrow();
  });

  // ── mergeGroups ────────────────────────────────────────────────────────────

  it('mergeGroups() inserts a submenu wrapper where target was', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a'] },
      { id: 'g2', buttons: ['b'] },
      { id: 'g3', buttons: ['c'] },
    ]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.mergeGroups('g1', 'g3');
    const children = Array.from(toolbar.children);
    expect(children[0]?.classList.contains('toolbar-submenu')).toBe(true);
    expect(children[1]?.id).toBe('g2');
  });

  it('mergeGroups() places both groups inside the submenu flyout', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a'] },
      { id: 'g2', buttons: ['b'] },
    ]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    const submenuId = tc.mergeGroups('g1', 'g2') as string;
    const wrap   = document.getElementById(submenuId);
    const flyout = wrap?.querySelector('.toolbar-submenu-flyout');
    expect(flyout?.children[0]?.id).toBe('g1');
    expect(flyout?.children[1]?.id).toBe('g2');
  });

  it('mergeGroups() preserves live node references', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a'] },
      { id: 'g2', buttons: ['b'] },
    ]);
    const nodeG1 = document.getElementById('g1');
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.mergeGroups('g1', 'g2');
    expect(document.getElementById('g1')).toBe(nodeG1);
  });

  it('mergeGroups() saves the submenu structure to storage', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a'] },
      { id: 'g2', buttons: ['b'] },
      { id: 'g3', buttons: ['c'] },
    ]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    const submenuId = tc.mergeGroups('g1', 'g2') as string;
    const saved = JSON.parse(storage.load(STORAGE_KEY) ?? '{}') as { groups: Array<{ type: string; id: string; items: string[] }> };
    const sub = saved.groups.find(e => e.id === submenuId);
    expect(sub).toMatchObject({ type: 'submenu', items: ['g1', 'g2'] });
  });

  it('mergeGroups() returns null when target is not in container', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a'] },
      { id: 'g2', buttons: ['b'] },
    ]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    expect(tc.mergeGroups('GHOST', 'g2')).toBeNull();
  });

  it('mergeGroups() returns null when source equals target', () => {
    const toolbar = makeToolbar([
      { id: 'g1', buttons: ['a'] },
      { id: 'g2', buttons: ['b'] },
    ]);
    const tc = new ToolbarCustomizer(toolbar, storage);
    expect(tc.mergeGroups('g1', 'g1')).toBeNull();
  });
});
