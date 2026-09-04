import type { DocumentPage, WatermarkSettings } from '../core/documentModel';
import type { BatesSettings } from '../export/batesStamp';
import type { ElementJSON } from '../elements/annotationElement';
import type { InkStroke } from './inkLayer';

export interface SavedState {
  elements: ElementJSON[];
  pages: DocumentPage[];
  watermark: WatermarkSettings;
  /** #61b — Bates / page-numbering. Optional: blobs written before #61b lack it
   * and fall back to the model default on restore (no SCHEMA_VERSION bump needed). */
  bates?: BatesSettings;
  currentPageIndex: number;
  // Source PDF bytes keyed by sourcePdfId
  sourcePdfs: Array<{ id: string; name: string; bytes: Uint8Array }>;
  formValues?: Record<string, Record<string, string>>;
  inkData?: Record<string, InkStroke[]>;
  /**
   * Data-shape version (M0 #3). Stamped by saveState; checked on load so a future
   * incompatible blob is discarded instead of being read into a mismatched shape
   * (which previously could crash session restore). Distinct from DB_VERSION, which
   * versions the IndexedDB object-store structure, not the value shape.
   */
  schemaVersion?: number;
}

/** Current SavedState data-shape version. Bump + add a migration arm on any breaking shape change. */
export const SCHEMA_VERSION = 1;

const DB_NAME = 'pdf-editor';
/**
 * The IndexedDB schema version — distinct from {@link SCHEMA_VERSION}, which versions the RECORD.
 * Exported so tests that must seed or inspect the raw database use the live value instead of a
 * copy: two test files had hardcoded `2` and broke the moment this moved to 3 for the #54b recent
 * store, each for a reason unrelated to what the test was about.
 */
export const DB_VERSION = 3;
const STORE = 'state';
/**
 * #54b — remembered `FileSystemFileHandle`s ("recent files"). A separate store rather than a field
 * on the session record: recents outlive a session, survive "clear session", and are keyed
 * per-entry, so putting them in `state` would couple two lifetimes that differ on purpose.
 */
export const RECENT_STORE = 'recent';
const KEY = 'current';

/**
 * Migrate a raw persisted record to the current SavedState shape, or discard it.
 * - missing version → predates versioning; its shape IS v1 by definition → accept.
 * - === SCHEMA_VERSION → accept.
 * - < SCHEMA_VERSION → no migration registered yet → discard (start fresh).
 * - > SCHEMA_VERSION → written by a newer build → cannot safely read → discard.
 * Returns null for a discarded or non-object record.
 */
export function migrateOrDiscard(raw: unknown): SavedState | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = (raw as { schemaVersion?: number }).schemaVersion;
  if (v === undefined || v === SCHEMA_VERSION) return raw as SavedState;
  // Future migration chains land here, keyed on v. None exist while SCHEMA_VERSION === 1.
  return null;
}

/**
 * Open the app database, running any structural upgrade. Exported as `openAppDB` for
 * `infra/recentFiles.ts`, which owns a different store in the SAME database — a second database
 * would double the upgrade surface and the "blocked upgrade" failure modes for no gain.
 *
 * The caller MUST `close()` the connection (see the note in `saveState`'s finally block: leaked
 * connections accumulate for the life of the tab and block every later upgrade).
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Structural (object-store) migrations keyed on the version being upgraded
      // FROM. oldVersion === 0 means a brand-new DB. The 'state' store has existed
      // since v1; future store/index additions add arms keyed on higher oldVersions.
      // The idempotent create guards any DB that reached this version without it.
      switch (event.oldVersion) {
        case 0:
        default:
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
          // Added at DB_VERSION 3. An upgrade never DROPS a store, so an existing user's session
          // in `state` is carried across untouched; the idempotent guard covers a DB that already
          // reached this version by another path.
          if (!db.objectStoreNames.contains(RECENT_STORE)) db.createObjectStore(RECENT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export { openDB as openAppDB };

export async function saveState(state: SavedState): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    // IDB genuinely unavailable (private browsing, permissions, a blocked upgrade). There is
    // no persistence to be had in this context, so skipping is correct and stays silent.
    // NOTE the scope: this arm covers only the OPEN. A failure of the WRITE below is data
    // loss and MUST reach the caller — conflating the two is what made every lost write look
    // like a success. `SessionManager._flush` already distinguishes them properly (quota →
    // `toast.storageFull`, anything else → `silent()`), so the filter that used to live here
    // was both redundant and the thing that broke the contract.
    return;
  }
  try {
    const stamped: SavedState = { ...state, schemaVersion: SCHEMA_VERSION };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).put(stamped, KEY);
      tx.oncomplete = () => resolve();
      // Read the REQUEST's error, NOT the transaction's. Per the IndexedDB spec the step that
      // SETS `transaction.error` is "abort a transaction", and it runs only AFTER this error
      // event has finished dispatching — so `tx.error` is still `null` right here. Rejecting
      // with it therefore rejected with `null`, which is not `instanceof DOMException`, so the
      // old catch-all swallowed every write failure and `saveState` RESOLVED. Pinned by
      // `tests/core/storageErrors.test.ts`, whose first test asserts that ordering directly.
      // `onabort` is the backstop for a transaction that aborts with no failed request.
      tx.onerror = () => reject(req.error ?? tx.error ?? new DOMException('IndexedDB write failed', 'UnknownError'));
      tx.onabort = () => reject(tx.error ?? req.error ?? new DOMException('IndexedDB write aborted', 'AbortError'));
    });
  } finally {
    // Every call opened a fresh connection and never closed one, so they accumulated for the
    // life of the tab and blocked any later `deleteDatabase`/version upgrade indefinitely.
    db.close();
  }
}

export async function loadState(): Promise<SavedState | null> {
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    return null;   // no IDB → nothing to restore
  }
  try {
    return await new Promise<SavedState | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(migrateOrDiscard(req.result));
      req.onerror = () => reject(req.error);
    });
  } catch {
    // A failed READ is recoverable in a way a failed write is not: the caller's fallback is
    // simply "start with an empty session", which is what a null already means here.
    return null;
  } finally {
    db.close();
  }
}

export async function clearState(): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      // Same wrong-property bug as `saveState` had — `tx.error` is null during this event.
      // Unlike `saveState` this stays best-effort by design (the caller has no recovery for a
      // failed cleanup), so the rejection is still swallowed below. It is corrected anyway:
      // leaving a dead branch here would silently mislead whoever next makes this report.
      tx.onerror = () => reject(req.error ?? tx.error ?? new DOMException('IndexedDB clear failed', 'UnknownError'));
      tx.onabort = () => reject(tx.error ?? req.error ?? new DOMException('IndexedDB clear aborted', 'AbortError'));
    });
  } catch {
    // best-effort cleanup
  } finally {
    db.close();
  }
}
