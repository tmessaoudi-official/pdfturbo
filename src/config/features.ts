/**
 * Feature-flag / kill-switch seam (#28). Each gated feature defaults ON; a
 * build-time env var (`VITE_FEATURE_<NAME>=false`) turns it off so a bad deploy
 * is one env change away from disabled — no code change, no rollback. A
 * `localStorage` override (`pdfturbo.feature.<key>` = on/off) wins over the env,
 * for local dev toggling.
 *
 * env values are read lazily (at call time) so the value is always current and
 * so tests can `vi.stubEnv` without module-cache resets. Vite still statically
 * replaces each literal `import.meta.env.VITE_FEATURE_*` at build.
 */

export type FeatureKey = 'trueEdit' | 'searchableOcr' | 'eSign' | 'flatten' | 'xfdf';

const OFF = new Set(['false', '0', 'off', 'no']);
const ON = new Set(['true', '1', 'on', 'yes']);

function envFlag(feature: FeatureKey): string | undefined {
  switch (feature) {
    case 'trueEdit': return import.meta.env.VITE_FEATURE_TRUE_EDIT;
    case 'searchableOcr': return import.meta.env.VITE_FEATURE_SEARCHABLE_OCR;
    case 'eSign': return import.meta.env.VITE_FEATURE_E_SIGN;
    case 'flatten': return import.meta.env.VITE_FEATURE_FLATTEN;
    case 'xfdf': return import.meta.env.VITE_FEATURE_XFDF;
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

/** True unless the feature is explicitly disabled (override > env > default-ON). */
export function isEnabled(feature: FeatureKey): boolean {
  const o = override(feature);
  if (o !== null) return o;
  const env = envFlag(feature)?.toLowerCase();
  if (env && OFF.has(env)) return false;
  return true;
}
