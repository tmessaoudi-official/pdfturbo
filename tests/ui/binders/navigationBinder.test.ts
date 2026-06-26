import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installRefitOnResize } from '../../../src/ui/binders/navigationBinder';

/** Minimal fake window exposing only what installRefitOnResize touches. */
function makeWin(initialWidth: number) {
  const listeners: Array<() => void> = [];
  return {
    innerWidth: initialWidth,
    addEventListener: (type: string, cb: () => void) => {
      if (type === 'resize') listeners.push(cb);
    },
    fireResize() {
      listeners.forEach((cb) => cb());
    },
  };
}

function makeApp(fitMode: boolean, pageCount: number) {
  return {
    _isFitMode: fitMode,
    documentModel: { pageCount },
    fitToWidth: vi.fn(() => Promise.resolve()),
  };
}

const noopGuard = (_p: unknown): void => {};

describe('installRefitOnResize — keyboard (height-only) resize must NOT refit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does NOT refit when only the height changed (soft keyboard) — width unchanged', () => {
    const win = makeWin(390);
    const app = makeApp(true, 1);
    installRefitOnResize(app as never, noopGuard, win as never);

    // Android soft keyboard: window resizes but innerWidth stays the same.
    win.fireResize();
    vi.advanceTimersByTime(300);

    expect(app.fitToWidth).not.toHaveBeenCalled();
  });

  it('DOES refit when the viewport width actually changed (rotation / desktop↔mobile)', () => {
    const win = makeWin(390);
    const app = makeApp(true, 1);
    installRefitOnResize(app as never, noopGuard, win as never);

    win.innerWidth = 800; // genuine width change
    win.fireResize();
    vi.advanceTimersByTime(300);

    expect(app.fitToWidth).toHaveBeenCalledTimes(1);
  });

  it('does not refit when not in fit-mode, even on a width change', () => {
    const win = makeWin(390);
    const app = makeApp(false, 1);
    installRefitOnResize(app as never, noopGuard, win as never);

    win.innerWidth = 800;
    win.fireResize();
    vi.advanceTimersByTime(300);

    expect(app.fitToWidth).not.toHaveBeenCalled();
  });

  it('does not refit when no document is loaded', () => {
    const win = makeWin(390);
    const app = makeApp(true, 0);
    installRefitOnResize(app as never, noopGuard, win as never);

    win.innerWidth = 800;
    win.fireResize();
    vi.advanceTimersByTime(300);

    expect(app.fitToWidth).not.toHaveBeenCalled();
  });

  it('debounces a burst of width changes into a single refit', () => {
    const win = makeWin(390);
    const app = makeApp(true, 1);
    installRefitOnResize(app as never, noopGuard, win as never);

    win.innerWidth = 500; win.fireResize();
    win.innerWidth = 600; win.fireResize();
    win.innerWidth = 700; win.fireResize();
    vi.advanceTimersByTime(300);

    expect(app.fitToWidth).toHaveBeenCalledTimes(1);
  });
});
