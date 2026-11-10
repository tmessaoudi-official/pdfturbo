/**
 * Feature-flag / kill-switch seam (#28). A gated feature defaults ON unless it is
 * listed in DEFAULT_OFF; a build-time env var (`VITE_FEATURE_<NAME>`) of
 * false/0/off/no turns it off, so a bad deploy is one env change away from
 * disabled — no code change, no rollback — and true/1/on/yes turns it on, which
 * is how a DEFAULT_OFF feature is enabled in a deploy. A `localStorage` override
 * (`pdfturbo.feature.<key>` = on/off) wins over the env, for local dev toggling.
 *
 * env values are read lazily (at call time) so the value is always current and
 * so tests can `vi.stubEnv` without module-cache resets. Vite still statically
 * replaces each literal `import.meta.env.VITE_FEATURE_*` at build.
 */

export type FeatureKey = 'trueEdit' | 'searchableOcr' | 'eSign' | 'flatten' | 'xfdf' | 'bates' | 'crop' | 'compress' | 'signers' | 'textDecor' | 'docxEdit' | 'phonePad';

const OFF = new Set(['false', '0', 'off', 'no']);
const ON = new Set(['true', '1', 'on', 'yes']);
/** Features that stay off until switched on: phonePad until its manual phone + webcam check (plan step 7). */
const DEFAULT_OFF: ReadonlySet<FeatureKey> = new Set<FeatureKey>(['phonePad']);

function envFlag(feature: FeatureKey): string | undefined {
  switch (feature) {
    case 'trueEdit': return import.meta.env.VITE_FEATURE_TRUE_EDIT;
    case 'searchableOcr': return import.meta.env.VITE_FEATURE_SEARCHABLE_OCR;
    case 'eSign': return import.meta.env.VITE_FEATURE_E_SIGN;
    case 'flatten': return import.meta.env.VITE_FEATURE_FLATTEN;
    case 'xfdf': return import.meta.env.VITE_FEATURE_XFDF;
    case 'bates': return import.meta.env.VITE_FEATURE_BATES;
    case 'crop': return import.meta.env.VITE_FEATURE_CROP;
    case 'compress': return import.meta.env.VITE_FEATURE_COMPRESS;
    case 'signers': return import.meta.env.VITE_FEATURE_SIGNERS;
    case 'textDecor': return import.meta.env.VITE_FEATURE_TEXT_DECOR;
    case 'docxEdit': return import.meta.env.VITE_FEATURE_DOCX_EDIT;
    case 'phonePad': return import.meta.env.VITE_FEATURE_PHONE_PAD;
  }
}

/** localStorage dev override: true/false to force, null when unset/unrecognised. */
function override(feature: FeatureKey): boolean | null {
  try {
    const v = localStorage.getItem(`pdfturbo.feature.${feature}`)?.toLowerCase();
    if (v && OFF.has(v)) return false;
    if (v && ON.has(v)) return true;
  } catch { /* localStorage unavailable (private mode / SSR) — fall through */ }
  return null;
}

/** override > env > the feature's default (ON, or OFF for DEFAULT_OFF); an unrecognised value falls through. */
export function isEnabled(feature: FeatureKey): boolean {
  const o = override(feature);
  if (o !== null) return o;
  const env = envFlag(feature)?.toLowerCase();
  if (env && OFF.has(env)) return false;
  if (env && ON.has(env)) return true;
  return !DEFAULT_OFF.has(feature);
}
