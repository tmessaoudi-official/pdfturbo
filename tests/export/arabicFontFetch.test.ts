// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PDFDocument } from '@cantoo/pdf-lib';

vi.mock('@pdf-lib/fontkit', () => ({ default: {} }));

function fakeDoc(): PDFDocument {
  return { registerFontkit: vi.fn(), embedFont: vi.fn().mockResolvedValue('FONT') } as unknown as PDFDocument;
}

// Fresh module per test so the module-level _notoBytes cache doesn't leak between cases.
async function freshGetArabicFont() {
  vi.resetModules();
  return (await import('../../src/export/arabicOverlay')).getArabicFont;
}

describe('getArabicFont — asset-fetch hardening (M0 #10)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('does not cache a failed font fetch — a later call retries instead of failing forever', async () => {
    const getArabicFont = await freshGetArabicFont();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 }) // first attempt fails
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2]).buffer) }); // retry succeeds
    vi.stubGlobal('fetch', fetchMock);

    await expect(getArabicFont(fakeDoc())).rejects.toThrow();
    await expect(getArabicFont(fakeDoc())).resolves.toBe('FONT');
    expect(fetchMock).toHaveBeenCalledTimes(2); // retried — the rejection was not cached
  });

  it('rejects on a non-ok response instead of embedding garbage bytes', async () => {
    const getArabicFont = await freshGetArabicFont();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(getArabicFont(fakeDoc())).rejects.toThrow();
  });
});
