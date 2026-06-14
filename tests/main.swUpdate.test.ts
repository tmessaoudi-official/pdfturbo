import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initI18n, t } from '../src/utils/i18n';

// E3: the SW "update available" fallback toast in src/main.ts must use the i18n
// key `toast.appUpdateAvailable`, not a hardcoded English literal — otherwise
// FR/AR users see English. main.ts imports `virtual:pwa-register` (a Vite-only
// virtual module unresolvable under jsdom), so we assert behaviour two ways:
//  1. The translation key resolves to a real, non-empty localized string.
//  2. The main.ts source wires the toast text to t('toast.appUpdateAvailable')
//     and no longer contains the old hardcoded English string.

const mainSrc = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');

describe('main.ts SW update notification (E3)', () => {
  beforeAll(async () => {
    await initI18n();
  });

  it('the appUpdateAvailable key resolves to a non-empty localized string', () => {
    const msg = t('toast.appUpdateAvailable');
    expect(msg).toBeTruthy();
    expect(msg).not.toBe('toast.appUpdateAvailable'); // key actually resolved
  });

  it('main.ts sets the fallback toast text via the i18n key, not a literal', () => {
    expect(mainSrc).toContain("t('toast.appUpdateAvailable')");
  });

  it('main.ts no longer hardcodes the English update string', () => {
    expect(mainSrc).not.toContain('Update available — reload to apply');
  });
});
