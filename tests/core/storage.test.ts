/**
 * Storage module — saveState, loadState, clearState.
 * Uses fake-indexeddb to provide a real IndexedDB implementation in jsdom.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';   // patches globalThis.indexedDB before imports
import {
  saveState, loadState, clearState,
  SCHEMA_VERSION, migrateOrDiscard,
  type SavedState,
} from '../../src/infra/storage';

const makeState = (override: Partial<SavedState> = {}): SavedState => ({
  elements: [],
  pages: [{ id: 'p1', sourcePdfId: 'src1', sourcePageNum: 1, rotation: 0 }],
  watermark: { enabled: false, text: '', color: '#000000', fontSize: 48, opacity: 0.15, angle: -30, density: 3 },
  currentPageIndex: 0,
  sourcePdfs: [],
  ...override,
});

beforeEach(async () => {
  // Clean state between tests
  await clearState();
});

// ── loadState — nothing stored ─────────────────────────────────────────────────
describe('loadState', () => {
  it('returns null when nothing has been saved', async () => {
    const result = await loadState();
    expect(result).toBeNull();
  });
});

// ── saveState → loadState round-trip ──────────────────────────────────────────
describe('saveState / loadState round-trip', () => {
  it('restores the same data that was saved', async () => {
    const state = makeState();
    await saveState(state);
    const loaded = await loadState();
    expect(loaded).not.toBeNull();
    expect((loaded as SavedState).currentPageIndex).toBe(0);
    expect((loaded as SavedState).pages).toHaveLength(1);
    expect((loaded as SavedState).pages[0].id).toBe('p1');
  });

  it('overwrites previous state on second save', async () => {
    await saveState(makeState({ currentPageIndex: 0 }));
    await saveState(makeState({ currentPageIndex: 3 }));
    const loaded = await loadState();
    expect((loaded as SavedState).currentPageIndex).toBe(3);
  });

  it('preserves elements array', async () => {
    const state = makeState({
      elements: [
        { id: 1, type: 'text', x: 10, y: 20, width: 200, height: 30, pageId: 'p1',
          text: 'hello', fontSize: 14, color: '#000000', fontFamily: 'Arial',
          bold: false, italic: false, multiline: true },
      ],
    });
    await saveState(state);
    const loaded = await loadState();
    expect((loaded as SavedState).elements).toHaveLength(1);
    expect((loaded as SavedState).elements[0].type).toBe('text');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((loaded as SavedState).elements[0] as any).text).toBe('hello');
  });

  it('preserves watermark settings', async () => {
    const state = makeState({
      watermark: { enabled: true, text: 'DRAFT', color: '#FF0000', fontSize: 60, opacity: 0.3, angle: 45, density: 5 },
    });
    await saveState(state);
    const loaded = await loadState();
    expect((loaded as SavedState).watermark.enabled).toBe(true);
    expect((loaded as SavedState).watermark.text).toBe('DRAFT');
    expect((loaded as SavedState).watermark.color).toBe('#FF0000');
    expect((loaded as SavedState).watermark.fontSize).toBe(60);
    expect((loaded as SavedState).watermark.angle).toBe(45);
  });

  it('preserves inkData when provided', async () => {
    const state = makeState({
      inkData: {
        p1: [{ type: 'ink', points: [{ x: 0, y: 0 }, { x: 10, y: 5 }], width: 2, color: '#000' }],
      },
    });
    await saveState(state);
    const loaded = await loadState();
    expect((loaded as SavedState).inkData).toBeDefined();
    expect((loaded as SavedState).inkData?.['p1']).toHaveLength(1);
    expect((loaded as SavedState).inkData?.['p1'][0].color).toBe('#000');
  });

  it('preserves formValues when provided', async () => {
    const state = makeState({ formValues: { p1: { field1: 'value1', field2: 'value2' } } });
    await saveState(state);
    const loaded = await loadState();
    expect((loaded as SavedState).formValues).toBeDefined();
    expect((loaded as SavedState).formValues?.['p1']?.['field1']).toBe('value1');
  });

  it('preserves multiple pages', async () => {
    const state = makeState({
      pages: [
        { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 },
        { id: 'p2', sourcePdfId: 's1', sourcePageNum: 2, rotation: 90 },
        { id: 'p3', sourcePdfId: 's2', sourcePageNum: 1, rotation: 0 },
      ],
      currentPageIndex: 2,
    });
    await saveState(state);
    const loaded = await loadState();
    expect((loaded as SavedState).pages).toHaveLength(3);
    expect((loaded as SavedState).currentPageIndex).toBe(2);
    expect((loaded as SavedState).pages[1].rotation).toBe(90);
  });
});

// ── clearState ─────────────────────────────────────────────────────────────────
describe('clearState', () => {
  it('makes loadState return null after clear', async () => {
    await saveState(makeState());
    await clearState();
    const loaded = await loadState();
    expect(loaded).toBeNull();
  });

  it('clearState is idempotent (safe to call on empty store)', async () => {
    await expect(clearState()).resolves.not.toThrow();
    await expect(clearState()).resolves.not.toThrow();
  });
});

// ── M0 #3: schema versioning — stamp on write, migrate-or-discard on load ─────
/** Write a raw record bypassing saveState's version stamping (simulates legacy/foreign blobs). */
function rawPut(value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pdf-editor', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(value, 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe('schema versioning', () => {
  it('saveState stamps the current SCHEMA_VERSION', async () => {
    await saveState(makeState());
    const loaded = await loadState();
    expect((loaded as SavedState).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('loadState accepts a legacy blob with no schemaVersion (pre-versioning back-compat)', async () => {
    const legacy = makeState({ currentPageIndex: 2 });
    delete (legacy as Partial<SavedState>).schemaVersion;
    await rawPut(legacy);
    const loaded = await loadState();
    expect(loaded).not.toBeNull();
    expect((loaded as SavedState).currentPageIndex).toBe(2);
  });

  it('loadState discards a blob written by a newer, incompatible schema', async () => {
    await rawPut({ ...makeState(), schemaVersion: SCHEMA_VERSION + 1 });
    expect(await loadState()).toBeNull();
  });

  describe('migrateOrDiscard (pure)', () => {
    it('returns the state unchanged when version matches', () => {
      const s = { ...makeState(), schemaVersion: SCHEMA_VERSION };
      expect(migrateOrDiscard(s)).toEqual(s);
    });
    it('accepts undefined version as current-shape (legacy)', () => {
      const s = makeState();
      expect(migrateOrDiscard(s)).not.toBeNull();
    });
    it('discards a future version', () => {
      expect(migrateOrDiscard({ ...makeState(), schemaVersion: SCHEMA_VERSION + 1 })).toBeNull();
    });
    it('discards non-object / null input', () => {
      expect(migrateOrDiscard(null)).toBeNull();
      expect(migrateOrDiscard('garbage')).toBeNull();
    });
  });
});

// ── SavedState interface coverage ─────────────────────────────────────────────
describe('SavedState interface', () => {
  it('state without optional fields is accepted', async () => {
    const minimal: SavedState = {
      elements: [],
      pages: [],
      watermark: { enabled: false, text: '', color: '#000', fontSize: 48, opacity: 0.15, angle: -30, density: 3 },
      currentPageIndex: 0,
      sourcePdfs: [],
    };
    await saveState(minimal);
    const loaded = await loadState();
    expect((loaded as SavedState).formValues).toBeUndefined();
    expect((loaded as SavedState).inkData).toBeUndefined();
  });
});
