import type { IToastQueue } from '../ui/toastQueue';
import { t } from '../utils/i18n';
import type { IErrorReporter } from '../contracts/errorReporter';
import type { ILogBuffer } from './logBuffer';

export type { IErrorReporter } from '../contracts/errorReporter';

export const DURATION: Record<'info' | 'warn' | 'error', number> = {
  info:  2500,
  warn:  4000,
  error: 6000,
};

export class ErrorReporter implements IErrorReporter {
  constructor(
    private readonly _queue: IToastQueue,
    private readonly _log?: ILogBuffer,
  ) {}

  info(msgKey: string, params?: Record<string, string | number>): void {
    this._log?.record('info', msgKey);
    this._queue.enqueue(t(msgKey, params), 'info', DURATION.info);
  }

  warn(msgKey: string, params?: Record<string, string | number>): void {
    this._log?.record('warn', msgKey);
    this._queue.enqueue(t(msgKey, params), 'warn', DURATION.warn);
  }

  error(msgKey: string, err?: unknown, params?: Record<string, string | number>): void {
    this._log?.record('error', msgKey, err);
    // oxlint-disable-next-line eslint/no-console -- deliberate diagnostic sink: this is the app-wide error reporter
    console.error('[PDFturbo]', err ?? msgKey);
    // Inject the error text as the `error` interpolation var so keys carrying `{{error}}`
    // (toast.pdfLoadFailed, toast.imageConversionFailed) are filled instead of rendering the
    // literal placeholder to the user. Explicit `params` win over the auto-injected value.
    let errText: string | undefined;
    if (err instanceof Error) errText = err.message;
    else if (typeof err === 'string') errText = err;
    const interp = errText !== undefined ? { error: errText, ...params } : params;
    this._queue.enqueue(t(msgKey, interp), 'error', DURATION.error);
  }

  silent(err?: unknown, context?: string): void {
    this._log?.record('silent', context ?? '', err);
    // oxlint-disable-next-line eslint/no-console -- deliberate diagnostic sink: silent() logs without a user toast by design
    console.warn('[PDFturbo:silent]', context ?? '', err);
  }
}
