/// <reference types="vite/client" />

// Feature-flag kill-switches (#28). Unset → feature defaults ON; set to
// false/0/off at build time to disable a feature in a deploy.
interface ImportMetaEnv {
  readonly VITE_FEATURE_TRUE_EDIT?: string;
  readonly VITE_FEATURE_SEARCHABLE_OCR?: string;
  readonly VITE_FEATURE_E_SIGN?: string;
  readonly VITE_FEATURE_FLATTEN?: string;
  readonly VITE_FEATURE_XFDF?: string;
  readonly VITE_FEATURE_BATES?: string;
  readonly VITE_FEATURE_CROP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
