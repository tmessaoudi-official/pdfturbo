// F-B — app version display.
// `__APP_VERSION__` is a build-time constant injected by Vite `define`
// (vite.config.ts, read from package.json). The test build (vitest.config.ts) has
// no `define`, so the token is NOT replaced there — `typeof` guards against a
// ReferenceError and falls back to a dev marker. Bump policy: semver via
// `npm version patch` (a fix) / `npm version minor` (a feature) — the bumped
// package.json version flows into the footer on the next build.

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

/** Footer label, e.g. "v1.0.0". */
export function formatVersionLabel(version: string = APP_VERSION): string {
  return `v${version}`;
}

/** Populate a footer element with the app version. No-op if the element is absent. */
export function renderAppVersion(el: HTMLElement | null, version: string = APP_VERSION): void {
  if (!el) return;
  el.textContent = formatVersionLabel(version);
}
