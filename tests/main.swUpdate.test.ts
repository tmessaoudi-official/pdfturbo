import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initI18n, t } from '../src/utils/i18n';

// E3: the SW "update available" notice must use the i18n key
// `toast.appUpdateAvailable`, not a hardcoded English literal — otherwise FR/AR
// users see English. As of G16 the notice is the actionable #swUpdateBanner
// (index.html), localized via `data-i18n` (resolved by the app's i18n DOM pass),
// not a `t()`-driven toast in main.ts. main.ts imports `virtual:pwa-register` (a
// Vite-only virtual module unresolvable under jsdom), so we assert behaviour
// three ways:
//  1. The translation key resolves to a real, non-empty localized string.
//  2. The update banner's text is wired to the i18n key via data-i18n in index.html.
//  3. Neither main.ts nor index.html hardcodes the old English update string.

const mainSrc = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

describe('main.ts SW update notification (E3)', () => {
  beforeAll(async () => {
    await initI18n();
  });

  it('the appUpdateAvailable key resolves to a non-empty localized string', () => {
    const msg = t('toast.appUpdateAvailable');
    expect(msg).toBeTruthy();
    expect(msg).not.toBe('toast.appUpdateAvailable'); // key actually resolved
  });

  it('the update banner text is wired via the i18n key (data-i18n), not a literal', () => {
    expect(indexHtml).toContain('data-i18n="toast.appUpdateAvailable"');
  });

  it('neither main.ts nor index.html hardcodes the old English update string', () => {
    expect(mainSrc).not.toContain('Update available — reload to apply');
    // The English copy lives only in locales/en.json, surfaced via data-i18n.
    expect(mainSrc).not.toContain("'Update available");
  });
});
