// Global error boundary (master plan M0 #1 / inspect D-P1 / forge [G] / VC-1, VJ-7).
//
// Catches the two classes of failure that otherwise vanish silently in a no-backend
// SPA: synchronous uncaught exceptions (`window.onerror`) and unhandled promise
// rejections (`unhandledrejection`) — the latter being exactly what the floating
// promises across the render/zoom/nav paths (M0 #9) produce today. Every such event
// is (a) appended to the privacy-safe ring buffer for diagnosis, and (b) surfaced to
// the user as a toast so a failure is never invisible.
//
// It deliberately does NOT swallow the error (no preventDefault): autosave already
// protects the user's data, the dev console must still see the original event, and
// suppressing it could hide a recoverable state. The boundary only *observes*.

import { t } from '../utils/i18n';
import type { IErrorReporter } from '../contracts/errorReporter';
import type { ILogBuffer } from './logBuffer';

/** Translation key for the user-facing "something went wrong" toast. */
const TOAST_KEY = 'toast.unexpectedError';

export interface GlobalErrorBoundaryDeps {
  /** Resolves the app-wide reporter lazily (the app may not exist yet at install time). */
  getReporter: () => IErrorReporter | undefined;
  /** Ring buffer that records the failure regardless of reporter availability. */
  log: ILogBuffer;
}

function extractError(e: Event): unknown {
  if (e instanceof ErrorEvent) return e.error ?? e.message;
  // PromiseRejectionEvent (or a generic Event carrying `reason` in jsdom).
  const reason = (e as Event & { reason?: unknown }).reason;
  return reason ?? e;
}

function domFallbackToast(): void {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = t(TOAST_KEY);
    toast.className = 'show';
  }
}

/**
 * Installs window-level error + unhandledrejection listeners.
 * Returns an uninstall function (used by tests; production keeps it for the page lifetime).
 */
export function installGlobalErrorBoundary(deps: GlobalErrorBoundaryDeps): () => void {
  const { getReporter, log } = deps;
  // Re-entrancy guard: if reporting itself triggers another error event, we must not
  // recurse into a toast storm. Inner events are still recorded, just not re-toasted.
  let handling = false;

  const handle = (e: Event): void => {
    const err = extractError(e);
    log.record('error', 'boundary.uncaught', err);
    if (handling) return;
    handling = true;
    try {
      const reporter = getReporter();
      if (reporter) {
        reporter.error(TOAST_KEY, err);
      } else {
        domFallbackToast();
      }
    } catch {
      // A throwing reporter must never escape the boundary (it would re-enter via the
      // window 'error' event). Swallow here only — the original failure is already logged.
    } finally {
      handling = false;
    }
  };

  window.addEventListener('error', handle);
  window.addEventListener('unhandledrejection', handle);

  return () => {
    window.removeEventListener('error', handle);
    window.removeEventListener('unhandledrejection', handle);
  };
}
