// G16 — actionable PWA update wiring.
//
// The app is built with `vite-plugin-pwa` using `registerType: 'prompt'`
// (vite.config.ts): a new deploy does NOT silently swap an open session — the
// waiting service worker stays parked until the user opts in. `registerSW`
// (from `virtual:pwa-register`) returns `updateSW(reloadPage?)`; calling
// `updateSW(true)` posts SKIP_WAITING to the waiting SW and reloads the page on
// `controllerchange`, swapping the running client to the new version.
//
// Historically `main.ts` only surfaced an "update available" toast on
// `onNeedRefresh` and never captured/called `updateSW`, so the user was told
// but could not act. This module is the testable seam: it captures `updateSW`
// and hands the apply action to a caller-supplied `showUpdatePrompt`, so the
// flow `onNeedRefresh → (user action) → updateSW(true)` is unit-testable
// without the Vite virtual module or a real service-worker lifecycle (neither
// of which exists under jsdom). `main.ts` provides the real `showUpdatePrompt`
// (a persistent, dismissible reload affordance) and `onOfflineReady`.

/** The function `registerSW` returns — `updateSW(true)` activates + reloads. */
export type UpdateSW = (reloadPage?: boolean) => Promise<void>;

/** Structural shape of `registerSW` from `virtual:pwa-register` (the bits we use). */
export type RegisterSWLike = (options: {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}) => UpdateSW;

export interface WireSwUpdateDeps {
  /** `registerSW` from `virtual:pwa-register` (injected so this is testable). */
  registerSW: RegisterSWLike;
  /**
   * Surface an actionable update notice. Receives `applyUpdate` — the action the
   * user opts into (e.g. a "Reload" button click). It MUST NOT be called eagerly:
   * `registerType: 'prompt'` is deliberate, so the page only reloads on user action.
   */
  showUpdatePrompt: (applyUpdate: () => void) => void;
  /** Called when the app is ready to work offline (first install). Optional. */
  onOfflineReady?: () => void;
}

/**
 * Register the service worker and wire the update lifecycle so the user can ACT
 * on a new version: on `onNeedRefresh`, the caller's `showUpdatePrompt` is given
 * an `applyUpdate` action that calls `updateSW(true)` (activate the waiting SW +
 * reload). `updateSW` is never called until that action runs — no auto-reload.
 */
export function wireSwUpdate(deps: WireSwUpdateDeps): void {
  const { registerSW, showUpdatePrompt, onOfflineReady } = deps;

  const updateSW = registerSW({
    onNeedRefresh() {
      showUpdatePrompt(() => {
        // Activate the waiting SW and reload to the new version. Fire-and-forget:
        // the reload (on controllerchange) supersedes any post-resolution work.
        void updateSW(true);
      });
    },
    onOfflineReady() {
      onOfflineReady?.();
    },
  });
}
