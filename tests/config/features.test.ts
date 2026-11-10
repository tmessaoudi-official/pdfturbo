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
    expect(isEnabled('bates')).toBe(true);
    expect(isEnabled('crop')).toBe(true);
    expect(isEnabled('compress')).toBe(true);
    expect(isEnabled('signers')).toBe(true);
    expect(isEnabled('textDecor')).toBe(true);
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
    vi.stubEnv('VITE_FEATURE_BATES', 'off');
    expect(isEnabled('bates')).toBe(false);
    vi.stubEnv('VITE_FEATURE_COMPRESS', 'false');
    expect(isEnabled('compress')).toBe(false);
    vi.stubEnv('VITE_FEATURE_SIGNERS', 'false');
    expect(isEnabled('signers')).toBe(false);
    vi.stubEnv('VITE_FEATURE_TEXT_DECOR', 'false');
    expect(isEnabled('textDecor')).toBe(false);
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

  // phonePad (phone-signature-pad plan step 3) is the first feature that defaults OFF until its manual check
  // passes (step 7). An env value can therefore ENABLE a key, not only kill it.
  describe('a default-OFF feature (phonePad)', () => {
    it('is off with no env var and no override', () => {
      expect(isEnabled('phonePad')).toBe(false);
    });

    it('an env value of true/1/on/yes enables it (the env switch reaches it)', () => {
      for (const v of ['true', '1', 'on', 'YES']) {
        vi.stubEnv('VITE_FEATURE_PHONE_PAD', v);
        expect(isEnabled('phonePad')).toBe(true);
      }
    });

    it('a false or unrecognised env value leaves it off', () => {
      vi.stubEnv('VITE_FEATURE_PHONE_PAD', 'false');
      expect(isEnabled('phonePad')).toBe(false);
      vi.stubEnv('VITE_FEATURE_PHONE_PAD', 'garbage');
      expect(isEnabled('phonePad')).toBe(false);
    });

    it('a localStorage override wins over the env either way', () => {
      localStorage.setItem('pdfturbo.feature.phonePad', 'on');
      expect(isEnabled('phonePad')).toBe(true);
      vi.stubEnv('VITE_FEATURE_PHONE_PAD', 'true');
      localStorage.setItem('pdfturbo.feature.phonePad', 'off');
      expect(isEnabled('phonePad')).toBe(false);
    });

    it('a default-ON feature is unchanged by the new rule: an "on" env value keeps it on', () => {
      vi.stubEnv('VITE_FEATURE_CROP', 'on');
      expect(isEnabled('crop')).toBe(true);
      expect(isEnabled('docxEdit')).toBe(true);
    });
  });
});
