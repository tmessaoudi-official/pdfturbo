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
