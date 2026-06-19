// oxlint-disable eslint/no-console -- spies on console.error to keep the suite quiet
/**
 * QA sweep 2026-06-19 (P2) — `errorReporter.error(msgKey, err, params)` interpolates with the
 * 3rd arg (`params`), but several call sites pass `err` as the 2nd arg and no params. Keys that
 * embed `{{error}}` (toast.pdfLoadFailed, toast.imageConversionFailed) therefore rendered the
 * LITERAL `{{error}}` to the user — observed in real Chrome when opening a corrupt PDF.
 *
 * Fix: `error()` injects the err's message as the `error` interpolation var (explicit params win).
 * t() is mocked to echo (key + params) so we assert the `error` var now reaches translation —
 * the en.json template literally contains `{{error}}` (verified separately), so once the var is
 * supplied i18next fills it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    `${key}::${params ? JSON.stringify(params) : 'NOPARAMS'}`,
}));

import { ErrorReporter } from '../../src/core/errorReporter';
import type { IToastQueue } from '../../src/ui/toastQueue';

function makeQueue(): IToastQueue & { calls: Array<{ msg: string; severity: string; duration: number }> } {
  const calls: Array<{ msg: string; severity: string; duration: number }> = [];
  return { calls, enqueue(msg, severity, duration) { calls.push({ msg, severity, duration }); }, clear() { calls.length = 0; } };
}

describe('ErrorReporter — {{error}} interpolation (P2 fix)', () => {
  let queue: ReturnType<typeof makeQueue>;
  let reporter: ErrorReporter;
  beforeEach(() => {
    queue = makeQueue();
    reporter = new ErrorReporter(queue);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('passes the Error message as the `error` interpolation var (pdfLoadFailed)', () => {
    reporter.error('toast.pdfLoadFailed', new Error('Invalid PDF structure'));
    expect(queue.calls[0]?.msg).toContain('"error":"Invalid PDF structure"');
  });

  it('passes the `error` var for imageConversionFailed too', () => {
    reporter.error('toast.imageConversionFailed', new Error('decode boom'));
    expect(queue.calls[0]?.msg).toContain('"error":"decode boom"');
  });

  it('accepts a string err and still supplies the `error` var', () => {
    reporter.error('toast.pdfLoadFailed', 'plain string failure');
    expect(queue.calls[0]?.msg).toContain('"error":"plain string failure"');
  });

  it('explicit params override the auto-injected error var', () => {
    reporter.error('toast.pdfLoadFailed', new Error('ignored'), { error: 'explicit' });
    expect(queue.calls[0]?.msg).toContain('"error":"explicit"');
    expect(queue.calls[0]?.msg).not.toContain('ignored');
  });

  it('error() with no err and no params still translates the key (no crash)', () => {
    reporter.error('toast.ocrFailed');
    expect(queue.calls[0]?.msg).toContain('toast.ocrFailed');
  });
});
