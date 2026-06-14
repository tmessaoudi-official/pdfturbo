# Sprint 1 — a11y/i18n P1 fixes (2026-06-14)

TDD red→green for three P1 defects. Runner note: `npx vitest` resolves to a
broken global shim that prints `PASS (0) FAIL (0)`; the real runner is
`node node_modules/vitest/vitest.mjs` (vitest 4.1.8). All evidence below uses it.

## E1 — Canvas annotation elements not exposed to AT (WCAG 2.1.1, 4.1.2)

**Defect**: `ElementLayerRenderer.rebuildElementLayer()` rendered each placed
element div with no role/tabindex/accessible name.

**Fix**: Added `_applyA11y(div, element)` called right after `element.render(...)`
in the rebuild loop. Sets:
- `role` from `_ELEMENT_ROLE` map (img for signature/shape/image/code; group otherwise)
- `tabindex="0"`
- `aria-label` via `t('element.aria.label'|'labelWithContent', { type, content })`,
  where `type` is `t('element.aria.type.<type>')`. Content is a trimmed, ≤60-char
  plain string read from `element.text` (if present) and set with `setAttribute`
  (never innerHTML) — safe despite i18next `escapeValue:false`.

**Locale keys added** (all 3, key-identical): `element.aria.label`,
`element.aria.labelWithContent`, `element.aria.type.{text,signature,shape,image,
highlight,comment,redaction,code}` (10 keys × 3 files).

**Test**: `tests/ui/elementLayerRenderer.a11y.test.ts` (4 tests) — role present,
tabindex=0, non-empty aria-label, label routed through `element.aria` key.
RED: 4 failed (null role/tabindex/label). GREEN: 4 passed.

## E2 — Toasts not announced (WCAG 4.1.3)

**Defect**: `#toast` container + `ToastQueue` had no live-region semantics.

**Fix**:
- `ToastQueue` constructor now sets `role=status`, `aria-live=polite`,
  `aria-atomic=true` on the container element.
- `index.html` line 1375 `#toast` div gets the same three attributes (belt-and-
  braces; the region is announced even before `ToastQueue` constructs).

**Test**: `tests/ui/toastQueue.a11y.test.ts` (3 tests). RED: 3 failed (null attrs).
GREEN: 3 passed. Existing `toastQueue.test.ts` (8 tests) still green — no regression.

## E3 — Hardcoded English SW-update toast

**Defect**: `src/main.ts` fallback path (`window.app` unset) set literal
`'Update available — reload to apply'`, shown to FR/AR users.

**Fix**: Imported `t` and changed the fallback to
`toast.textContent = t('toast.appUpdateAvailable')`. Key pre-existed in all 3
locales (line 314 each), verified.

**Test**: `tests/main.swUpdate.test.ts` (3 tests). main.ts imports the Vite-only
`virtual:pwa-register` (unresolvable under jsdom), so the test asserts: (1) the
key resolves to a real localized string via `initI18n()`+`t()`; (2) main.ts source
wires `t('toast.appUpdateAvailable')`; (3) main.ts no longer contains the old
literal. Assertions 2–3 were RED against original source; GREEN after fix.

## Combined run

```
node node_modules/vitest/vitest.mjs run \
  tests/ui/elementLayerRenderer.a11y.test.ts \
  tests/ui/toastQueue.a11y.test.ts \
  tests/main.swUpdate.test.ts
→ Test Files 3 passed (3) | Tests 10 passed (10)
```

Locale parity verified: en==fr==ar, 323 keys each.

## Files changed
- src/ui/elementLayerRenderer.ts (E1)
- src/ui/toastQueue.ts (E2)
- index.html (E2)
- src/main.ts (E3)
- locales/en.json, locales/fr.json, locales/ar.json (E1 keys)
- tests/ui/elementLayerRenderer.a11y.test.ts (new)
- tests/ui/toastQueue.a11y.test.ts (new)
- tests/main.swUpdate.test.ts (new)

Not touched (other agents own): exportService, contentStreamEditor, flowDoc, historyManager.
All edits passed oxlint-on-write + locale-sync-check hooks.
