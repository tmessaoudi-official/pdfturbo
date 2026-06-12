// Main entry point
import './utils/polyfills';
import { PDFEditorApp } from './core/pdfEditorApp';
import { initI18n, changeLanguage, onLanguageChanged } from './utils/i18n';

declare global {
  interface Window { app?: PDFEditorApp; }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();

  const app = new PDFEditorApp();
  if (import.meta.env.DEV) window.app = app;

  // Language switcher — re-render dynamic DOM on change
  onLanguageChanged(() => {
    app.onLanguageChanged();
  });

  document.querySelectorAll<HTMLElement>('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang;
      if (lang) changeLanguage(lang);
    });
  });

  // Globe language flyout toggle
  const langGlobeWrap = document.getElementById('langGlobeWrap');
  const langGlobeBtn  = document.getElementById('langGlobeBtn');
  const langGlobeFlyout = document.getElementById('langGlobeFlyout');
  langGlobeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = langGlobeWrap?.classList.toggle('open');
    langGlobeBtn.setAttribute('aria-expanded', String(!!isOpen));
    if (isOpen && langGlobeFlyout && langGlobeBtn) {
      const rect = langGlobeBtn.getBoundingClientRect();
      langGlobeFlyout.style.top  = (rect.bottom + 4) + 'px';
      // Align flyout right edge to button right edge; clamp to viewport left
      const flyoutW = langGlobeFlyout.offsetWidth || 140;
      langGlobeFlyout.style.left = Math.max(4, rect.right - flyoutW) + 'px';
    }
  });
  langGlobeFlyout?.addEventListener('click', () => {
    langGlobeWrap?.classList.remove('open');
    langGlobeBtn?.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('click', (e) => {
    if (!langGlobeWrap?.contains(e.target as Node)) {
      langGlobeWrap?.classList.remove('open');
      langGlobeBtn?.setAttribute('aria-expanded', 'false');
    }
  });

  // Storage notice banner — show once, dismissed to localStorage
  const banner = document.getElementById('storageBanner');
  const dismissBtn = document.getElementById('storageBannerDismiss');
  if (banner && !localStorage.getItem('pdfturbo_storage_notice')) {
    banner.style.display = '';
    dismissBtn?.addEventListener('click', () => {
      banner.style.display = 'none';
      localStorage.setItem('pdfturbo_storage_notice', '1');
    });
  }
});
