import { describe, it, expect, afterEach, vi } from 'vitest';
import { canUseFsSave, pickSaveTarget, writeToHandle, canUseFsOpen, pickOpenFiles, ensureReadPermission, type FsOpenHandle } from '../../src/utils/fileSystemAccess';

type GlobalWithPicker = typeof globalThis & { showSaveFilePicker?: unknown; showOpenFilePicker?: unknown };
const g = globalThis as GlobalWithPicker;

afterEach(() => { delete g.showSaveFilePicker; delete g.showOpenFilePicker; });

/** Minimal fake handle that records what was written + closed. */
function fakeHandle() {
  const chunks: Uint8Array[] = [];
  let closed = false;
  return {
    handle: {
      name: 'out.pdf',
      createWritable: () => Promise.resolve({
        write: (d: BufferSource) => { chunks.push(new Uint8Array(d as ArrayBuffer)); return Promise.resolve(); },
        close: () => { closed = true; return Promise.resolve(); },
      }),
    },
    chunks,
    wasClosed: () => closed,
  };
}

describe('fileSystemAccess', () => {
  it('canUseFsSave() reflects showSaveFilePicker presence', () => {
    expect(canUseFsSave()).toBe(false);
    g.showSaveFilePicker = () => Promise.resolve({});
    expect(canUseFsSave()).toBe(true);
  });

  it('pickSaveTarget() returns "download" when the API is absent', async () => {
    expect(await pickSaveTarget('x.pdf')).toBe('download');
  });

  it('pickSaveTarget() returns the handle when the picker resolves', async () => {
    const fh = fakeHandle();
    g.showSaveFilePicker = vi.fn(() => Promise.resolve(fh.handle));
    expect(await pickSaveTarget('x.pdf')).toBe(fh.handle);
  });

  it('pickSaveTarget() returns "cancelled" when the user aborts', async () => {
    g.showSaveFilePicker = () => Promise.reject(new DOMException('aborted', 'AbortError'));
    expect(await pickSaveTarget('x.pdf')).toBe('cancelled');
  });

  it('pickSaveTarget() falls back to "download" on a non-abort error', async () => {
    g.showSaveFilePicker = () => Promise.reject(new DOMException('blocked', 'SecurityError'));
    expect(await pickSaveTarget('x.pdf')).toBe('download');
  });

  it('writeToHandle() writes the bytes and closes the stream', async () => {
    const fh = fakeHandle();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await writeToHandle(fh.handle, bytes);
    expect(fh.chunks).toHaveLength(1);
    expect(Array.from(fh.chunks[0])).toEqual([1, 2, 3, 4]);
    expect(fh.wasClosed()).toBe(true);
  });
});

/**
 * #54b — the OPEN side. Its contract differs from the save side in one way that matters: a dismissed
 * dialog is `'cancelled'` and an unavailable API is `'unavailable'`, and the caller MUST tell them
 * apart. Collapsing them means cancelling the native picker immediately opens the fallback
 * `<input type=file>` — a second file dialog the user did not ask for, in response to saying no.
 */
describe('fileSystemAccess — open (#54b)', () => {
  const TYPE = { description: 'PDF document', mime: 'application/pdf', ext: '.pdf' };
  const handle = (name: string): FsOpenHandle =>
    ({ name, getFile: () => Promise.resolve(new File([], name)) });

  it('canUseFsOpen() reflects the API presence', () => {
    expect(canUseFsOpen()).toBe(false);
    g.showOpenFilePicker = () => Promise.resolve([]);
    expect(canUseFsOpen()).toBe(true);
  });

  it('returns the chosen handles', async () => {
    g.showOpenFilePicker = () => Promise.resolve([handle('a.pdf'), handle('b.pdf')]);
    const r = await pickOpenFiles([TYPE]);
    expect(Array.isArray(r) && r.map(h => h.name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('returns "unavailable" when the API is absent — NOT "cancelled"', async () => {
    expect(await pickOpenFiles([TYPE])).toBe('unavailable');
  });

  it('returns "cancelled" when the user dismisses the dialog', async () => {
    g.showOpenFilePicker = () => Promise.reject(new DOMException('aborted', 'AbortError'));
    expect(await pickOpenFiles([TYPE])).toBe('cancelled');
  });

  it('treats an empty selection as "cancelled" rather than an empty open', async () => {
    g.showOpenFilePicker = () => Promise.resolve([]);
    expect(await pickOpenFiles([TYPE])).toBe('cancelled');
  });

  it('falls back to "unavailable" on a non-abort error, so the plain input can take over', async () => {
    g.showOpenFilePicker = () => Promise.reject(new DOMException('blocked', 'SecurityError'));
    expect(await pickOpenFiles([TYPE])).toBe('unavailable');
  });

  describe('ensureReadPermission', () => {
    it('is granted without prompting when the permission is already granted', async () => {
      const request = vi.fn();
      const h = { ...handle('a.pdf'), queryPermission: () => Promise.resolve('granted' as PermissionState), requestPermission: request };
      expect(await ensureReadPermission(h as unknown as FsOpenHandle)).toBe(true);
      expect(request).not.toHaveBeenCalled();
    });

    it('prompts when the stored permission has lapsed, and reports the answer', async () => {
      // The normal path for a handle remembered across a reload: Chromium answers 'prompt'.
      const h = {
        ...handle('a.pdf'),
        queryPermission: () => Promise.resolve('prompt' as PermissionState),
        requestPermission: () => Promise.resolve('granted' as PermissionState),
      };
      expect(await ensureReadPermission(h as unknown as FsOpenHandle)).toBe(true);

      const denied = { ...h, requestPermission: () => Promise.resolve('denied' as PermissionState) };
      expect(await ensureReadPermission(denied as unknown as FsOpenHandle)).toBe(false);
    });

    it('assumes granted when the implementation has no permission methods', async () => {
      // They are non-standard. The subsequent getFile() is the real check.
      expect(await ensureReadPermission(handle('a.pdf'))).toBe(true);
    });

    it('is false when the handle throws — a revoked entry rejects rather than answering denied', async () => {
      const h = { ...handle('a.pdf'), queryPermission: () => Promise.reject(new Error('gone')) };
      expect(await ensureReadPermission(h as unknown as FsOpenHandle)).toBe(false);
    });
  });
});
