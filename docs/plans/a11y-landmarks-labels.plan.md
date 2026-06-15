# A11y Landmarks + Labels Plan

Resolve the 3 moderate accessibility findings from /qa-sweep 2026-06-15:
missing main/header landmarks, missing accessible names on 4 toolbar inputs,
and no skip-nav link. Plus coherent landmark structure (toolbar/search roles).

## Decisions Log
- [2026-06-15] AGREED: Fix the 3 moderate a11y findings (chosen via AskUserQuestion over push/stop).
- [2026-06-15] AGREED: Use the existing `data-i18n-aria` → `aria-label` mechanism (`i18n.ts:34`) for input labels, not static-only labels, so names stay correct across EN/FR/AR.
- [2026-06-15] AGREED: 3C convergence params = defaults 30/8.
- [2026-06-15] AGREED (3C cycle 2): also add `role="toolbar"`+aria-label to both `.toolbar` rows — adding `<main>` while leaving toolbars orphaned is half a landmark structure.
- [2026-06-15] AGREED (3C cycle 3): also make `#findBar` `role="search"` (a real landmark).
- [2026-06-15] NOTE: the P3 "sign-modal type=submit outside form" finding is moot — `grep 'type="submit"'` returns 0 matches in index.html.

## Formal Plan
1. `index.html`:
   - `<div class="header">` → `<header class="header">` (CSS keys off `.header` class; no JS selector depends on the tag — verified).
   - First `<body>` child: `<a class="skip-link" href="#canvasContainer" data-i18n="a11y.skipToContent">`.
   - `#canvasContainer`: add `role="main"` + `tabindex="-1"` (skip-link focus target).
   - `#fontFamily`, `#fontSize`, `#color`, `#pageInput`: add `data-i18n-aria` keys.
   - Both `.toolbar` rows: `role="toolbar"` + `data-i18n-aria`.
   - `#findBar`: `role="search"` + `data-i18n-aria`.
   - `.skip-link` CSS in the inline `<style>` (off-screen until `:focus`).
2. `locales/{en,fr,ar}.json`: new `a11y` namespace (`skipToContent`) + `toolbar.aria*` keys, key-identical (hook-enforced).
3. TDD: `tests/ui/indexHtmlA11y.test.ts` — parse index.html, assert landmarks/labels/skip-link + referenced i18n keys exist in all 3 locales.
4. Phase 7: mark findings resolved in the QA report.

## Verification
tsc 0 · oxlint 0/0 · jsdom suite green (incl. new test) · live axe re-check in preview.
```

