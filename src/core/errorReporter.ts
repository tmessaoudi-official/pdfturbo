import type { IToastQueue } from '../ui/toastQueue';
import { t } from '../utils/i18n';

export interface IErrorReporter {
  /** Operation feedback — INFO level, toast only. */
  info(msgKey: string, params?: Record<string, string | number>): void;
  /** Expected limitation — WARN level, toast only. */
  warn(msgKey: string, params?: Record<string, string | number>): void;
  /** Unexpected failure — ERROR level, toast + console.error. */
  error(msgKey: string, err?: unknown, params?: Record<string, string | number>): void;
  /** Internal state failure — no toast, console.warn only. */
  silent(err?: unknown, context?: string): void;
}

export const DURATION: Record<'info' | 'warn' | 'error', number> = {
  info:  2500,
  warn:  4000,
  error: 6000,
};

export class ErrorReporter implements IErrorReporter {
  constructor(private readonly _queue: IToastQueue) {}

  info(msgKey: string, params?: Record<string, string | number>): void {
    this._queue.enqueue(t(msgKey, params), 'info', DURATION.info);
  }

  warn(msgKey: string, params?: Record<string, string | number>): void {
    this._queue.enqueue(t(msgKey, params), 'warn', DURATION.warn);
  }

  error(msgKey: string, err?: unknown, params?: Record<string, string | number>): void {
    console.error('[PDFturbo]', err ?? msgKey);
    this._queue.enqueue(t(msgKey, params), 'error', DURATION.error);
  }

  silent(err?: unknown, context?: string): void {
    console.warn('[PDFturbo:silent]', context ?? '', err);
  }
}
