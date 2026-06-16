// Structured, bounded, in-memory ring-buffer logger (master plan M0 #41 / VC-6).
//
// Privacy-safe by construction: it stores translation *keys* and context labels
// (e.g. 'toast.exportFailed', 'session-restore') plus a truncated error string —
// never interpolated user text and never the PDF content. It performs NO network
// I/O. Its purpose is to give the global error boundary (#1) and field diagnostics
// a short rolling history of what the app did just before a failure, readable from
// `window.app` in dev or attachable to a future "copy diagnostics" affordance.

export type LogLevel = 'info' | 'warn' | 'error' | 'silent';

export interface LogEntry {
  /** Epoch milliseconds when the entry was recorded. */
  readonly ts: number;
  readonly level: LogLevel;
  /** Translation key or short context label — NOT interpolated user data. */
  readonly message: string;
  /** Optional truncated detail derived from an error/context value. */
  readonly detail?: string;
}

export interface ILogBuffer {
  record(level: LogLevel, message: string, detail?: unknown): void;
  /** Oldest-first defensive copy of the current entries. */
  entries(): readonly LogEntry[];
  clear(): void;
}

const DEFAULT_CAPACITY = 200;
const MAX_DETAIL_LEN = 600;

function toDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  let s: string;
  if (detail instanceof Error) {
    s = `${detail.name}: ${detail.message}`;
  } else if (typeof detail === 'string') {
    s = detail;
  } else {
    try {
      s = String(detail);
    } catch {
      s = '[unstringifiable]';
    }
  }
  return s.length > MAX_DETAIL_LEN ? s.slice(0, MAX_DETAIL_LEN) : s;
}

export class LogBuffer implements ILogBuffer {
  private readonly _capacity: number;
  private readonly _buf: LogEntry[] = [];

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this._capacity = Math.max(1, Math.floor(capacity));
  }

  record(level: LogLevel, message: string, detail?: unknown): void {
    const entry: LogEntry = { ts: Date.now(), level, message, detail: toDetail(detail) };
    this._buf.push(entry);
    if (this._buf.length > this._capacity) {
      this._buf.splice(0, this._buf.length - this._capacity);
    }
  }

  entries(): readonly LogEntry[] {
    return [...this._buf];
  }

  clear(): void {
    this._buf.length = 0;
  }
}
