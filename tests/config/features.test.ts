import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { isEnabled } from '../../src/config/features';

describe('feature flags (#28)', () => {
  beforeEach(() => {
    // jsdom here doesn't expose localStorage — provide a Map-backed fake.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: () => null,
      length: 0,
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('defaults ON when no env var and no override is set', () => {
    expect(isEnabled('trueEdit')).toBe(true);
    expect(isEnabled('searchableOcr')).toBe(true);
    expect(isEnabled('eSign')).toBe(true);
    expect(isEnabled('flatten')).toBe(true);
    expect(isEnabled('xfdf')).toBe(true);
  });

  it('an env var of false/0/off disables the feature (the deploy kill-switch)', () => {
    vi.stubEnv('VITE_FEATURE_E_SIGN', 'false');
    expect(isEnabled('eSign')).toBe(false);
    vi.stubEnv('VITE_FEATURE_TRUE_EDIT', '0');
    expect(isEnabled('trueEdit')).toBe(false);
    vi.stubEnv('VITE_FEATURE_SEARCHABLE_OCR', 'off');
    expect(isEnabled('searchableOcr')).toBe(false);
    vi.stubEnv('VITE_FEATURE_FLATTEN', 'no');
    expect(isEnabled('flatten')).toBe(false);
    vi.stubEnv('VITE_FEATURE_XFDF', 'false');
    expect(isEnabled('xfdf')).toBe(false);
  });

  it('a non-disabling env value leaves the feature ON', () => {
    vi.stubEnv('VITE_FEATURE_E_SIGN', 'true');
    expect(isEnabled('eSign')).toBe(true);
    vi.stubEnv('VITE_FEATURE_TRUE_EDIT', 'garbage');
    expect(isEnabled('trueEdit')).toBe(true);
  });

  it('a localStorage override takes precedence over the env var', () => {
    vi.stubEnv('VITE_FEATURE_E_SIGN', 'false'); // disabled by deploy…
    localStorage.setItem('pdfturbo.feature.eSign', 'on'); // …re-enabled locally for dev
    expect(isEnabled('eSign')).toBe(true);

    localStorage.setItem('pdfturbo.feature.trueEdit', 'off'); // disabled locally despite default ON
    expect(isEnabled('trueEdit')).toBe(false);
  });

  it('ignores an unrecognised localStorage override value', () => {
    localStorage.setItem('pdfturbo.feature.eSign', 'maybe');
    expect(isEnabled('eSign')).toBe(true);
  });
});
