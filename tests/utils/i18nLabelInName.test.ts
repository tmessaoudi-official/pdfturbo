// @vitest-environment jsdom
// WCAG 2.5.3 Label in Name (axe `label-content-name-mismatch`, serious since axe-core 4.14): a control's accessible
// name must contain its visible text, so a speech-input user can say what they see. `applyTranslations()` copies a
// `data-i18n-title` into `aria-label`, so for these buttons the title IS the accessible name. The real-Chrome gate
// (`tests/browser/a11y-axe.browser.test.ts`) checks English only; this file checks all three locales.
import { describe, it, expect, afterAll } from 'vitest';
import i18next from 'i18next';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import ar from '../../locales/ar.json';
import { initI18n, changeLanguage } from '../../src/utils/i18n';

const LOCALES = { en, fr, ar } as const;
/** Drop the leading pictograph (👥, 🌐) the way axe does: it is not text a user would speak. */
const spoken = (s: string): string => s.replace(/^[^\p{L}\p{N}]+/u, '').trim();

describe('Label in Name — the title that becomes the accessible name starts with the visible text', () => {
  for (const [lng, d] of Object.entries(LOCALES)) {
    it(`${lng}: Text, Signers and A− buttons`, () => {
      expect(d.toolbar.addTextTitle.startsWith(d.toolbar.addText)).toBe(true);
      expect(d.toolbar.addTextTitle).toContain('(T)'); // the shortcut is still announced
      expect(d.toolbar.signersTitle.startsWith(spoken(d.toolbar.signers))).toBe(true);
      // `#fontSizeDownBtn`'s visible text is the literal `A−` (U+2212) in index.html, not a locale string.
      expect(d.formatting.fontSizeDownTitle.startsWith('A−')).toBe(true);
    });
    // These three show their text only at desktop width (`.btn-label` is hidden in the 414 px test iframe), which is
    // why the axe gate missed them until it gained a 1280 px pass (2026-11-10).
    it(`${lng}: OCR, e-Sign and A+ buttons`, () => {
      expect(d.toolbar.ocrTitle.startsWith(d.toolbar.ocrLabel)).toBe(true);
      expect(d.toolbar.signCertTitle.startsWith(d.toolbar.signCertLabel)).toBe(true);
      expect(d.toolbar.signCertTitle).toContain('PKCS#12');
      expect(d.formatting.fontSizeUpTitle.startsWith('A+')).toBe(true); // literal `A+` in index.html
    });
  }
});

describe('Label in Name — the language globe button', () => {
  afterAll(async () => { await i18next.changeLanguage('en'); });

  it('its accessible name names the current language as shown, in every locale', async () => {
    document.body.innerHTML =
      '<button id="langGlobeBtn" class="lang-btn" data-i18n-title="toolbar.langTitle" title="Change language">🌐 EN</button>';
    localStorage.setItem('i18nextLng', 'en');
    await initI18n();
    const btn = document.getElementById('langGlobeBtn');
    if (!btn) throw new Error('langGlobeBtn missing from the fixture');
    const shown: Record<string, string> = { en: 'EN', fr: 'FR', ar: 'ع' };
    for (const lng of ['en', 'fr', 'ar']) {
      await changeLanguage(lng);
      expect(btn.textContent).toBe(`🌐 ${shown[lng]}`);
      const name = btn.getAttribute('aria-label') ?? '';
      expect(name).toContain(shown[lng]);
      // The purpose is still announced, and the tooltip keeps the plain purpose.
      expect(name.toLowerCase()).toContain(LOCALES[lng as keyof typeof LOCALES].toolbar.langTitle.toLowerCase());
      expect(btn.title).toBe(LOCALES[lng as keyof typeof LOCALES].toolbar.langTitle);
    }
  });
});
