/**
 * File System Access API helpers (Wave 2 #54) — progressive enhancement.
 *
 * On Chromium the main Download path uses the native "Save As" dialog and writes
 * the file directly (`showSaveFilePicker` → `createWritable`); on browsers without
 * the API it falls back to the existing anchor download. The picker requires
 * transient user activation, so callers MUST acquire the target (pickSaveTarget)
 * synchronously after the click — before any slow `await` (e.g. PDF assembly) —
 * then write to it afterwards.
 *
 * Types are declared locally rather than relying on lib.dom (showSaveFilePicker
 * is still non-standard and absent from some TS lib versions) — no extra dep.
 */

interface FsWritable {
  write(data: BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}
export interface FsFileHandle {
  readonly name: string;
  createWritable(): Promise<FsWritable>;
}
type ShowSaveFilePicker = (opts?: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FsFileHandle>;

function picker(): ShowSaveFilePicker | undefined {
  return (globalThis as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
}

/** True when the browser can save via the native file picker. */
export function canUseFsSave(): boolean {
  return typeof picker() === 'function';
}

/** A resolved save destination: a writable handle, plain download, or user-cancel. */
export type SaveTarget = FsFileHandle | 'download' | 'cancelled';

/**
 * The file type advertised in the native Save dialog's type filter. Defaults to
 * PDF so the historic PDF callers keep their exact behaviour; non-PDF exports
 * (PNG / CSV / DOCX) pass their own so the dialog offers the right extension.
 */
export interface SaveFileType {
  description: string;
  mime: string;
  ext: string;
}

const PDF_TYPE: SaveFileType = { description: 'PDF document', mime: 'application/pdf', ext: '.pdf' };

/**
 * Acquire a save target within the user-activation window. Returns:
 *  - an `FsFileHandle` when the user picks a location,
 *  - `'cancelled'` when the user dismisses the dialog (AbortError) → caller should no-op,
 *  - `'download'` when the API is unavailable OR fails for any non-abort reason
 *    (progressive-enhancement contract: degrade to the anchor download, never fail
 *    the export because the fancy save path was blocked).
 *
 * `type` advertises the file's extension/MIME in the dialog filter (defaults to
 * PDF). The picker MUST be called within transient user activation — before any
 * slow `await` (PDF assembly, DOCX build, canvas raster) — or it throws.
 */
export async function pickSaveTarget(suggestedName: string, type: SaveFileType = PDF_TYPE): Promise<SaveTarget> {
  const show = picker();
  if (!show) return 'download';
  try {
    return await show({
      suggestedName,
      types: [{ description: type.description, accept: { [type.mime]: [type.ext] } }],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    return 'download';
  }
}

/**
 * Write data to a previously-acquired file handle and close the stream. Accepts
 * a `Uint8Array` (serialized PDF bytes) or a `Blob` (PNG / CSV / DOCX exports) —
 * the underlying writable handles both, so no copy is forced for the Blob path.
 */
export async function writeToHandle(handle: FsFileHandle, data: Uint8Array | Blob): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(data instanceof Blob ? data : (data.buffer as ArrayBuffer));
  await writable.close();
}

// ── #54b: the OPEN side ───────────────────────────────────────────────────────────────────────
// Deliberately the mirror image of the save side above, including its failure contract: an
// unavailable or blocked picker degrades to the existing hidden `<input type=file>` rather than
// failing the open. The one asymmetry is permissions — a SAVE handle is used immediately inside the
// activation that produced it, while a REMEMBERED open handle is used minutes or days later, from a
// different session, so it has to be re-authorised. See {@link ensureReadPermission}.

/** A handle from the open picker: readable, and re-authorisable after a reload. */
export interface FsOpenHandle {
  readonly name: string;
  getFile(): Promise<File>;
  /** Present on Chromium; absent on implementations that do not gate re-use. */
  queryPermission?(d?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  /** Identity comparison across sessions — a path string is never exposed to the page. */
  isSameEntry?(other: FsOpenHandle): Promise<boolean>;
}
type ShowOpenFilePicker = (opts?: {
  multiple?: boolean;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FsOpenHandle[]>;

function openPicker(): ShowOpenFilePicker | undefined {
  return (globalThis as { showOpenFilePicker?: ShowOpenFilePicker }).showOpenFilePicker;
}

/** True when the browser can open via the native file picker (and so can remember the handle). */
export function canUseFsOpen(): boolean {
  return typeof openPicker() === 'function';
}

/**
 * Handles the user chose, `'cancelled'` when they dismissed the dialog, or `'unavailable'` when the
 * API is absent or refused for any non-abort reason — the caller then falls back to the plain input.
 *
 * `'cancelled'` and `'unavailable'` are distinct on purpose: a dismissed dialog must NOT re-open the
 * fallback input, or cancelling would immediately confront the user with a second file dialog.
 */
export type OpenTarget = FsOpenHandle[] | 'cancelled' | 'unavailable';

export async function pickOpenFiles(
  types: SaveFileType[], multiple = true,
): Promise<OpenTarget> {
  const show = openPicker();
  if (!show) return 'unavailable';
  try {
    const handles = await show({
      multiple,
      types: types.map(t => ({ description: t.description, accept: { [t.mime]: [t.ext] } })),
    });
    return handles.length > 0 ? handles : 'cancelled';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    return 'unavailable';
  }
}

/**
 * Re-authorise a remembered handle before reading it.
 *
 * A stored handle survives a reload but its permission does NOT: Chromium returns `'prompt'` for a
 * handle from an earlier session, and `getFile()` then throws `NotAllowedError`. `requestPermission`
 * needs transient user activation, which is why this is called from the click that opens the recent
 * file and never speculatively — probing on startup would either throw or, worse, train the user to
 * dismiss a prompt they did not ask for.
 *
 * An implementation without the permission methods (they are non-standard) is treated as granted;
 * the subsequent `getFile()` is the real check and its failure is handled by the caller.
 */
export async function ensureReadPermission(handle: FsOpenHandle): Promise<boolean> {
  try {
    if (typeof handle.queryPermission === 'function') {
      if (await handle.queryPermission({ mode: 'read' }) === 'granted') return true;
    }
    if (typeof handle.requestPermission !== 'function') return true;
    return await handle.requestPermission({ mode: 'read' }) === 'granted';
  } catch {
    // A revoked or stale handle throws rather than resolving 'denied'. Same answer either way.
    return false;
  }
}
