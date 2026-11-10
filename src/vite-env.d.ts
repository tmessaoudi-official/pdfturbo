/// <reference types="vite/client" />

// Feature-flag kill-switches (#28). Unset → the feature's default: ON, except the
// DEFAULT_OFF keys in src/config/features.ts. Set to false/0/off at build time to
// disable a feature in a deploy, or true/1/on to enable a DEFAULT_OFF one.
interface ImportMetaEnv {
  readonly VITE_FEATURE_TRUE_EDIT?: string;
  readonly VITE_FEATURE_SEARCHABLE_OCR?: string;
  readonly VITE_FEATURE_E_SIGN?: string;
  readonly VITE_FEATURE_FLATTEN?: string;
  readonly VITE_FEATURE_XFDF?: string;
  readonly VITE_FEATURE_BATES?: string;
  readonly VITE_FEATURE_CROP?: string;
  readonly VITE_FEATURE_DOCX_EDIT?: string;
  // These three were MISSING while `features.ts` read them. Vite's own `ImportMetaEnv extends
  // Record<ImportMetaEnvFallbackKey, any>` swallows an undeclared key, so a typo in one of them
  // type-checked clean and silently disabled nothing. [WS5 P2, 2026-09-04]
  readonly VITE_FEATURE_COMPRESS?: string;
  readonly VITE_FEATURE_SIGNERS?: string;
  readonly VITE_FEATURE_TEXT_DECOR?: string;
  // Defaults OFF (features.ts DEFAULT_OFF): true/1/on/yes enables the phone signature pad in a deploy.
  readonly VITE_FEATURE_PHONE_PAD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// F-B — build-time app version, injected by Vite `define` (vite.config.ts) from
// package.json. Not replaced in the test build (no `define` in vitest.config.ts);
// appVersion.ts guards with `typeof` and falls back to a dev marker.
declare const __APP_VERSION__: string;
