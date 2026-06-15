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
  flattenBlockWords,
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

/**
 * Build a mock tesseract loader around the `createWorker` API the engine now
 * uses (NOT the old `recognize` convenience — that hardcodes `{ text: true }`
 * and so never returns word geometry). `createWorkerImpl` lets a test observe
 * the worker options (where logger/asset-paths live) and fire the logger.
 */
function makeWorkerLoader(opts?: {
  data?: RawTesseractPage;
  recognizeReject?: Error;
  createWorkerReject?: Error;
  fireLogger?: Array<{ status?: string; progress?: number }>;
}) {
  const data = opts?.data ?? { text: '', confidence: 0, blocks: [] };
  const recognize = vi.fn((_img: unknown, _o?: unknown, _out?: unknown) =>
    opts?.recognizeReject ? Promise.reject(opts.recognizeReject) : Promise.resolve({ data }),
  );
  const terminate = vi.fn(() => Promise.resolve(undefined));
  const createWorker = vi.fn(
    (
      _langs: string,
      _oem?: number,
      workerOptions?: { logger?: (m: { status?: string; progress?: number }) => void },
    ) => {
      if (opts?.createWorkerReject) return Promise.reject(opts.createWorkerReject);
      for (const m of opts?.fireLogger ?? []) workerOptions?.logger?.(m);
      return Promise.resolve({ recognize, terminate });
    },
  );
  const loader = vi.fn((): Promise<TesseractLike> =>
    Promise.resolve({ createWorker } as unknown as TesseractLike),
  );
  return { loader, createWorker, recognize, terminate };
}

describe('ocrEngine — createWorker wiring (mocked tesseract)', () => {
  it('loads the engine, resolves the language, requests block output, maps + terminates', async () => {
    const { loader, createWorker, recognize, terminate } = makeWorkerLoader({
      data: {
        text: 'Scanned text',
        confidence: 92,
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    words: [
                      { text: 'Scanned', bbox: { x0: 1, y0: 2, x1: 3, y1: 4 }, confidence: 92 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const prev = setTesseractLoader(loader);
    try {
      const result = await recognizePage('data:image/png;base64,AAAA', { language: 'eng' });
      expect(loader).toHaveBeenCalledTimes(1);
      expect(createWorker).toHaveBeenCalledTimes(1);
      expect(createWorker.mock.calls[0][0]).toBe('eng'); // language → createWorker
      expect(createWorker.mock.calls[0][1]).toBe(1); // oem 1 = LSTM
      // block output MUST be requested (else no per-word geometry).
      expect(recognize.mock.calls[0][2]).toMatchObject({ blocks: true });
      expect(result.text).toBe('Scanned text');
      expect(result.words).toHaveLength(1);
      expect(result.words[0].text).toBe('Scanned');
      expect(result.language).toBe('eng');
      expect(terminate).toHaveBeenCalledTimes(1); // worker freed
    } finally {
      setTesseractLoader(prev);
    }
  });

  it('coerces an invalid language to the default before recognition', async () => {
    const { loader, createWorker } = makeWorkerLoader();
    const prev = setTesseractLoader(loader);
    try {
      await recognizePage('img', { language: 'nope' });
      expect(createWorker.mock.calls[0][0]).toBe(DEFAULT_OCR_LANGUAGE);
    } finally {
      setTesseractLoader(prev);
    }
  });

  it('forwards progress events to onProgress via the worker logger', async () => {
    const { loader } = makeWorkerLoader({
      fireLogger: [{ status: 'recognizing text', progress: 0.5 }, { status: 'done' }],
    });
    const prev = setTesseractLoader(loader);
    const events: Array<{ status: string; progress: number }> = [];
    try {
      await recognizePage('img', { language: 'eng', onProgress: (p) => events.push(p) });
      expect(events).toEqual([
        { status: 'recognizing text', progress: 0.5 },
        { status: 'done', progress: 0 }, // missing progress → 0
      ]);
    } finally {
      setTesseractLoader(prev);
    }
  });

  it('forwards corePath/workerPath/langPath to createWorker (CSP-safe assets)', async () => {
    const { loader, createWorker } = makeWorkerLoader();
    const prev = setTesseractLoader(loader);
    try {
      await recognizePage('img', {
        language: 'eng',
        corePath: '/pdfturbo/tesseract/core',
        workerPath: '/pdfturbo/tesseract/worker.min.js',
        langPath: '/pdfturbo/tesseract/lang',
      });
      const opts = createWorker.mock.calls[0][2];
      expect(opts).toMatchObject({
        corePath: '/pdfturbo/tesseract/core',
        workerPath: '/pdfturbo/tesseract/worker.min.js',
        langPath: '/pdfturbo/tesseract/lang',
      });
      // No remote/CDN value leaked into the worker options.
      expect(JSON.stringify(opts)).not.toMatch(/https?:|cdn|jsdelivr|unpkg|tessdata\.projectnaptha/i);
    } finally {
      setTesseractLoader(prev);
    }
  });

  it('omits asset-path keys entirely when not provided', async () => {
    const { loader, createWorker } = makeWorkerLoader();
    const prev = setTesseractLoader(loader);
    try {
      await recognizePage('img', { language: 'eng' });
      const opts = (createWorker.mock.calls[0][2] ?? {}) as Record<string, unknown>;
      expect('corePath' in opts).toBe(false);
      expect('workerPath' in opts).toBe(false);
      expect('langPath' in opts).toBe(false);
    } finally {
      setTesseractLoader(prev);
    }
  });

  it('wraps recognition failures in an "ocr:"-prefixed error and still terminates', async () => {
    const { loader, terminate } = makeWorkerLoader({ recognizeReject: new Error('worker exploded') });
    const prev = setTesseractLoader(loader);
    try {
      await expect(recognizePage('img', { language: 'eng' })).rejects.toThrow(
        /^ocr: recognition failed for language "eng": worker exploded$/,
      );
      expect(terminate).toHaveBeenCalledTimes(1);
    } finally {
      setTesseractLoader(prev);
    }
  });

  it('wraps engine-load failures distinctly from recognition failures', async () => {
    const { loader } = makeWorkerLoader({ createWorkerReject: new Error('core 404') });
    const prev = setTesseractLoader(loader);
    try {
      await expect(recognizePage('img', { language: 'eng' })).rejects.toThrow(
        /^ocr: failed to load engine for language "eng": core 404$/,
      );
    } finally {
      setTesseractLoader(prev);
    }
  });
});

describe('tesseractMapper — block flattening (v6+ geometry)', () => {
  it('flattenBlockWords flattens blocks→paragraphs→lines→words', () => {
    const words = flattenBlockWords([
      {
        paragraphs: [
          { lines: [{ words: [{ text: 'A' }, { text: 'B' }] }, { words: [{ text: 'C' }] }] },
        ],
      },
      { paragraphs: [{ lines: [{ words: [{ text: 'D' }] }] }] },
    ]);
    expect(words.map((w) => w.text)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('flattenBlockWords is defensive against null/missing levels', () => {
    expect(flattenBlockWords(null)).toEqual([]);
    expect(flattenBlockWords(undefined)).toEqual([]);
    expect(flattenBlockWords([{}, { paragraphs: [{}] }])).toEqual([]);
  });

  it('mapTesseractResult reads words from blocks (v6+ path)', () => {
    const result = mapTesseractResult(
      {
        text: 'Hi there',
        confidence: 80,
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    words: [
                      { text: 'Hi', bbox: { x0: 0, y0: 0, x1: 10, y1: 12 }, confidence: 88 },
                      { text: 'there', bbox: { x0: 12, y0: 0, x1: 40, y1: 12 }, confidence: 75 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      'eng',
    );
    expect(result.words.map((w) => w.text)).toEqual(['Hi', 'there']);
    expect(result.words[0].bbox).toEqual({ x0: 0, y0: 0, x1: 10, y1: 12 });
  });

  it('mapTesseractResult falls back to a legacy flat words array', () => {
    const result = mapTesseractResult(
      { text: 'x', confidence: 50, words: [{ text: 'x', bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } }] },
      'eng',
    );
    expect(result.words).toHaveLength(1);
    expect(result.words[0].text).toBe('x');
  });
});
