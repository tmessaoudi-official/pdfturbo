import type { DocumentPage, WatermarkSettings } from '../core/documentModel';
import type { ElementJSON } from '../elements/annotationElement';
import type { InkStroke } from './inkLayer';

export interface SavedState {
  elements: ElementJSON[];
  pages: DocumentPage[];
  watermark: WatermarkSettings;
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
const DB_VERSION = 2;
const STORE = 'state';
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
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveState(state: SavedState): Promise<void> {
  try {
    const db = await openDB();
    const stamped: SavedState = { ...state, schemaVersion: SCHEMA_VERSION };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(stamped, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw err;  // re-throw so caller can notify user
    }
    // IDB unavailable (private browsing, permissions) — silently skip
  }
}

export async function loadState(): Promise<SavedState | null> {
  try {
    const db = await openDB();
    return await new Promise<SavedState | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(migrateOrDiscard(req.result));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearState(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}
