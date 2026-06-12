import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import ar from '../../locales/ar.json';

const _onChangedCallbacks: Array<() => void> = [];

/** Register a callback to re-render dynamic DOM after language change. */
export function onLanguageChanged(cb: () => void): void {
  _onChangedCallbacks.push(cb);
}

/** Translate a key (after initI18n has been awaited). */
export function t(key: string, opts?: Record<string, string | number>): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return String(i18next.t(key as any, opts as any));
}

/** Apply translations to all [data-i18n*] elements in the document. */
export function applyTranslations(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n ?? '');
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
    const val = t(el.dataset.i18nTitle ?? '');
    el.title = val;
    // Always sync aria-label — it must update on language change, not just on first render
    if (!el.hasAttribute('data-i18n-aria')) el.setAttribute('aria-label', val);
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder ?? '');
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria ?? ''));
  });
  document.querySelectorAll<HTMLImageElement>('[data-i18n-alt]').forEach(el => {
    el.alt = t(el.dataset.i18nAlt ?? '');
  });
  document.querySelectorAll<HTMLOptGroupElement>('[data-i18n-label]').forEach(el => {
    el.label = t(el.dataset.i18nLabel ?? '');
  });
}

/** Update <html lang> and <html dir> based on the current language. */
export function updateHtmlDir(): void {
  const lang = i18next.language?.split('-')[0] ?? 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

/** Initialize i18next once at app start. Awaited in main.ts before app creation. */
export async function initI18n(): Promise<void> {
  await i18next
    .use(LanguageDetector)
    .init({
      fallbackLng: 'en',
      supportedLngs: ['en', 'fr', 'ar'],
      load: 'languageOnly',
      resources: {
        en: { translation: en },
        fr: { translation: fr },
        ar: { translation: ar },
      },
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: 'i18nextLng',
        caches: ['localStorage'],
      },
      interpolation: { escapeValue: true },
    });

  updateHtmlDir();
  applyTranslations();
  updateLangButtons();
}

/** Switch the active language and refresh all UI. */
export async function changeLanguage(lang: string): Promise<void> {
  await i18next.changeLanguage(lang);
  updateHtmlDir();
  applyTranslations();
  updateLangButtons();
  _onChangedCallbacks.forEach(cb => cb());
}

export function getCurrentLang(): string {
  return i18next.language?.split('-')[0] ?? 'en';
}

function updateLangButtons(): void {
  const current = getCurrentLang();
  document.querySelectorAll<HTMLElement>('.lang-btn').forEach(btn => {
    btn.classList.toggle('lang-active', btn.dataset.lang === current);
  });
  const labels: Record<string, string> = { en: 'EN', fr: 'FR', ar: 'ع' };
  const globeBtn = document.getElementById('langGlobeBtn');
  if (globeBtn) globeBtn.textContent = '🌐 ' + (labels[current] ?? current.toUpperCase());
}
