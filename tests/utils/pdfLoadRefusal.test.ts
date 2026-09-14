/**
 * WS7 round 15 (completeness P3): a load-guard refusal reached the user only as each caller's generic
 * failure message, and OCR and signing told them to "try again" — a refusal is deterministic, so a retry
 * can never succeed. Every catch that can receive one now asks `isPdfLoadRefusal` first. These cases pin
 * what it recognises, and what it must NOT, because a false positive would relabel an ordinary failure.
 */
import { describe, it, expect } from 'vitest';
import { isPdfLoadRefusal, PdfObjectDroppedError, PdfXrefMismatchError } from '../../src/utils/pdfLoadGuard';

describe('isPdfLoadRefusal', () => {
  it('recognises both refusals', () => {
    expect(isPdfLoadRefusal(new PdfObjectDroppedError(['5 0 R']))).toBe(true);
    expect(isPdfLoadRefusal(new PdfXrefMismatchError(['5 0 R']))).toBe(true);
  });

  it('sees through a cause chain, which is how the signer reports a load failure', () => {
    const wrapped = new Error('Could not load the PDF for signing.', { cause: new PdfXrefMismatchError(['5 0 R']) });
    expect(isPdfLoadRefusal(wrapped)).toBe(true);
    expect(isPdfLoadRefusal(new Error('outer', { cause: wrapped }))).toBe(true);
  });

  it('does not claim any other error — the sanitizer refusal and a look-alike message included', () => {
    const sanitize = new Error('refused');
    sanitize.name = 'SanitizeRefusedError';
    expect(isPdfLoadRefusal(sanitize)).toBe(false);
    expect(isPdfLoadRefusal(new Error('PDF_XREF_MISMATCH: a message is not a refusal'))).toBe(false);
    expect(isPdfLoadRefusal(new TypeError('x is undefined'))).toBe(false);
    expect(isPdfLoadRefusal(new Error('outer', { cause: new Error('inner') }))).toBe(false);
  });

  it('rejects values that are not errors, even ones carrying the name', () => {
    for (const v of [null, undefined, 'PdfXrefMismatchError', { name: 'PdfXrefMismatchError' }]) {
      expect(isPdfLoadRefusal(v)).toBe(false);
    }
  });

  it('terminates on a cyclic cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(isPdfLoadRefusal(a)).toBe(false);
  });
});
