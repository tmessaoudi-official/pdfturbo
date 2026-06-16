// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installGlobalErrorBoundary } from '../../src/core/globalErrorBoundary';
import { LogBuffer } from '../../src/core/logBuffer';
import type { IErrorReporter } from '../../src/contracts/errorReporter';

function makeReporter() {
  const calls: Array<{ method: string; key: string; err?: unknown }> = [];
  const reporter: IErrorReporter = {
    info(key) { calls.push({ method: 'info', key }); },
    warn(key) { calls.push({ method: 'warn', key }); },
    error(key, err) { calls.push({ method: 'error', key, err }); },
    silent(err, ctx) { calls.push({ method: 'silent', key: String(ctx), err }); },
  };
  return { reporter, calls };
}

describe('installGlobalErrorBoundary', () => {
  let log: LogBuffer;
  // Cancel jsdom's default "report uncaught exception" action so dispatched
  // ErrorEvents don't surface as vitest unhandled errors. preventDefault cancels
  // only the default action — propagation to the boundary listener still happens.
  const suppress = (e: Event): void => { e.preventDefault(); };

  beforeEach(() => {
    log = new LogBuffer(50);
    document.body.innerHTML = '<div id="toast"></div>';
    window.addEventListener('error', suppress);
    window.addEventListener('unhandledrejection', suppress);
  });

  afterEach(() => {
    window.removeEventListener('error', suppress);
    window.removeEventListener('unhandledrejection', suppress);
  });

  it('reports an uncaught error via the reporter AND records it to the log buffer', () => {
    const { reporter, calls } = makeReporter();
    const uninstall = installGlobalErrorBoundary({ getReporter: () => reporter, log });

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('kaboom'), message: 'kaboom' }));

    expect(calls.some(c => c.method === 'error')).toBe(true);
    expect(log.entries().some(e => e.level === 'error')).toBe(true);
    uninstall();
  });

  it('reports an unhandled promise rejection', () => {
    const { reporter, calls } = makeReporter();
    const uninstall = installGlobalErrorBoundary({ getReporter: () => reporter, log });

    const ev = new Event('unhandledrejection') as Event & { reason?: unknown };
    ev.reason = new Error('rejected');
    window.dispatchEvent(ev);

    expect(calls.some(c => c.method === 'error')).toBe(true);
    expect(log.entries().length).toBeGreaterThan(0);
    uninstall();
  });

  it('falls back to a direct DOM toast when no reporter is available yet', () => {
    const uninstall = installGlobalErrorBoundary({ getReporter: () => undefined, log });

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('early'), message: 'early' }));

    const toast = document.getElementById('toast');
    expect(toast?.textContent?.length).toBeGreaterThan(0);
    expect(toast?.className).toContain('show');
    // Still recorded to the buffer even without a reporter.
    expect(log.entries().length).toBeGreaterThan(0);
    uninstall();
  });

  it('does not loop infinitely if the reporter itself throws', () => {
    const throwing: IErrorReporter = {
      info() {}, warn() {}, silent() {},
      error() { throw new Error('reporter exploded'); },
    };
    const uninstall = installGlobalErrorBoundary({ getReporter: () => throwing, log });

    expect(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: new Error('x'), message: 'x' }));
    }).not.toThrow();
    // The original event is still recorded.
    expect(log.entries().length).toBeGreaterThan(0);
    uninstall();
  });

  it('uninstall() removes the listeners', () => {
    const { reporter, calls } = makeReporter();
    const uninstall = installGlobalErrorBoundary({ getReporter: () => reporter, log });
    uninstall();

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('after'), message: 'after' }));
    expect(calls).toHaveLength(0);
  });
});
