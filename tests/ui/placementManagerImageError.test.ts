// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlacementManager, type IPlacementContext } from '../../src/ui/placementManager';

function makeCtx() {
  const reportError = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), silent: vi.fn() };
  const ctx = {
    documentModel: { currentPage: { id: 'p1' } },
    reportError,
    setMode: vi.fn(),
  } as unknown as IPlacementContext;
  return { ctx, reportError };
}

function imageFileEvent(): Event {
  const file = new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' });
  return { target: { files: [file], value: '' } } as unknown as Event;
}

const flush = () => new Promise<void>(r => { setTimeout(r, 0); });
const OrigFileReader = globalThis.FileReader;
const OrigImage = globalThis.Image;

describe('PlacementManager image upload error handling (M0 #11)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    globalThis.FileReader = OrigFileReader;
    globalThis.Image = OrigImage;
  });

  it('toasts when the FileReader fails to read the file', async () => {
    class FailingReader {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      error = new Error('read fail');
      readAsDataURL() { queueMicrotask(() => this.onerror?.()); }
    }
    globalThis.FileReader = FailingReader as unknown as typeof FileReader;

    const { ctx, reportError } = makeCtx();
    new PlacementManager(ctx).handleImageFileSelect(imageFileEvent());
    await flush();

    expect(reportError.error).toHaveBeenCalledWith('toast.imageLoadFailed', expect.anything());
  });

  it('toasts when the image fails to decode', async () => {
    class OkReader {
      onerror: (() => void) | null = null;
      onload: ((ev: { target: { result: string } }) => void) | null = null;
      readAsDataURL() { queueMicrotask(() => this.onload?.({ target: { result: 'data:image/png;base64,AAAA' } })); }
    }
    class FailingImage {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onerror?.()); }
    }
    globalThis.FileReader = OkReader as unknown as typeof FileReader;
    globalThis.Image = FailingImage as unknown as typeof Image;

    const { ctx, reportError } = makeCtx();
    new PlacementManager(ctx).handleImageFileSelect(imageFileEvent());
    await flush();

    expect(reportError.error).toHaveBeenCalledWith('toast.imageLoadFailed');
    expect(ctx.setMode).not.toHaveBeenCalled();
  });
});
