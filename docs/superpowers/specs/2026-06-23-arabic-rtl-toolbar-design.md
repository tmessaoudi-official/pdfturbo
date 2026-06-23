# Arabic-RTL deepening — Slice 2: RTL-aware toolbar controls (design)

**Date:** 2026-06-23
**Feature:** 3 of Option-3 backlog, **slice 2 of 3**. Slice 1 (char-level bidi engine, `src/utils/bidi.ts`)
is DONE (`11a3253`); this builds on it. Slice 3 (ligature/tashkeel) is queued (evaluate-then-defer).

## Problem

The export bake ALREADY auto-RTLs Arabic (`pdfElementRenderer.renderText` routes `isArabicText(line)`
→ `drawArabicLine`, right-aligned). The gap is the **editor**: the overlay `TextElement`'s `<input>` sets
`textAlign` but never `dir`, so *typing* Arabic is LTR-behaved (caret/flow/punctuation awkward), and the
user has no explicit control over text direction. Slice 2 adds editor direction-awareness + a toolbar
toggle.

## Scope decision (user)

**Full**: a `direction` field (default auto) + a toolbar RTL toggle, applied to the editor input `dir` and
default alignment. **Export stays content-auto-detected** — explicit direction does NOT override export
routing (forcing the Arabic font path on non-Arabic text mis-renders; declined). Editor + alignment only.

## Data model

`TextElement.direction?: 'auto' | 'rtl' | 'ltr'` — optional, default `'auto'`. `toJSON` omits when
`'auto'`/unset; `elementFactory.fromJSON` reads with `?? 'auto'`. **No `SCHEMA_VERSION` bump** (matches the
established optional-field pattern: underline/align/strokeWidth/charSpacing/…). Legacy blobs restore as
`'auto'`.

## Direction resolution (reuses Slice-1 engine)

- Export `baseDirection(text: string): 'rtl' | 'ltr'` from `src/utils/bidi.ts` — surfaces the existing
  private first-strong (UAX#9 P2/P3) logic (`_baseRtl` with base `'auto'`). More correct than `isArabicText`
  ("contains Arabic"); first-strong is the right rule for base direction.
- `resolveDirection(direction, text)` = `direction === 'auto' ? baseDirection(text) : direction`. (Helper may
  live in `FormattingService` or `textElement`; keep it pure.)

## Toolbar control — single override toggle

One new button `⇋ RTL` (`rtlBtn`) in the align group in `index.html` (beside L/C/R/justify):
- Default `'auto'` → an Arabic element auto-resolves RTL with zero clicks.
- Active (`btn-active-fmt`) when the *resolved* direction is RTL.
- Click sets the **opposite explicit** value: resolving-RTL → `'ltr'`; resolving-LTR → `'rtl'` (an override).

`FormattingService`:
- `setDirection(dir: 'auto'|'rtl'|'ltr')` and `toggleDirection()` — each a `MoveResizeCmd` (undoable),
  early-return without a selected `TextElement`.
- When the result resolves RTL **and** `align` is still the default `'left'`, set `align='right'` in the SAME
  command (the "RTL defaults right-align" behavior). An explicitly-chosen non-left align is untouched.

`uiController.updateFormattingToolbar` toggles `rtlBtn`'s `btn-active-fmt` from the selected element's
resolved direction; `formattingBinder` wires the click to `app.toggleDirection`.

## Editor application

In `textElement.ts` render: `input.dir = resolveDirection(this.direction, this.text)` so Arabic typing gets
caret-on-right / RTL flow. `textAlign` stays driven by `align` (now defaulting right for RTL via the command
above). This is the core UX fix.

## Export

**Unchanged.** `renderText` keeps per-line `isArabicText` auto-detection (Arabic already right-aligned via
`drawArabicLine`). The `direction` field is editor + alignment only in v1. Documented v1 boundary.

## i18n

`formatting.rtlTitle` (+ any label) in en/fr/ar (ar [Unverified] — native review needed).

## Testing

- jsdom: `formattingService.test.ts` (setDirection/toggleDirection, RTL→right-align coupling, undo,
  no-selection early-return), `textElement.test.ts` (render sets `input.dir` from resolved direction),
  `elementFactory.test.ts` (direction round-trip + legacy `'auto'` default), `bidi.test.ts` (`baseDirection`).
- real Chrome: extend `tests/browser/text-toolbar.browser.test.ts` — typing Arabic gives `dir=rtl`, toggle
  flips it; eyes-on screenshot to `qa-shots/f3-rtl-toolbar/`.
- Gate: `type-check && lint && test` then browser. RTK proxy → `vitest --reporter=dot`.

## Out of scope / ceiling

Export direction override (declined); per-run direction within one box; ligature/tashkeel GPOS (Slice 3);
direction control for shapes/other element types (text-only).

## Acceptance

1. `direction` field (default auto), toJSON-omit, legacy default — round-trip tested.
2. `baseDirection` exported + tested; `resolveDirection` pure.
3. Toolbar RTL toggle: active reflects resolved direction; click overrides; RTL defaults right-align; undoable.
4. Editor input gets `dir` from resolved direction (Arabic typing fixed) — real-Chrome verified + eyes-on.
5. Export byte-identical (no export change); LTR elements byte-identical.
6. One commit (slice 2). NO Co-Authored-By. Push manual.
