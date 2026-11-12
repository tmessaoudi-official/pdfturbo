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

// 7b commit B: the pad page switches language on a new link (hashchange). It must never STORE a language: a pad opened
// without `lang` used to cache the detected one to `i18nextLng`, and a later `#lang=fr` would then switch the EDITOR's
// language on that phone (same origin, same localStorage).
describe('initI18n({ store: false }) — the pad never stores a language', () => {
  it('no lng, then a language switch: nothing is written', async () => {
    const { initI18n, changeLanguage, getCurrentLang } = await import('../../src/utils/i18n');
    await initI18n({ store: false });
    await changeLanguage('fr');
    expect(getCurrentLang()).toBe('fr');
    expect(localStorage.getItem('i18nextLng')).toBeNull();
  });

  it('the control: the editor (no option) still stores the switch', async () => {
    const { initI18n, changeLanguage } = await import('../../src/utils/i18n');
    await initI18n();
    await changeLanguage('fr');
    expect(localStorage.getItem('i18nextLng')).toBe('fr');
  });
});
