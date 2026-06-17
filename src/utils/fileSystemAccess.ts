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
