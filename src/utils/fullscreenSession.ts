/**
 * The browser half of a full-screen stay (phone-signature-pad row 11), shared by the phone pad (`pad/padPage.ts`, the
 * phone half, 2026-11-12) and the ✍ dialog (`ui/signatureFullscreen.ts`, the PC half, 2026-11-16). The page's own full
 * mode — a CSS fill — is the base and belongs to the caller; this only asks the browser for element fullscreen and a
 * landscape lock where it has them, and gives both back. iPhone Safari has no element fullscreen: there it does nothing.
 *
 * The rules, each fixed by one of the phone half's 6C rounds and pinned in `tests/utils/fullscreenSession.test.ts`:
 *  - only a stay that ASKED has anything to undo (the CSS-only path never calls unlock or exit);
 *  - a grant that lands after the stay ended gives the fullscreen back and never locks;
 *  - `unlock()` follows only a lock that RESOLVED (unlock after a refused lock was measured only on desktop Chrome);
 *  - a refused request or lock leaves the CSS fill in place (measured in Chrome: `requestFullscreen` without a user
 *    gesture rejects, and `lock()` on a desktop rejects NotSupportedError — pad-fullscreen.browser.test.ts).
 */
export interface FullscreenApi {
  /** The page may ask for element fullscreen (false on iPhone Safari: the CSS fill alone). */
  enabled(): boolean;
  request(): Promise<unknown>;
  exit(): Promise<unknown>;
  /** An element is fullscreen now. */
  active(): boolean;
  lockLandscape(): Promise<unknown>;
  unlock(): void;
}

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

/** The browser's Fullscreen API on the whole page, and the screen orientation lock where the browser has one. */
export const browserFullscreen: FullscreenApi = {
  enabled: () => document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function',
  request: () => document.documentElement.requestFullscreen({ navigationUI: 'hide' }),
  exit: () => document.exitFullscreen(),
  // `fullscreenElement` does not exist where the API does not (iPhone Safari): undefined is not fullscreen either.
  active: () => Boolean(document.fullscreenElement),
  lockLandscape: () => (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape') ?? Promise.resolve(),
  unlock: () => (screen.orientation as LockableOrientation | undefined)?.unlock?.(),
};

export interface FullscreenSession {
  /** Call AFTER the page entered its full mode (`isFull()` true). */
  begin(): void;
  /** Call AFTER the page left its full mode (`isFull()` false). */
  end(): void;
}

/** `isFull` is the page's own full mode, read when a grant or a lock lands. */
export function createFullscreenSession(fs: FullscreenApi, isFull: () => boolean): FullscreenSession {
  // Whether THIS stay asked the browser for fullscreen: only then is there anything to undo on leaving.
  let requested = false;
  // Whether a landscape lock RESOLVED during this stay (or, in browserFullscreen, was absent — its unlock is then absent
  // too): unlock() follows only that, never a refused lock.
  let locked = false;
  return {
    begin() {
      if (!fs.enabled()) return; // iPhone Safari: the CSS fill alone
      requested = true;
      fs.request()
        .then(() => {
          // Read the state AT the grant: left meanwhile → give the fullscreen back; in full mode (still, or entered
          // again before this grant) → lock. Never lock under the normal page.
          if (!isFull()) return fs.exit();
          return fs.lockLandscape().then(() => {
            if (isFull()) locked = true;
            else fs.unlock(); // left while the lock was pending: release it now
          });
        })
        // Refused or unsupported (measured, see above): the CSS fill stays, which is the base.
        .catch(() => {});
    },
    end() {
      if (!requested) return;
      requested = false;
      if (locked) fs.unlock();
      locked = false;
      if (fs.active()) void fs.exit(); // the check and the call share one task: the browser cannot leave in between
    },
  };
}
