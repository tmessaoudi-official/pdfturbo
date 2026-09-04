/**
 * #54b — remembered file handles ("recent files"), persisted in IndexedDB.
 *
 * A `FileSystemFileHandle` is structured-cloneable, so the browser can store the USER'S CHOICE
 * across sessions without the page ever learning a filesystem path. Re-opening one still needs the
 * user's permission (see `ensureReadPermission`) — the handle is a capability the user re-grants,
 * not a stored path we can read behind their back. That property is why this feature is safe in a
 * tool whose whole promise is that nothing leaves the device.
 *
 * Everything here fails SOFT. Recent files are a convenience: private browsing, a cleared origin, a
 * browser without the API, or a quota error must degrade to "no recents", never to a broken open
 * flow. `loadState`'s hard-won lesson applies — the swallow is scoped to the operations that are
 * genuinely optional, and never hides a failure the user needs to know about.
 */
import type { FsOpenHandle } from '../utils/fileSystemAccess';
import { openAppDB, RECENT_STORE } from './storage';

/** One remembered file. `id` is opaque and monotonic; `at` drives the newest-first order. */
export interface RecentFile {
  id: string;
  name: string;
  handle: FsOpenHandle;
  at: number;
}

/**
 * How many are kept. Eight matches `recentColors`' cap for the same reason: a list long enough to
 * be useful and short enough to scan without a scrollbar in a menu.
 */
export const RECENT_CAP = 8;

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    // `request.error`, NOT `transaction.error` — per the IndexedDB spec the transaction's error is
    // set by the ABORT step, which runs only after this event finishes dispatching, so `tx.error`
    // is still null in here. Reading the wrong one is what made every failed autosave look like a
    // success (see CLAUDE.md § "saveState read the wrong error property").
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Newest first, capped. Returns [] on any failure — recents are never load-bearing. */
export async function listRecentFiles(): Promise<RecentFile[]> {
  let db: IDBDatabase | undefined;
  try {
    db = await openAppDB();
    const tx = db.transaction(RECENT_STORE, 'readonly');
    const all = await idbRequest(tx.objectStore(RECENT_STORE).getAll() as IDBRequest<RecentFile[]>);
    return all
      .filter(r => r && typeof r.name === 'string' && r.handle)
      .sort((a, b) => b.at - a.at)
      .slice(0, RECENT_CAP);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/**
 * Remember `handle`, moving it to the front if it is already there and trimming to {@link RECENT_CAP}.
 *
 * De-duplication uses `isSameEntry`, the only identity the API exposes — two handles for the same
 * file are different objects and compare unequal. Matching on NAME instead would collapse two
 * genuinely different `invoice.pdf`s from different folders into one entry, and then open the wrong
 * document. When `isSameEntry` is unavailable the entry is added without de-duplication: a duplicate
 * row is a cosmetic flaw, opening the wrong file is not.
 */
export async function addRecentFile(handle: FsOpenHandle): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    const existing = await listRecentFiles();
    let sameId: string | null = null;
    if (typeof handle.isSameEntry === 'function') {
      for (const r of existing) {
        try {
          if (await handle.isSameEntry(r.handle)) { sameId = r.id; break; }
        } catch { /* a stale stored handle cannot be compared; treat as different */ }
      }
    }
    const id = sameId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // STRICTLY increasing, not just `Date.now()`. Opening a multi-file selection adds several
    // entries inside the same millisecond, `at` ties, and a stable sort then falls back to insertion
    // order — so the list came out OLDEST first for exactly the case that adds more than one entry.
    // Caught by the ordering test, which is why it asserts order rather than membership.
    const at = Math.max(Date.now(), (existing[0]?.at ?? 0) + 1);
    const record: RecentFile = { id, name: handle.name, handle, at };

    db = await openAppDB();
    const tx = db.transaction(RECENT_STORE, 'readwrite');
    const store = tx.objectStore(RECENT_STORE);
    await idbRequest(store.put(record, id));
    // Trim beyond the cap, oldest first. Done here rather than on read so the store cannot grow
    // without bound in a long-lived origin.
    const after = (await idbRequest(store.getAll() as IDBRequest<RecentFile[]>))
      .filter(Boolean)
      .sort((a, b) => b.at - a.at);
    for (const stale of after.slice(RECENT_CAP)) await idbRequest(store.delete(stale.id));
  } catch {
    // Remembering is best-effort: the document the user just opened is already open.
  } finally {
    db?.close();
  }
}

/** Forget one entry — used when its handle turns out to be unreadable (moved, deleted, revoked). */
export async function removeRecentFile(id: string): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await openAppDB();
    const tx = db.transaction(RECENT_STORE, 'readwrite');
    await idbRequest(tx.objectStore(RECENT_STORE).delete(id));
  } catch {
    // Nothing to do: the entry stays and will be retried next time.
  } finally {
    db?.close();
  }
}

/** Forget everything. Wired to the same place that clears the session. */
export async function clearRecentFiles(): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await openAppDB();
    const tx = db.transaction(RECENT_STORE, 'readwrite');
    await idbRequest(tx.objectStore(RECENT_STORE).clear());
  } catch {
    // Best-effort, as above.
  } finally {
    db?.close();
  }
}
