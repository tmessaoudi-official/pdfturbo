// @vitest-environment jsdom
// WCAG 2.5.3 Label in Name (axe `label-content-name-mismatch`, serious since axe-core 4.14): a control's accessible
// name must contain its visible text, so a speech-input user can say what they see. `applyTranslations()` copies a
// `data-i18n-title` into `aria-label`, so for these buttons the title IS the accessible name. The real-Chrome gate
// (`tests/browser/a11y-axe.browser.test.ts`) audits the main view in English and every opened flyout and dialog in all
// three locales; this file pins the strings in jsdom, so a locale edit fails fast without a browser.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// The seven that sit inside a flyout or the text-options panel (2026-11-10): no gate opened those until the axe gate's
// every-disclosure pass. This reads the REAL index.html wiring — the visible text a user sees after
// `applyTranslations()` (the list buttons' word is translated through a `data-i18n` span) against the name it gets —
// so a title that drifts from its button, or a visible word left in English, fails here in all three locales.
describe('Label in Name — the flyout and text-options buttons, wired from index.html', () => {
  const IDS = ['editTextBtn', 'exportDocxBtn', 'exportMdBtn', 'superscriptBtn', 'subscriptBtn',
    'bulletListBtn', 'numberedListBtn'] as const;
  afterAll(async () => { await i18next.changeLanguage('en'); document.body.innerHTML = ''; });

  it('each name starts with the button\'s visible text, and the list word is in the UI language', async () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? '';
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
    localStorage.setItem('i18nextLng', 'en');
    await initI18n();
    const failures: string[] = [];
    for (const lng of ['en', 'fr', 'ar'] as const) {
      await changeLanguage(lng);
      for (const id of IDS) {
        const btn = document.getElementById(id);
        if (!btn) throw new Error(`#${id} missing from index.html`);
        const visible = spoken(btn.textContent ?? '');
        const name = btn.getAttribute('aria-label') ?? '';
        // Both sides lose a leading pictograph or bullet (✎, •) the same way axe drops it, and the match ends on a word
        // boundary: axe compares words, so "List" does not satisfy "Liste à puces".
        const n = spoken(name);
        const startsWithWord = n.startsWith(visible) && !/[\p{L}\p{N}]/u.test(n.charAt(visible.length));
        if (!visible || !startsWithWord) failures.push(`${lng} #${id}: "${visible}" vs "${name}"`);
      }
      for (const id of ['bulletListBtn', 'numberedListBtn']) {
        const shown = document.getElementById(id)?.textContent ?? '';
        if (!shown.endsWith(LOCALES[lng].formatting.list)) failures.push(`${lng} #${id} shows "${shown}"`);
      }
    }
    expect(failures).toEqual([]);
  });
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
