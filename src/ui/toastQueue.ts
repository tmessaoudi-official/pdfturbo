export type ToastSeverity = 'info' | 'warn' | 'error';

interface ToastEntry {
  msg: string;
  severity: ToastSeverity;
  duration: number;
}

export interface IToastQueue {
  enqueue(msg: string, severity: ToastSeverity, duration: number): void;
  clear(): void;
}

export class ToastQueue implements IToastQueue {
  private _el: HTMLElement;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _queue: ToastEntry[] = [];

  constructor(el: HTMLElement) {
    this._el = el;
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this._reposition());
      window.visualViewport.addEventListener('scroll', () => this._reposition());
    }
  }

  enqueue(msg: string, severity: ToastSeverity, duration: number): void {
    const entry: ToastEntry = { msg, severity, duration };
    if (this._timer !== null && severity !== 'error') {
      // INFO/WARN replace the current toast immediately
      this._showEntry(entry);
    } else {
      // ERROR always queued; also used for first entry
      this._queue.push(entry);
      if (this._timer === null) this._dequeue();
    }
  }

  clear(): void {
    clearTimeout(this._timer ?? undefined);
    this._timer = null;
    this._queue = [];
    this._el.classList.remove('show', 'toast--info', 'toast--warn', 'toast--error');
    this._el.textContent = '';
  }

  private _showEntry(entry: ToastEntry): void {
    clearTimeout(this._timer ?? undefined);
    this._el.classList.remove('toast--info', 'toast--warn', 'toast--error');
    this._el.classList.add(`toast--${entry.severity}`, 'show');
    this._el.textContent = entry.msg;
    this._reposition();
    this._timer = setTimeout(() => {
      this._el.classList.remove('show');
      this._el.textContent = '';
      this._timer = null;
      // Show next queued error if any
      if (this._queue.length) this._dequeue();
    }, entry.duration);
  }

  private _dequeue(): void {
    const next = this._queue.shift();
    if (next) this._showEntry(next);
  }

  private _reposition(): void {
    const vv = window.visualViewport;
    if (!vv || window.innerWidth >= 768) return;
    // On mobile with keyboard raised, keep toast visible in the visual viewport
    const offsetTop = window.innerHeight - vv.height - vv.offsetTop;
    if (offsetTop > 8) {
      this._el.style.top = `${vv.offsetTop + 16}px`;
    } else {
      this._el.style.top = '';
    }
  }
}
