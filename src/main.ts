// Main entry point
import './styles/index.css'; // app styles (extracted from index.html's inline <style>)
import './utils/polyfills';
import { PDFTurboApp } from './core/pdfTurboApp';
import { LogBuffer } from './core/logBuffer';
import { installGlobalErrorBoundary } from './core/globalErrorBoundary';
import { initI18n, changeLanguage, onLanguageChanged } from './utils/i18n';
import { registerSW } from 'virtual:pwa-register';
import { wireSwUpdate } from './pwaUpdate';
import { isEnabled } from './config/features';
import { renderAppVersion } from './utils/appVersion';

// Shared diagnostic ring buffer (M0 #41). Created before anything else so the global
// error boundary (M0 #1) can record failures that occur during i18n/app construction,
// before the app — and its ErrorReporter — exist. The same buffer is handed to the app
// so reporter calls and boundary catches share one rolling history.
const logBuffer = new LogBuffer();
let appRef: PDFTurboApp | undefined;
installGlobalErrorBoundary({ getReporter: () => appRef?.reportError, log: logBuffer });

// G16 — actionable PWA update. registerType:'prompt' (vite.config.ts) parks the
// new service worker until the user opts in. `wireSwUpdate` captures the
// `updateSW` returned by registerSW and hands the apply action to
// `_showSwUpdateBanner`, which surfaces a persistent, dismissible "Reload"
// affordance (the toast auto-dismisses in ~2.5s, too fast to act on). Clicking
// Reload calls updateSW(true) → activate the waiting SW + reload to the new
// version. No auto-reload: updateSW is only called from the click handler.
wireSwUpdate({
  registerSW,
  showUpdatePrompt: _showSwUpdateBanner,
});

/**
 * Reveal the static update banner and wire its actions. `applyUpdate` activates
 * the waiting SW and reloads (passed in by wireSwUpdate). Idempotent: re-binds
 * fresh listeners on each call (a new onNeedRefresh supersedes the prior offer).
 */
function _showSwUpdateBanner(applyUpdate: () => void): void {
  const banner = document.getElementById('swUpdateBanner');
  const reloadBtn = document.getElementById('swUpdateReload');
  const dismissBtn = document.getElementById('swUpdateDismiss');
  if (!banner) return;
  banner.style.display = '';
  // Replace nodes to drop any stale listeners from a previous offer, then bind.
  const freshReload = reloadBtn?.cloneNode(true) as HTMLElement | undefined;
  if (reloadBtn && freshReload) {
    reloadBtn.replaceWith(freshReload);
    freshReload.addEventListener('click', () => { applyUpdate(); });
  }
  const freshDismiss = dismissBtn?.cloneNode(true) as HTMLElement | undefined;
  if (dismissBtn && freshDismiss) {
    dismissBtn.replaceWith(freshDismiss);
    freshDismiss.addEventListener('click', () => { banner.style.display = 'none'; });
  }
}

declare global {
  interface Window { app?: PDFTurboApp; }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();

  const app = new PDFTurboApp(logBuffer);
  appRef = app;
  if (import.meta.env.DEV) window.app = app;

  // F-B — show the build version in the footer.
  renderAppVersion(document.getElementById('appVersion'));

  // #28 — apply feature kill-switches to the UI. A disabled feature's entry
  // point is removed so it can't be reached; the behavioural gates (true-edit,
  // OCR mode) are enforced at their call sites too (defence in depth).
  if (!isEnabled('eSign')) app.ui.signBtn.style.display = 'none';
  if (!isEnabled('searchableOcr')) {
    app.ui.ocrModeSelect.querySelector('option[value="searchable"]')?.remove();
    // 'searchable' was the first/default option; with it gone, fall back to the
    // in-page 'visible' mode (the pre-existing flag-off default) rather than
    // letting the new 'docx'/'text' export options become the default.
    app.ui.ocrModeSelect.value = 'visible';
  }
  if (!isEnabled('flatten')) app.ui.flattenBtn.style.display = 'none';
  if (!isEnabled('xfdf')) {
    app.ui.exportXfdfBtn.style.display = 'none';
    app.ui.importXfdfBtn.style.display = 'none';
  }
  if (!isEnabled('bates')) app.ui.batesBtn.style.display = 'none';
  if (!isEnabled('crop')) { app.ui.cropBtn.style.display = 'none'; document.getElementById('cropControls')?.remove(); }
  if (!isEnabled('compress')) { app.ui.compressBtn.style.display = 'none'; app.ui.compressModal.remove(); }
  if (!isEnabled('signers')) { app.ui.signersBtn.style.display = 'none'; app.ui.signersModal.remove(); }

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
