/**
 * OCR core unit tests — Agent O.
 *
 * Tesseract.js cannot fully run in jsdom (it needs WebAssembly + Web Workers +
 * network to fetch the WASM core and traineddata). So these tests cover the
 * PURE, browser-independent surface:
 *   - language-code validation / normalization (`languages.ts`)
 *   - tesseract→OcrResult mapping + bbox/confidence normalization (`tesseractMapper.ts`)
 *   - the dynamic-import WIRING of the engine, using an INJECTED mock tesseract
 *     loader (`setTesseractLoader`) so no WASM is loaded.
 *
 * What still needs a REAL-BROWSER test (see the agent report, section e):
 *   - actual recognition of a rasterized scanned page (WASM + worker path),
 *   - real progress events firing,
 *   - the default CDN traineddata fetch.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  isSupportedLanguage,
  isValidLanguage,
  normalizeLanguageCode,
  resolveLanguage,
  DEFAULT_OCR_LANGUAGE,
  OCR_LANGUAGES,
} from '../../src/ocr/languages';
import {
  normalizeBBox,
  clampConfidence,
  mapWord,
  mapTesseractResult,
  type RawTesseractPage,
} from '../../src/ocr/tesseractMapper';
import {
  recognizePage,
  setTesseractLoader,
  type TesseractLike,
} from '../../src/ocr/ocrEngine';

describe('languages — validation & normalization', () => {
  it('accepts each curated language as supported', () => {
    for (const l of OCR_LANGUAGES) {
      expect(isSupportedLanguage(l.code)).toBe(true);
    }
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(isSupportedLanguage('  ENG ')).toBe(true);
    expect(isSupportedLanguage('Fra')).toBe(true);
  });

  it('rejects unknown codes', () => {
    expect(isSupportedLanguage('xyz')).toBe(false);
    expect(isSupportedLanguage('en')).toBe(false); // 2-letter, not tesseract form
  });

  it('isSupportedLanguage does NOT accept "+"-joined lists', () => {
    expect(isSupportedLanguage('eng+fra')).toBe(false);
  });

  it('normalizes lists: lowercases, trims parts, drops empties & dupes', () => {
    expect(normalizeLanguageCode(' ENG + Fra ')).toBe('eng+fra');
    expect(normalizeLanguageCode('eng++fra')).toBe('eng+fra');
    expect(normalizeLanguageCode('eng+eng+fra')).toBe('eng+fra');
    expect(normalizeLanguageCode('+ + ')).toBe('');
  });

  it('isValidLanguage requires every part well-formed AND supported', () => {
    expect(isValidLanguage('eng')).toBe(true);
    expect(isValidLanguage('eng+fra')).toBe(true);
    expect(isValidLanguage('eng+xyz')).toBe(false);
    expect(isValidLanguage('en')).toBe(false);
    expect(isValidLanguage('')).toBe(false);
    expect(isValidLanguage('   ')).toBe(false);
  });

  it('resolveLanguage falls back to default for bad / missing input', () => {
    expect(resolveLanguage('fra')).toBe('fra');
    expect(resolveLanguage('eng+fra')).toBe('eng+fra');
    expect(resolveLanguage('nope')).toBe(DEFAULT_OCR_LANGUAGE);
    expect(resolveLanguage('')).toBe(DEFAULT_OCR_LANGUAGE);
    expect(resolveLanguage(undefined)).toBe(DEFAULT_OCR_LANGUAGE);
    expect(resolveLanguage(null)).toBe(DEFAULT_OCR_LANGUAGE);
  });
});

describe('tesseractMapper — bbox & confidence normalization', () => {
  it('normalizes a well-formed bbox unchanged', () => {
    expect(normalizeBBox({ x0: 1, y0: 2, x1: 3, y1: 4 })).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
  });

  it('swaps inverted corners so x0<=x1 and y0<=y1', () => {
    expect(normalizeBBox({ x0: 10, y0: 20, x1: 1, y1: 2 })).toEqual({ x0: 1, y0: 2, x1: 10, y1: 20 });
  });

  it('defaults missing / non-finite coords to 0', () => {
    expect(normalizeBBox(undefined)).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
    expect(normalizeBBox({ x0: NaN, y1: Infinity })).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });

  it('clamps confidence into 0–100', () => {
    expect(clampConfidence(50)).toBe(50);
    expect(clampConfidence(-5)).toBe(0);
    expect(clampConfidence(150)).toBe(100);
    expect(clampConfidence('bad')).toBe(0);
    expect(clampConfidence(undefined)).toBe(0);
  });
});

describe('tesseractMapper — word & page mapping', () => {
  it('maps a word, trimming text', () => {
    expect(mapWord({ text: '  Hello ', bbox: { x0: 0, y0: 0, x1: 5, y1: 5 }, confidence: 90 })).toEqual({
      text: 'Hello',
      bbox: { x0: 0, y0: 0, x1: 5, y1: 5 },
      confidence: 90,
    });
  });

  it('drops empty / whitespace-only words (returns null)', () => {
    expect(mapWord({ text: '   ' })).toBeNull();
    expect(mapWord({ text: '' })).toBeNull();
    expect(mapWord(undefined)).toBeNull();
  });

  it('maps a full page, filtering empty words and normalizing text', () => {
    const page: RawTesseractPage = {
      text: 'Hello world\r\nfoo\n',
      confidence: 87.5,
      words: [
        { text: 'Hello', bbox: { x0: 0, y0: 0, x1: 10, y1: 8 }, confidence: 95 },
        { text: '   ', bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, confidence: 0 },
        { text: 'world', bbox: { x0: 12, y0: 0, x1: 22, y1: 8 }, confidence: 88 },
      ],
    };
    const result = mapTesseractResult(page, 'eng');
    expect(result.language).toBe('eng');
    expect(result.confidence).toBe(87.5);
    expect(result.text).toBe('Hello world\nfoo'); // CRLF→LF, trailing trimmed
    expect(result.words.map((w) => w.text)).toEqual(['Hello', 'world']);
  });

  it('handles a page with no words / no confidence', () => {
    const result = mapTesseractResult({ text: '' }, 'fra');
    expect(result.words).toEqual([]);
    expect(result.confidence).toBeNull();
    expect(result.text).toBe('');
    expect(result.language).toBe('fra');
  });

  it('handles a fully undefined page defensively', () => {
    const result = mapTesseractResult(undefined, 'eng');
    expect(result.words).toEqual([]);
    expect(result.confidence).toBeNull();
    expect(result.text).toBe('');
  });
});

describe('ocrEngine — dynamic-import wiring (mocked tesseract)', () => {
  it('recognizePage loads tesseract via the loader, resolves the language, and maps the result', async () => {
    const recognize = vi.fn((_img: unknown, _lang: string) =>
      Promise.resolve({
        data: {
          text: 'Scanned text',
          confidence: 92,
          words: [{ text: 'Scanned', bbox: { x0: 1, y0: 2, x1: 3, y1: 4 }, confidence: 92 }],
        },
      }),
    );
    const loader = vi.fn((): Promise<TesseractLike> =>
      Promise.resolve({ recognize } as unknown as TesseractLike),
    );
    const prev = setTesseractLoader(loader);
    try {
      const result = await recognizePage('data:image/png;base64,AAAA', { language: 'eng' });
      expect(loader).toHaveBeenCalledTimes(1);
      expect(recognize).toHaveBeenCalledTimes(1);
      expect(recognize.mock.calls[0][1]).toBe('eng'); // language passed through
      expect(result.text).toBe('Scanned text');
      expect(result.words).toHaveLength(1);
      expect(result.words[0].text).toBe('Scanned');
      expect(result.language).toBe('eng');
    } finally {
      setTesseractLoader(prev);
    }
  });

  it('coerces an invalid language to the default before recognition', async () => {
    const recognize = vi.fn((_img: unknown, _lang: string) =>
      Promise.resolve({ data: { text: '', confidence: 0, words: [] } }),
    );
    const loader = (): Promise<TesseractLike> =>
      Promise.resolve({ recognize } as unknown as TesseractLike);
    const prev = setTesseractLoader(loader);
    try {
      await recognizePage('img', { language: 'nope' });
      expect(recognize.mock.calls[0][1]).toBe(DEFAULT_OCR_LANGUAGE);
    } finally {
      setTesseractLoader(prev);
    }
  });

  it('forwards progress events to onProgress via tesseract logger', async () => {
    const recognize = vi.fn(
      (
        _img: unknown,
        _lang: string,
        opts?: { logger?: (m: { status?: string; progress?: number }) => void },
      ) => {
        opts?.logger?.({ status: 'recognizing text', progress: 0.5 });
        opts?.logger?.({ status: 'done' }); // missing progress → defaults to 0
        return Promise.resolve({ data: { text: 'x', confidence: 10, words: [] } });
      },
    );
    const loader = (): Promise<TesseractLike> =>
      Promise.resolve({ recognize } as unknown as TesseractLike);
    const prev = setTesseractLoader(loader);
    const events: Array<{ status: string; progress: number }> = [];
    try {
      await recognizePage('img', { language: 'eng', onProgress: (p) => events.push(p) });
      expect(events).toEqual([
        { status: 'recognizing text', progress: 0.5 },
        { status: 'done', progress: 0 },
      ]);
    } finally {
      setTesseractLoader(prev);
    }
  });

  it('forwards langPath when provided (offline override)', async () => {
    const recognize = vi.fn(
      (_img: unknown, _lang: string, _opts?: { langPath?: string }) =>
        Promise.resolve({ data: { text: '', confidence: 0, words: [] } }),
    );
    const loader = (): Promise<TesseractLike> =>
      Promise.resolve({ recognize } as unknown as TesseractLike);
    const prev = setTesseractLoader(loader);
    try {
      await recognizePage('img', { language: 'eng', langPath: '/pdfturbo/ocr-lang' });
      expect(recognize.mock.calls[0][2]).toMatchObject({ langPath: '/pdfturbo/ocr-lang' });
    } finally {
      setTesseractLoader(prev);
    }
  });

  it('wraps recognition failures in an "ocr:"-prefixed error', async () => {
    const recognize = vi.fn(() => Promise.reject(new Error('worker exploded')));
    const loader = (): Promise<TesseractLike> =>
      Promise.resolve({ recognize } as unknown as TesseractLike);
    const prev = setTesseractLoader(loader);
    try {
      await expect(recognizePage('img', { language: 'eng' })).rejects.toThrow(
        /^ocr: recognition failed for language "eng": worker exploded$/,
      );
    } finally {
      setTesseractLoader(prev);
    }
  });
});
