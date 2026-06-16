import { describe, it, expect, afterEach, vi } from 'vitest';
import { canUseFsSave, pickSaveTarget, writeToHandle } from '../../src/utils/fileSystemAccess';

type GlobalWithPicker = typeof globalThis & { showSaveFilePicker?: unknown };
const g = globalThis as GlobalWithPicker;

afterEach(() => { delete g.showSaveFilePicker; });

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
