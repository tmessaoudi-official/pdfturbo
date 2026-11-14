// @vitest-environment jsdom
// i18next 27 (dependency-upgrade-2026-11 commit 2): the default escape no longer turns `/` into `&#x2F;`. A file name
// or a path in an interpolated value now reads as typed; the five HTML-significant characters are still escaped
// (`escapeValue: true`, src/utils/i18n.ts), so a value cannot inject markup.
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules(); // i18next is a singleton: a fresh one per case
  localStorage.clear();
  localStorage.setItem('i18nextLng', 'en');
});

describe('interpolated values (i18next 27 escape)', () => {
  it('a / in a value is shown as typed', async () => {
    const { initI18n, t } = await import('../../src/utils/i18n');
    await initI18n();
    expect(t('toast.pdfSaved', { name: 'reports/2026/q3.pdf' })).toBe('Saved to reports/2026/q3.pdf');
  });

  it('control: & < > " \' are still escaped', async () => {
    const { initI18n, t } = await import('../../src/utils/i18n');
    await initI18n();
    expect(t('toast.pdfSaved', { name: `<b>&"'` })).toBe('Saved to &lt;b&gt;&amp;&quot;&#39;');
  });
});
