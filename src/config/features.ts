/**
 * Feature-flag / kill-switch seam (#28). Every gated feature defaults ON; a
 * build-time env var (`VITE_FEATURE_<NAME>`) of false/0/off/no turns it off, so a
 * bad deploy is one env change away from disabled — no code change, no rollback.
 * true/1/on/yes is read too (it keeps the feature on). A `localStorage` override
 * (`pdfturbo.feature.<key>` = on/off) wins over the env, for local dev toggling.
 * (phonePad defaulted OFF through a per-key DEFAULT_OFF set until its real-phone
 * check; that set went when phone-signature-pad step 7b turned it on, 2026-11-12.)
 * Scope of a switch, stated because phonePad's is narrower than it reads (panel round 4 K1/S3, ruled 2026-11-12
 * 15:37): off, phonePad removes the PC's entry points (Sign on phone, Import image, the camera); `pad.html` is a
 * separate Vite entry and is still built and served, so a QR already on a phone still opens it. And NO deploy path
 * sets any VITE_FEATURE_* today: to pull a feature, add the variable to the build step's env in
 * `.github/workflows/deploy.yml`.
 *
 * env values are read lazily (at call time) so the value is always current and
 * so tests can `vi.stubEnv` without module-cache resets. Vite still statically
 * replaces each literal `import.meta.env.VITE_FEATURE_*` at build.
 */

export type FeatureKey = 'trueEdit' | 'searchableOcr' | 'eSign' | 'flatten' | 'xfdf' | 'bates' | 'crop' | 'compress' | 'signers' | 'textDecor' | 'docxEdit' | 'phonePad';

const OFF = new Set(['false', '0', 'off', 'no']);
const ON = new Set(['true', '1', 'on', 'yes']);

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

/** override > env > the default (ON); an unrecognised value falls through. */
export function isEnabled(feature: FeatureKey): boolean {
  const o = override(feature);
  if (o !== null) return o;
  const env = envFlag(feature)?.toLowerCase();
  if (env && OFF.has(env)) return false;
  if (env && ON.has(env)) return true;
  return true;
}
