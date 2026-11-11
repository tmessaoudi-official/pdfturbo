// @vitest-environment jsdom
// pad.html opened from the PC's QR carries the PC's language in its fragment (`#lang=fr`, phone-signature-pad step 5a).
// It is FORCED for that page only: the phone's stored choice (the editor's, same origin) must not be overwritten.
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules(); // i18next is a singleton: a fresh one per case
  localStorage.clear();
  document.documentElement.lang = '';
  document.documentElement.dir = '';
});

describe('initI18n({ lng })', () => {
  it('uses the forced language, sets <html lang/dir>, and leaves the stored choice alone', async () => {
    localStorage.setItem('i18nextLng', 'en');
    const { initI18n, getCurrentLang } = await import('../../src/utils/i18n');
    await initI18n({ lng: 'ar' });
    expect(getCurrentLang()).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem('i18nextLng')).toBe('en');
  });

  it('without one, detection runs as before (localStorage first)', async () => {
    localStorage.setItem('i18nextLng', 'fr');
    const { initI18n, getCurrentLang } = await import('../../src/utils/i18n');
    await initI18n();
    expect(getCurrentLang()).toBe('fr');
  });
});
