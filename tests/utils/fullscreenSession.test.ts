// @vitest-environment jsdom
// The browser half of a full-screen stay, shared by the phone pad (row 11 phone half, 2026-11-12) and the ✍ dialog
// (row 11 PC half, 2026-11-16). Each case here is one the phone half's 6C rounds fixed, ported from padPage.test.ts:
// the CSS-only path undoes nothing; a grant that lands after the stay ended gives the fullscreen back and never locks;
// unlock() follows only a lock that RESOLVED; a refused request or lock leaves the CSS fill in place without throwing.
import { describe, it, expect, vi } from 'vitest';
import { createFullscreenSession, type FullscreenApi } from '../../src/utils/fullscreenSession';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeFs(enabled = true) {
  const req = deferred();
  const lock = deferred();
  let active = false;
  const fs = {
    enabled: vi.fn(() => enabled),
    request: vi.fn(() => req.promise.then(() => { active = true; })),
    exit: vi.fn(() => { active = false; return Promise.resolve(); }),
    active: vi.fn(() => active),
    lockLandscape: vi.fn(() => lock.promise),
    unlock: vi.fn(),
  } satisfies FullscreenApi;
  return { fs, req, lock, setActive: (v: boolean) => { active = v; } };
}

const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });

describe('createFullscreenSession (row 11: shared by the phone pad and the ✍ dialog)', () => {
  it('without the API (iPhone Safari): begin and end call nothing — the CSS fill alone, nothing to undo', async () => {
    const { fs } = fakeFs(false);
    let full = true;
    const s = createFullscreenSession(fs, () => full);
    s.begin();
    full = false;
    s.end();
    await flush();
    expect([fs.request, fs.exit, fs.lockLandscape, fs.unlock].map((f) => f.mock.calls.length)).toEqual([0, 0, 0, 0]);
  });

  it('asks for fullscreen, then a landscape lock; ending unlocks and exits', async () => {
    const { fs, req, lock } = fakeFs();
    let full = true;
    const s = createFullscreenSession(fs, () => full);
    s.begin();
    expect(fs.request).toHaveBeenCalledTimes(1);
    req.resolve();
    await flush();
    expect(fs.lockLandscape).toHaveBeenCalledTimes(1);
    lock.resolve();
    await flush();
    full = false;
    s.end();
    expect([fs.unlock.mock.calls.length, fs.exit.mock.calls.length]).toEqual([1, 1]);
  });

  it('a grant that lands after the stay ended gives the fullscreen back and never locks', async () => {
    const { fs, req } = fakeFs();
    let full = true;
    const s = createFullscreenSession(fs, () => full);
    s.begin();
    full = false;
    s.end(); // before the grant: not active yet, nothing to exit
    expect(fs.exit).not.toHaveBeenCalled();
    req.resolve();
    await flush();
    expect(fs.exit).toHaveBeenCalledTimes(1);
    expect(fs.lockLandscape).not.toHaveBeenCalled();
  });

  it('left while the lock was pending: unlock when it resolves, never before', async () => {
    const { fs, req, lock } = fakeFs();
    let full = true;
    const s = createFullscreenSession(fs, () => full);
    s.begin();
    req.resolve();
    await flush();
    full = false;
    s.end();
    expect(fs.unlock).not.toHaveBeenCalled(); // the lock has not resolved: nothing to release yet
    lock.resolve();
    await flush();
    expect(fs.unlock).toHaveBeenCalledTimes(1);
  });

  it('a REFUSED lock is never unlocked (unlock after a refusal was never measured on Safari)', async () => {
    const { fs, req, lock } = fakeFs();
    let full = true;
    const s = createFullscreenSession(fs, () => full);
    s.begin();
    req.resolve();
    await flush();
    lock.reject(new DOMException('desktop', 'NotSupportedError'));
    await flush();
    full = false;
    s.end();
    expect(fs.unlock).not.toHaveBeenCalled();
    expect(fs.exit).toHaveBeenCalledTimes(1); // the fullscreen itself was granted: give it back
  });

  it('a REFUSED request throws nothing and leaves nothing to undo', async () => {
    const { fs, req } = fakeFs();
    let full = true;
    const s = createFullscreenSession(fs, () => full);
    s.begin();
    req.reject(new TypeError('Permissions check failed'));
    await flush();
    full = false;
    s.end();
    expect([fs.exit.mock.calls.length, fs.unlock.mock.calls.length, fs.lockLandscape.mock.calls.length]).toEqual([0, 0, 0]);
  });

  it('end() without a begin, or twice, calls nothing more', async () => {
    const { fs, req, lock } = fakeFs();
    let full = true;
    const s = createFullscreenSession(fs, () => full);
    s.end();
    expect(fs.exit).not.toHaveBeenCalled();
    s.begin();
    req.resolve();
    lock.resolve();
    await flush();
    full = false;
    s.end();
    s.end();
    expect([fs.exit.mock.calls.length, fs.unlock.mock.calls.length]).toEqual([1, 1]);
  });
});
