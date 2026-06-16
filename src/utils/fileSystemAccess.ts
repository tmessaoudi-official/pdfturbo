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
 * Acquire a save target within the user-activation window. Returns:
 *  - an `FsFileHandle` when the user picks a location,
 *  - `'cancelled'` when the user dismisses the dialog (AbortError) → caller should no-op,
 *  - `'download'` when the API is unavailable OR fails for any non-abort reason
 *    (progressive-enhancement contract: degrade to the anchor download, never fail
 *    the export because the fancy save path was blocked).
 */
export async function pickSaveTarget(suggestedName: string): Promise<SaveTarget> {
  const show = picker();
  if (!show) return 'download';
  try {
    return await show({
      suggestedName,
      types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    return 'download';
  }
}

/** Write bytes to a previously-acquired file handle and close the stream. */
export async function writeToHandle(handle: FsFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(bytes.buffer as ArrayBuffer);
  await writable.close();
}
