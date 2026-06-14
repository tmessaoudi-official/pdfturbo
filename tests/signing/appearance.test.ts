import { describe, expect, it } from 'vitest';
import {
  buildAppearanceLines,
  formatPdfDate,
  formatSignDate,
  rectToPdfArray,
  validatePageIndex,
  validateRect,
  validateSignOptionsShape,
} from '../../src/signing/appearance';
import { SignError, type SignOptions } from '../../src/signing/types';

const PAGE = { width: 612, height: 792 }; // US Letter pt

describe('validateRect', () => {
  it('accepts a rectangle fully inside the page', () => {
    expect(() => validateRect({ x: 72, y: 72, width: 220, height: 64 }, PAGE)).not.toThrow();
  });

  it('rejects zero/negative width or height', () => {
    expect(() => validateRect({ x: 0, y: 0, width: 0, height: 10 }, PAGE)).toThrowError(SignError);
    expect(() => validateRect({ x: 0, y: 0, width: 10, height: -1 }, PAGE)).toThrowError(SignError);
  });

  it('rejects a rectangle that overflows the page bounds', () => {
    let err: unknown;
    try {
      validateRect({ x: 500, y: 700, width: 200, height: 200 }, PAGE);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SignError);
    expect((err as SignError).code).toBe('INVALID_RECT');
  });

  it('rejects non-finite coordinates', () => {
    expect(() => validateRect({ x: NaN, y: 0, width: 10, height: 10 }, PAGE)).toThrowError(SignError);
    expect(() => validateRect({ x: 0, y: 0, width: Infinity, height: 10 }, PAGE)).toThrowError(SignError);
  });

  it('tolerates tiny float overshoot within epsilon', () => {
    expect(() => validateRect({ x: 0, y: 0, width: 612.005, height: 792.005 }, PAGE)).not.toThrow();
  });
});

describe('rectToPdfArray', () => {
  it('converts x/y/w/h to [llx, lly, urx, ury]', () => {
    expect(rectToPdfArray({ x: 10, y: 20, width: 100, height: 50 })).toEqual([10, 20, 110, 70]);
  });
});

describe('validatePageIndex', () => {
  it('accepts an in-range index', () => {
    expect(() => validatePageIndex(0, 3)).not.toThrow();
    expect(() => validatePageIndex(2, 3)).not.toThrow();
  });

  it('rejects out-of-range / non-integer indices', () => {
    expect(() => validatePageIndex(3, 3)).toThrowError(SignError);
    expect(() => validatePageIndex(-1, 3)).toThrowError(SignError);
    expect(() => validatePageIndex(1.5, 3)).toThrowError(SignError);
  });

  it('carries the INVALID_PAGE code', () => {
    try {
      validatePageIndex(99, 1);
    } catch (e) {
      expect((e as SignError).code).toBe('INVALID_PAGE');
    }
  });
});

describe('buildAppearanceLines', () => {
  const date = new Date('2026-06-15T10:20:30Z');

  it('always includes a signer line and a date line', () => {
    const lines = buildAppearanceLines({ name: 'Alice Example', date });
    expect(lines[0]).toBe('Signed by: Alice Example');
    expect(lines.some((l) => l.startsWith('Date:'))).toBe(true);
  });

  it('falls back to a generic signer line when no name', () => {
    const lines = buildAppearanceLines({ date });
    expect(lines[0]).toBe('Digitally signed');
  });

  it('drops empty reason/location but keeps populated ones', () => {
    const lines = buildAppearanceLines({ name: 'Bob', reason: '  ', location: 'Paris', date });
    expect(lines.some((l) => l.startsWith('Reason:'))).toBe(false);
    expect(lines).toContain('Location: Paris');
  });
});

describe('formatPdfDate', () => {
  it('emits a PDF date string with timezone offset', () => {
    const s = formatPdfDate(new Date('2026-06-15T08:09:05Z'));
    expect(s).toMatch(/^D:\d{14}[+-]\d{2}'\d{2}'$/);
  });
});

describe('formatSignDate', () => {
  it('renders an ISO-ish UTC string', () => {
    expect(formatSignDate(new Date('2026-06-15T10:20:30Z'))).toBe('2026-06-15 10:20:30 UTC');
  });
});

describe('validateSignOptionsShape', () => {
  const base: SignOptions = {
    p12: new Uint8Array([1, 2, 3]),
    passphrase: 'pw',
    page: 0,
    rect: { x: 0, y: 0, width: 10, height: 10 },
  };

  it('accepts a well-formed options object', () => {
    expect(() => validateSignOptionsShape(base)).not.toThrow();
  });

  it('rejects an empty p12', () => {
    expect(() => validateSignOptionsShape({ ...base, p12: new Uint8Array(0) })).toThrowError(SignError);
  });

  it('rejects a negative page index', () => {
    expect(() => validateSignOptionsShape({ ...base, page: -1 })).toThrowError(SignError);
  });

  it('rejects a non-string passphrase', () => {
    expect(() =>
      validateSignOptionsShape({ ...base, passphrase: 123 as unknown as string }),
    ).toThrowError(SignError);
  });
});
