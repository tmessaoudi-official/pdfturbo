// oxlint-disable eslint/no-console -- this suite spies on and asserts against console.error/warn to verify ErrorReporter's logging contract
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorReporter, DURATION } from '../../src/core/errorReporter';
import type { IToastQueue } from '../../src/ui/toastQueue';

function makeQueue(): IToastQueue & { calls: Array<{ msg: string; severity: string; duration: number }> } {
  const calls: Array<{ msg: string; severity: string; duration: number }> = [];
  return {
    calls,
    enqueue(msg, severity, duration) { calls.push({ msg, severity, duration }); },
    clear() { calls.length = 0; },
  };
}

describe('ErrorReporter', () => {
  let queue: ReturnType<typeof makeQueue>;
  let reporter: ErrorReporter;

  beforeEach(() => {
    queue = makeQueue();
    reporter = new ErrorReporter(queue);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('info() enqueues with INFO severity and correct duration', () => {
    reporter.info('toast.copied');
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0]?.severity).toBe('info');
    expect(queue.calls[0]?.duration).toBe(DURATION.info);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('warn() enqueues with WARN severity and correct duration', () => {
    reporter.warn('toast.passwordRequired');
    expect(queue.calls[0]?.severity).toBe('warn');
    expect(queue.calls[0]?.duration).toBe(DURATION.warn);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('error() enqueues toast AND calls console.error', () => {
    const err = new Error('test error');
    reporter.error('toast.exportFailed', err);
    expect(queue.calls[0]?.severity).toBe('error');
    expect(queue.calls[0]?.duration).toBe(DURATION.error);
    expect(console.error).toHaveBeenCalledWith('[PDFturbo]', err);
  });

  it('error() with no err argument logs the key', () => {
    reporter.error('toast.exportFailed');
    expect(console.error).toHaveBeenCalledWith('[PDFturbo]', 'toast.exportFailed');
  });

  it('silent() calls console.warn only — no toast enqueue', () => {
    reporter.silent(new Error('internal'), 'session-restore');
    expect(queue.calls).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });

  it('silent() without args still calls console.warn', () => {
    reporter.silent();
    expect(queue.calls).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });

  it('error() with params passes them to translation', () => {
    reporter.error('toast.fileLoadFailed', undefined, { name: 'test.pdf' });
    // Translation receives params — just verify enqueue was called with a string
    expect(typeof queue.calls[0]?.msg).toBe('string');
  });
});

describe('ErrorReporter — LogBuffer sink (#41)', () => {
  it('records every level into the supplied log buffer (key + level, not interpolated text)', async () => {
    const { LogBuffer } = await import('../../src/core/logBuffer');
    const log = new LogBuffer(50);
    const queue = makeQueue();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reporter = new ErrorReporter(queue, log);

    reporter.info('toast.copied');
    reporter.warn('toast.ocrNoText');
    reporter.error('toast.exportFailed', new Error('boom'));
    reporter.silent(new Error('internal'), 'session-restore');

    const e = log.entries();
    expect(e.map(x => x.level)).toEqual(['info', 'warn', 'error', 'silent']);
    expect(e[0]?.message).toBe('toast.copied');
    expect(e[2]?.detail).toBe('Error: boom');
    expect(e[3]?.message).toBe('session-restore');
  });

  it('works without a log buffer (back-compat — single-arg constructor)', () => {
    const queue = makeQueue();
    const reporter = new ErrorReporter(queue);
    expect(() => reporter.info('toast.copied')).not.toThrow();
    expect(queue.calls).toHaveLength(1);
  });
});
