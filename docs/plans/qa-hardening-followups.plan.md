# QA hardening follow-ups Plan

Four follow-ups from the 2026-07-31 `/qa-sweep` work, taken together because they do not conflict.
Tasks 1 and 2 both touch `index.html` + `tests/ui/indexHtmlA11y.test.ts` so they serialize; tasks 3
and 4 add test files only.

## Decisions Log

- [2026-07-31 10:05] AGREED: do all four follow-ups (a11y naming, scrollable-region, raster pixel
  guard, ceiling pins) in one pass, provided they do not contradict each other.
- [2026-07-31 10:12] AGREED: task 1 needs **zero new i18n keys and no Arabic review** — measured, not
  assumed. All 13 "unnamed" controls already get a name from the `placeholder`/`title` accname
  fallback, so axe reports **no violation** for any of them. The work is therefore upgrading a
  fragile fallback to an explicit association using keys that already exist, not writing new strings.
- [2026-07-31 10:14] AGREED: task 2 is implemented as `tabindex="0"` on **`#pdfCanvas`** (the region's
  content), NOT on `#canvasContainer`. This is the fix CLAUDE.md already documents as open, and it
  preserves the 2026-07-30 ruling that the main landmark stays `tabindex="-1"`. Verified live: the
  violation disappears and ArrowDown actually scrolls the region (scrollTop 20 → 100) with the canvas
  focused.
- [2026-07-31 10:20] AGREED: CLAUDE.md's claim that the raster export path honours
  lineHeight/opacity/backgroundColor "via `globalAlpha` scoped inside the existing
  `ctx.save()/restore()`" is **factually wrong** and is corrected rather than tested against.
  `globalAlpha` appears nowhere in `src/`; the only `ctx.save()/restore()` pair in
  `exportPipeline.ts` is in the **ink stroke** rasterizer. There is exactly ONE text renderer
  (`pdfElementRenderer.renderText`) and the raster path calls it through `buildPageOverlays` before
  rasterizing, so the attributes are applied by already-pixel-guarded code. Task 3 is rescoped to
  what is genuinely unguarded: their survival through the extra rasterize → `embedPng` round-trip.

## Formal Plan

### Task 1 — explicit accessible names for the remaining controls

Not a WCAG failure today (a name exists via fallback), but placeholder-as-name is fragile: it is the
same pattern that made `#batesPrefix` announce `"ACME-"`, and a placeholder is not exposed once the
field has a value in some AT. Fix with existing keys only:

| control | change | key reused |
|---|---|---|
| `pdfPasswordInput` | `for=` on the existing `<label>Password</label>` (currently announces the placeholder `"Enter password…"` instead of its own label) | none needed |
| `signX/Y/W/H` | `role="group"` + `aria-labelledby` on `.sign-rect-row` → the group label; `data-i18n-aria` per field | `modal.sign.{x,y,width,height}`, `modal.sign.positionLabel` |
| `blankPageW/H` | same group pattern | `modal.blankPage.{widthPlaceholder,heightPlaceholder,customLabel}` |
| `shapeWidth` | `data-i18n-aria` (explicit) instead of relying on `title` | `toolbar.shapeWidthTitle` |

`UNNAMED_OK` then shrinks 13 → 5 (the hidden file/colour inputs, permanently exempt with the reason
recorded). Correct the test's prose too: it currently calls these "unnamed", which overstates.

### Task 2 — close the last hole in the deploy gate

`tabindex="0"` on `#pdfCanvas`; drop the single `A11Y_ACCEPTED` entry from `scripts/qa-sweep.mjs`, so
the gate has zero accepted exceptions; update `tests/ui/indexHtmlA11y.test.ts` (which asserts the
landmark stays `-1` — that assertion stands) and the CLAUDE.md § Live-app a11y entry.

### Task 3 — pixel-guard the rasterize round-trip

One browser test: a redaction-bearing page (forcing the raster path) carrying a styled text overlay
(`backgroundColor` + `opacity`), asserting the styling survives rasterize → `embedPng`, with a
control proving the assertion is non-vacuous. Plus the CLAUDE.md correction above.

### Task 4 — pin the ceilings asserted nowhere

C10 (3+ column → 2 groups), C12 (a source markup annotation SURVIVES flatten), C19 (tashkeel
codepoints reach the CID stream; positioning not asserted), C21 (ink is baked as a PNG data URL by
design). C11 is attempted last and dropped with a stated reason if it cannot be pinned without a
contrived fixture. Pins go in `tests/blockers/` per that directory's convention (a CEILING is a
normal passing `it` that pins current behaviour) and the README cross-reference is updated.

## Acceptance

Full deploy gate green: `npm audit` → type-check → lint → jsdom → real-Chrome browser →
`test:coverage:export` → build → `qa:sweep --allow-destructive`, plus the sweep reporting **zero**
`ACCEPT` lines after task 2.
