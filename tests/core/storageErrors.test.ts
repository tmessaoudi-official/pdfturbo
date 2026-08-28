// @vitest-environment jsdom
/**
 * STORAGE FAILURE-REPORTING GUARDS — `src/infra/storage.ts`.
 *
 * Companion to `storage.test.ts`, which covers the happy path. This file covers the paths that
 * only matter when something goes WRONG, because those were the ones that were broken.
 *
 * ── The defect these pin ──────────────────────────────────────────────────────────
 * `saveState` wired its transaction as `tx.onerror = () => reject(tx.error)`. That reads the
 * wrong object. Per the IndexedDB spec, the step that SETS `transaction.error` is "abort a
 * transaction", and it runs only AFTER the request's `error` event has finished dispatching —
 * so inside `tx.onerror` the transaction has not aborted yet, `tx.error` is still `null`, and
 * the real failure is sitting on `request.error`.
 *
 * The consequence was a total swallow, not a degraded message. `saveState`'s catch reads:
 *
 *     if (err instanceof DOMException && err.name === 'QuotaExceededError') throw err;
 *     // IDB unavailable (private browsing, permissions) — silently skip
 *
 * and `null instanceof DOMException` is `false`, so EVERY write failure — a genuine quota
 * exhaustion included — took the "silently skip" arm. `saveState` then RESOLVED, so
 * `SessionManager._flush` saw a success and `toast.storageFull` was unreachable code. The user
 * keeps editing a document that has silently stopped being persisted, and loses it on reload.
 *
 * `tests/core/sessionManager.test.ts` could not catch this: it `vi.mock`s `saveState` wholesale
 * and rejects with a hand-built DOMException, so both sides are green while the seam between
 * them is broken. That is why these tests drive the REAL module against a REAL IndexedDB.
 *
 * ── Why the failure is induced this way ───────────────────────────────────────────
 * A quota error cannot be produced on demand, and stubbing the transaction would encode the
 * very convention under test. Instead the test pre-creates the SAME database at the SAME
 * version with a unique index, so `openDB`'s `onupgradeneeded` never runs, the index survives,
 * and a genuine `ConstraintError` reaches the real code path. The null-ness of `tx.error` is a
 * property of event ORDERING, not of which error is carried, so this stands in faithfully for
 * the quota case (pinned separately by the first test below).
 */
import 'fake-indexeddb/auto';   // a real IndexedDB implementation, not a stub
import { describe, it, expect } from 'vitest';
import { saveState, loadState, clearState, type SavedState } from '../../src/infra/storage';

/** Must track `src/infra/storage.ts`. Asserted below rather than assumed. */
const DB_NAME = 'pdf-editor';
const DB_VERSION = 2;
const STORE = 'state';

/**
 * A blocked `deleteDatabase` never fires `success` while a connection is held, so this resolves
 * on a short deadline instead of waiting it out. Measured: with the leak present, fake-indexeddb
 * fires NO event at all — not even `onblocked` — so without the deadline the leak surfaced as a
 * 30s vitest timeout, a signal that reads "slow test" when the truth is "a connection leaked".
 * 2s is ~3 orders of magnitude above an unblocked in-memory delete, so it cannot flake into a
 * false positive on a loaded machine.
 */
function deleteDb(name: string): Promise<{ blocked: boolean }> {
  return new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(name);
    const timer = setTimeout(() => resolve({ blocked: true }), 2000);
    const done = (blocked: boolean) => { clearTimeout(timer); resolve({ blocked }); };
    r.onblocked = () => done(true);
    r.onsuccess = () => done(false);
    r.onerror = () => done(false);
  });
}

/**
 * Create the database `storage.ts` will open, at the version it expects, with a unique index
 * on `currentPageIndex`, and squat index value 42 under a different key. `saveState` writing a
 * state whose `currentPageIndex` is 42 then fails for real.
 */
function seedDbWithUniqueIndex(): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore(STORE);
      store.createIndex('uniq', 'currentPageIndex', { unique: true });
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ currentPageIndex: 42 }, 'squatter');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(new Error('seed failed'));
    };
    open.onerror = () => reject(open.error);
  });
}

/**
 * Fail fast and say which step stalled. 3s is ~3 orders of magnitude above an unblocked
 * in-memory IndexedDB operation, so it cannot flake into a false positive on a loaded machine.
 */
function withDeadline<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label}() never settled — a leaked IndexedDB connection is blocking it`)),
        3000,
      );
    }),
  ]);
}

const collidingState = (): SavedState => ({
  elements: [],
  pages: [],
  watermark: {} as SavedState['watermark'],
  currentPageIndex: 42,          // collides with the squatter on the unique index
  sourcePdfs: [{ id: 's1', name: 'secret.pdf', bytes: new Uint8Array([1, 2, 3]) }],
});

describe('IndexedDB error reporting', () => {
  /**
   * CONTRACT PIN on IndexedDB itself. Every other test here rests on this ordering fact, so it
   * is asserted directly: if a future IDB implementation ever set `transaction.error` before
   * the request's error event finishes, this test says so in one line instead of leaving a
   * reader to infer it from an opaque `saveState` failure.
   */
  it('IndexedDB leaves transaction.error null during the request error event', async () => {
    await deleteDb('storage-contract-probe');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('storage-contract-probe', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('s').createIndex('uniq', 'v', { unique: true });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('s', 'readwrite');
      tx.objectStore('s').put({ v: 42 }, 'a');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('seed failed'));
    });

    const seen: Record<string, string> = {};
    await new Promise<void>((resolve) => {
      const tx = db.transaction('s', 'readwrite');
      const req = tx.objectStore('s').put({ v: 42 }, 'b');   // unique-index collision
      const nameOf = (e: DOMException | null) => (e === null ? 'NULL' : e.name);
      tx.onerror = () => {
        seen.txErrorInOnError = nameOf(tx.error);
        seen.reqErrorInOnError = nameOf(req.error);
      };
      tx.onabort = () => { seen.txErrorInOnAbort = nameOf(tx.error); resolve(); };
      tx.oncomplete = () => resolve();
    });
    db.close();

    expect(seen).toEqual({
      txErrorInOnError: 'NULL',            // ← the whole reason the bug existed
      reqErrorInOnError: 'ConstraintError',
      txErrorInOnAbort: 'ConstraintError',
    });
  });

  it('saveState rejects with the real DOMException when the write fails', async () => {
    await deleteDb(DB_NAME);
    await seedDbWithUniqueIndex();

    let thrown: unknown = 'DID_NOT_REJECT';
    try {
      await saveState(collidingState());
    } catch (e) {
      thrown = e;
    }

    // CONTROL FIRST — the write genuinely failed and nothing landed under storage's own key.
    // Without this, "saveState rejected" would not prove any data was actually at risk, and a
    // guard made only of the assertion below could pass for the wrong reason.
    await expect(loadState()).resolves.toBeNull();

    expect(thrown, 'a lost write must not look like a successful persist').not.toBe('DID_NOT_REJECT');
    expect(thrown).toBeInstanceOf(DOMException);
    // The error must arrive INTACT: `saveState`'s caller filters on `err.name`, so rejecting
    // with a truthy-but-nameless value would still leave `toast.storageFull` unreachable.
    expect((thrown as DOMException).name).toBe('ConstraintError');

    await deleteDb(DB_NAME);
  });

  /**
   * The connection leak found alongside the swallow. `openDB` opened a fresh connection on
   * every call and never closed it, so with autosave running they accumulated for the life of
   * the tab — and any later `deleteDatabase` or version upgrade is BLOCKED by the still-open
   * handles. `onblocked` firing is the observable form of that leak.
   */
  it('does not leak the IndexedDB connection after each operation', async () => {
    await deleteDb(DB_NAME);
    const empty: SavedState = {
      elements: [], pages: [], watermark: {} as SavedState['watermark'],
      currentPageIndex: 0, sourcePdfs: [],
    };
    // Every step is deadlined. A leaked connection blocks the pending `deleteDatabase`, and a
    // pending delete in turn blocks every later `open` — so the failure lands as a HANG inside
    // whichever call comes next, before any assertion below is reached. Without these the
    // regression surfaced only as an opaque 30s vitest timeout; with them it names the step.
    await withDeadline(saveState(empty), 'saveState');
    await withDeadline(loadState(), 'loadState');
    await withDeadline(clearState(), 'clearState');

    const { blocked } = await deleteDb(DB_NAME);
    expect(blocked, 'an open connection was left behind — deleteDatabase was blocked').toBe(false);
  });
});
