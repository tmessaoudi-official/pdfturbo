import { describe, it, expect, beforeEach } from 'vitest';
import { ToolbarCustomizer } from '../../src/ui/toolbarCustomizer';
import type { ILayoutStorage } from '../../src/ui/layoutStorage';

class FakeStorage implements ILayoutStorage {
  private _store: Record<string, string> = {};
  load(key: string): string | null { return this._store[key] ?? null; }
  save(key: string, value: string): void { this._store[key] = value; }
  clear(key: string): void { delete this._store[key]; }
}

function makeToolbar(ids: string[]): HTMLElement {
  const toolbar = document.createElement('div');
  document.body.appendChild(toolbar); // toolbar in body first so getElementById works
  for (const id of ids) {
    const group = document.createElement('div');
    group.id = id;
    toolbar.appendChild(group);
  }
  return toolbar;
}

describe('ToolbarCustomizer', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    document.body.innerHTML = '';
    storage = new FakeStorage();
  });

  it('restore() is a no-op when storage is empty', () => {
    const toolbar = makeToolbar(['a', 'b', 'c']);
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    const ids = Array.from(toolbar.children).map(el => el.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('restore() reorders live DOM nodes to match saved order', () => {
    const toolbar = makeToolbar(['a', 'b', 'c']);
    storage.save('pdfturbo_toolbar_order', JSON.stringify(['c', 'a', 'b']));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    const ids = Array.from(toolbar.children).map(el => el.id);
    expect(ids).toEqual(['c', 'a', 'b']);
  });

  it('restore() silently ignores corrupt JSON', () => {
    const toolbar = makeToolbar(['a', 'b']);
    storage.save('pdfturbo_toolbar_order', 'not-json{');
    const tc = new ToolbarCustomizer(toolbar, storage);
    expect(() => tc.restore()).not.toThrow();
  });

  it('restore() skips unknown ids not in the container', () => {
    const toolbar = makeToolbar(['a', 'b']);
    storage.save('pdfturbo_toolbar_order', JSON.stringify(['b', 'GHOST', 'a']));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    const ids = Array.from(toolbar.children).map(el => el.id);
    expect(ids).toEqual(['b', 'a']);
  });

  it('save() persists current DOM order to storage', () => {
    const toolbar = makeToolbar(['a', 'b', 'c']);
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.save();
    expect(JSON.parse(storage.load('pdfturbo_toolbar_order') ?? '[]')).toEqual(['a', 'b', 'c']);
  });

  it('save() after restore() persists new order', () => {
    const toolbar = makeToolbar(['a', 'b', 'c']);
    storage.save('pdfturbo_toolbar_order', JSON.stringify(['c', 'b', 'a']));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    tc.save();
    expect(JSON.parse(storage.load('pdfturbo_toolbar_order') ?? '[]')).toEqual(['c', 'b', 'a']);
  });

  it('reset() restores original DOM order captured at construction', () => {
    const toolbar = makeToolbar(['a', 'b', 'c']);
    storage.save('pdfturbo_toolbar_order', JSON.stringify(['c', 'b', 'a']));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore(); // reorders to c,b,a
    tc.reset();   // back to a,b,c
    const ids = Array.from(toolbar.children).map(el => el.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('reset() clears storage', () => {
    const toolbar = makeToolbar(['a', 'b', 'c']);
    storage.save('pdfturbo_toolbar_order', JSON.stringify(['c', 'b', 'a']));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.reset();
    expect(storage.load('pdfturbo_toolbar_order')).toBeNull();
  });

  it('restore() does not destroy live node references', () => {
    const toolbar = makeToolbar(['a', 'b', 'c']);
    const nodeA = document.getElementById('a');
    storage.save('pdfturbo_toolbar_order', JSON.stringify(['c', 'a', 'b']));
    const tc = new ToolbarCustomizer(toolbar, storage);
    tc.restore();
    // Same object reference — not recreated
    expect(document.getElementById('a')).toBe(nodeA);
  });
});
