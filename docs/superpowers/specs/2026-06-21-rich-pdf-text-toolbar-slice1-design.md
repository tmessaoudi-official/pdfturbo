# Rich PDF Text Toolbar — Slice 1 Design

**Date:** 2026-06-21
**Status:** Design — awaiting user review before plan
**Scope:** 8 Tier-1 "quick-win" text-formatting controls for overlay `TextElement`s, plus
their placement in a new "Text ⋮" overflow popover.

## Decisions Log

- [2026-06-21] AGREED: Lead track = **rich PDF text toolbar** (Track A); true-edit (B),
  Arabic/RTL (C), and the open RTL P1 become the follow-on backlog.
- [2026-06-21] AGREED: Research run as a parallel multi-agent Workflow (35 deduped
  candidates produced).
- [2026-06-21] AGREED: **Slice 1 = 8 Tier-1 quick-wins** — discrete L/C/R align, highlight/
  background color, line spacing, text opacity, text case, clear formatting, format painter,
  color presets/recent.
- [2026-06-21] AGREED: **Placement = Option A, "Text ⋮" overflow popover.** Inline: discrete
  align + color presets. Popover: case, line-spacing, opacity, bg-color, clear-formatting,
  format-painter. Rationale: idiomatic with existing `batesPanel`/`watermarkPanel`/
  `signersPanel`; keeps the toolbar de-cluttered; scales to Tier-2/3 as extra popover rows.

## Goal & Non-Goals

**Goal:** make the PDF text toolbar visibly richer by adding 8 high-expectation controls that
operate on overlay `TextElement`s, with full undo/redo, persistence, export-bake fidelity, and
i18n — without any architectural rearchitecture.

**Non-goals (Slice 1):**
- True source-text editing of these attributes (the `replaceTextAt` Path 1/2/3 paths). Text
  *case* is the only feature with a natural true-edit extension; it is **overlay-only** here.
- Multi-run / per-character rich text (the documented "ceiling" — a separate subsystem).
- Justify alignment, character spacing, stroke/outline (Tier-2 — later slice).
- Arabic/RTL controls and the RTL overflow P1 (separate track).

## Verified Baseline (read 2026-06-21)

- `src/elements/textElement.ts` — `TextElement` has `text, fontSize, color, fontFamily, bold,
  italic, underline, strikethrough, align ('left'|'center'|'right'), multiline`. **No**
  `opacity`, `lineHeight`, `backgroundColor`. `toJSON` serializes all current fields.
  `_applyInputFormatting` sets DOM styles; `render` builds an `<input>`/`<textarea>` inside a
  `.text-element` div.
- `src/export/pdfElementRenderer.ts` `renderText` — line height is **hardcoded**
  `te.fontSize * 1.2`; align offset already computed for center/right; underline/strike via
  `page.drawLine`; **opacity not passed** to `drawText`. Rotated text decorations are a
  documented ceiling (`elemRot` is the unrotated signal, not `pdfRotVal`).
- `src/elements/highlightElement.ts` — already implements `color + opacity → rgba()` for DOM
  and is baked as a filled rect. Direct reference for bg-color + opacity.
- `src/utils/elementFactory.ts` `fromJSON` (text branch, ~L27-37) — rehydrates each field with
  a `?? default`. New optional fields must be added here too. `applyBase` does **not** set `id`
  from data (constructor auto-assigns).
- `src/core/formattingService.ts` — every mutation is
  `historyManager.record(new MoveResizeCmd(elements, el, before, { field: value }))`.
  `MoveResizeCmd` applies an arbitrary partial-field diff, so new fields work unchanged.
- `src/ui/binders/formattingBinder.ts` — wires toolbar DOM events to thin `app.*` delegators
  over `FormattingService`.

## Schema / Persistence

All new `TextElement` fields are **optional with sensible defaults → NO `SCHEMA_VERSION`
bump** (matches the Bates/crop convention). `toJSON` emits them; `fromJSON` reads them with a
`?? default` fallback so pre-Slice-1 saved sessions restore cleanly.

## Feature Designs

Each mutation goes through `FormattingService` and records a `MoveResizeCmd` (or `MacroCmd` for
clear-formatting), giving undo/redo + autosave for free. All early-return when the selected
element is not a `TextElement` (the established guard).

### 1. Discrete L / C / R alignment buttons
- **Model:** none — reuse `align`.
- **Service:** `setAlign(value: TextAlign)` (generalizes the existing `cycleAlign`; keep
  `cycleAlign` or remove its button). Records `{ align }`.
- **DOM/bake:** already handled (`_applyInputFormatting` sets `text-align`; bake offsets).
- **UI:** three inline buttons `L` `C` `R`; active one gets `btn-active-fmt`.

### 2. Highlight / background color behind text
- **Model:** `+ backgroundColor?: string` (undefined = none).
- **Service:** `setTextBackground(value: string)` / `clearTextBackground()`.
- **DOM:** set the `.text-element` div `background` to `rgba(...)` (reuse HighlightElement's hex
  parse) at the element `opacity`.
- **Bake:** in `renderText`, before drawing glyphs, `page.drawRectangle({ x, y, width, height,
  color, opacity })` over the element box (transform via `tp`). Skip when undefined.
- **UI (popover):** color input + a "None" toggle (mirror the existing fill `_noFill` toggle).

### 3. Line spacing (leading)
- **Model:** `+ lineHeight?: number` (multiplier; default 1.2).
- **Service:** `setLineHeight(mult: number)` (clamp ~1.0–3.0).
- **DOM:** `input.style.lineHeight = String(lineHeight)`.
- **Bake:** replace hardcoded `te.fontSize * 1.2` with `te.fontSize * (te.lineHeight ?? 1.2)`.
- **UI (popover):** number input.

### 4. Text opacity
- **Model:** `+ opacity?: number` (0–1; default 1).
- **Service:** `setTextOpacity(v: number)` (clamp 0–1).
- **DOM:** `div.style.opacity = String(opacity)`.
- **Bake:** pass `opacity` to `drawText`, the underline/strike `drawLine`, and the bg
  `drawRectangle`. (pdf-lib accepts `opacity` on all three — already used in `renderComment`.)
- **UI (popover):** range slider.

### 5. Text case (UPPER / lower / Title)
- **Model:** none — transforms `te.text`.
- **Service:** `transformCase(mode: 'upper'|'lower'|'title')`; pure helper
  `applyTextCase(text, mode)` (Title = capitalize each whitespace-delimited word). Records
  `{ text }`. **Overlay-only** in Slice 1.
- **UI (popover):** three buttons `AA` `aa` `Aa`.

### 6. Clear formatting
- **Model:** none.
- **Service:** `clearFormatting()` — reset `bold/italic/underline/strikethrough` → false,
  `align` → 'left', `fontFamily` → 'Arial', `fontSize` → 14, `color` → '#000000',
  `lineHeight`/`opacity`/`backgroundColor` → undefined, in **one** `MoveResizeCmd` (multi-field
  before/after diff). Does **not** alter `text`.
- **UI (popover):** one button.

### 7. Format painter (copy style)
- **State:** transient `_copiedTextStyle: Partial<...> | null` on `FormattingService` (not
  persisted, not undoable to copy).
- **Flow:** click painter while a text element is selected → snapshot its formatting fields +
  arm (button shows armed/active). The **next** text element selected receives the style via a
  single `MoveResizeCmd`, then disarm. Requires a hook in the selection path
  (`selectionHandler`/placement) that checks the armed flag on select.
- **UI (popover):** toggle button 🖌; Esc / re-click disarms.

### 8. Color presets / recent colors
- **State:** preset palette (static ~8 swatches) + recent colors (last 8) in `localStorage`.
- **Flow:** clicking a swatch sets `colorInput.value` and dispatches an `input` event — reuses
  the existing `setElementColor` path entirely (same pattern as the EyeDropper dispatch). A
  committed color pushes onto the recent list.
- **UI (inline):** a small swatch row adjacent to the existing color input. Pure UI; no model
  or bake change.

## Components & Boundaries

- `FormattingService` (`src/core/formattingService.ts`) — gains the new methods above. Single
  source of mutation truth; each method is independently testable in jsdom.
- `TextElement` (`src/elements/textElement.ts`) — gains `backgroundColor?`, `lineHeight?`,
  `opacity?`; `toJSON` + `_applyInputFormatting`/`applyStyles` updated.
- `elementFactory.fromJSON` — rehydrate the 3 new fields.
- `pdfElementRenderer.renderText` — bg rect, line-height var, opacity threading.
- New `src/ui/textOptionsPopover.ts` — the "Text ⋮" popover (focus-trap/Esc/backdrop, mirrors
  `batesPanel.ts`). Holds case/line-spacing/opacity/bg-color/clear/painter controls.
- New pure helper(s): `applyTextCase` (case transform); a small `recentColors` store helper.
- `index.html` — inline discrete-align buttons + color-swatch row + the "⋮ More" trigger.
- `formattingBinder.ts` — wire the inline controls + popover open/close.
- `main.ts` — popover instantiation. **No feature flag** for Slice 1: these are additive
  improvements to the existing (always-on) formatting toolbar, not experimental features, so a
  `VITE_FEATURE_*` seam (reserved for larger opt-in features per #28) would add needless
  complexity.

## Error Handling

- All service methods early-return on non-text selection (no throw).
- Numeric inputs clamped (line-height 1.0–3.0, opacity 0–1, parsed with NaN-safe `intOr`/
  `floatOr` — never `parseFloat(...) || x`, which would rewrite a deliberate 0).
- `localStorage` access wrapped in try/catch (private-mode safe; degrade to in-memory).

## Testing

- **jsdom unit:** one test per new `FormattingService` method (mutation + command recorded +
  early-return guard); `applyTextCase` pure-function table; `recentColors` store; popover
  open/close + Esc.
- **Real-Chrome bake guard** (`tests/browser/*.browser.test.ts`): export a text element with
  background color, non-default line spacing, and reduced opacity → assert the rendered PDF
  pixels show the bg fill, multi-line gap, and faded glyphs. Format-painter copy→apply
  round-trip in real DOM (selection wiring can't be exercised in jsdom).
- **Locale guard:** new `formatting.*` keys present in en/fr/ar (hook enforces key parity; ar
  values marked [Unverified] pending native review).

## Risks / Mitigations

- **Popover/toolbar split feels disjointed** — accepted; mitigated by keeping frequent controls
  (align, color) inline.
- **Format-painter selection hook widens app coupling** — confine the armed-flag check to one
  place in the selection path; document the seam.
- **Opacity × bg-color double-alpha** — define element `opacity` as the single alpha applied to
  glyphs, decorations, and the bg rect (bg color itself is opaque); avoids compounding.
- **Rotated text** — bg rect + decorations under element rotation remain the documented ceiling
  (same `elemRot` guard as existing underline/strike).

## Out of Scope → Backlog (after Slice 1)

RTL overflow P1 fix · direction-aware align · Tier-2 (stroke/outline, char spacing, `Tz`,
justify, whole-box sub/super) · Tier-2 (find&replace on overlay, links) · lists · multi-run
rich text.
