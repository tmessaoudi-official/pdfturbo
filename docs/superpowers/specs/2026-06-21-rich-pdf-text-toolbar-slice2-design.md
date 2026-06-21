# Rich PDF Text Toolbar — Slice 2 (Tier-2) Design

**Date:** 2026-06-21
**Status:** Design — awaiting user review before plan
**Scope:** 5 Tier-2 text-formatting controls for overlay `TextElement`s — text stroke/outline,
character spacing (Tc), horizontal scale (Tz), justify alignment, and whole-box super/subscript —
plus the new raw-operator bake path they require.

## Decisions Log
- [2026-06-21] AGREED: Slice 2 = ALL 5 Tier-2 controls (stroke/outline, char-spacing, horizontal-
  scale, justify, sub/superscript). User: "do all".
- [2026-06-21] AGREED: Placement = **justify inline** (4th button next to L/C/R), the other four in
  the existing "Text ⋮" popover as new rows.
- [2026-06-21] AGREED: introduce a raw-operator text bake (`pushOperators`) used ONLY when an
  advanced attr is set; `drawText` stays the default → byte-identical export for current elements.
- [2026-06-21] AGREED: overlay-only (no true source-text editing); rotated element + advanced attr
  falls back to `drawText` (attrs ignored) — documented ceiling.

## Goal & Non-Goals
**Goal:** add 5 high-expectation Tier-2 text controls to overlay `TextElement`s with full undo/redo,
persistence, export-bake fidelity, and i18n — extending Slice 1 without rearchitecture.

**Non-goals (Slice 2):**
- True source-text editing of these attributes (the `replaceTextAt` paths).
- Multi-run / per-character rich text (the documented ceiling).
- Tc/Tz/stroke on RTL/Arabic overlay text (separate `arabicOverlay` path) — Latin/WinAnsi only.
- Per-run (intra-element) variation — these are whole-element attributes.

## Verified Baseline (read 2026-06-21)
- `src/elements/textElement.ts` — `TextElement` has `text, fontSize, color, fontFamily, bold,
  italic, underline, strikethrough, align ('left'|'center'|'right'), multiline, backgroundColor?,
  lineHeight?, opacity?`. `toJSON` emits optional fields only when set; `applyStyles`/
  `_applyInputFormatting` set DOM styles.
- `src/export/pdfElementRenderer.ts` `renderText` — draws via `page.drawText(line, {x,y,size,font,
  color,opacity})`; decorations via `page.drawLine` (gated `!elemRot`); bg via `page.drawRectangle`.
  **`drawText` exposes no charSpacing / horizontalScale / render-mode (stroke).**
- `src/export/arabicOverlay.ts` — embeds a font + emits raw text operators via `page.pushOperators`
  (`BT … Tf … Tj … ET`). The reference pattern for the new operator bake.
- `src/core/formattingService.ts` — every mutation records a `MoveResizeCmd(elements, el, before,
  {field: value})`; new fields work unchanged. Methods early-return when selection is not a
  `TextElement`. Slice-1 methods: `setAlign`, `setLineHeight`, `setTextOpacity`, `setTextBackground`,
  `clearTextBackground`, `transformCase`, `clearFormatting`, `copyTextStyle`/`pasteTextStyle`.
- `src/ui/uiController.ts` `updateFormattingToolbar` toggles `btn-active-fmt` on the align buttons.
- `src/ui/textOptionsPopover.ts` — app-owned popover (focus-trap/Esc), home for the new rows.

## Schema / Persistence
New `TextElement` fields are **optional with defaults → NO `SCHEMA_VERSION` bump** (Slice-1/Bates/crop
precedent). `align` widens to include `'justify'` (already a string union — additive). `toJSON` emits
each only when set; `fromJSON` reads with `?? default`. Pre-Slice-2 sessions restore unchanged.

New fields:
- `strokeColor?: string` (hex) and `strokeWidth?: number` (pt; 0/undefined = no stroke)
- `charSpacing?: number` (pt; default 0; may be negative)
- `horizontalScale?: number` (percent; default 100)
- `baselineShift?: 'super' | 'sub'` (whole-box; undefined = baseline)

## Feature Designs
Each mutation goes through `FormattingService` → `MoveResizeCmd` (undo/redo + autosave). All
early-return on non-text selection.

### 1. Text stroke / outline
- **Service:** `setTextStroke(color: string, width: number)` / `clearTextStroke()` (records
  `{strokeColor, strokeWidth}`).
- **DOM:** `-webkit-text-stroke: {width}px {color}` on the input/box.
- **Bake (operator path):** render mode `2` (fill+stroke) via `Tr`, stroke color `RG`, line width `w`.
- **UI (popover):** color input + width number (0–3pt; 0 clears).

### 2. Character spacing (Tc)
- **Service:** `setCharSpacing(pt: number)` (clamp −5..20, NaN-safe `floatOr`).
- **DOM:** `letter-spacing: {pt}px`.
- **Bake:** `Tc {pt}` operator.
- **UI (popover):** number/slider.

### 3. Horizontal scale (Tz)
- **Service:** `setHorizontalScale(pct: number)` (clamp 50..200, NaN-safe).
- **DOM:** `transform: scaleX({pct/100})`, `transform-origin` matching text align.
- **Bake:** `Tz {pct}` operator.
- **UI (popover):** number/slider (%).

### 4. Justify
- **Model:** `align: 'justify'`.
- **Service:** `setAlign` already takes the value; the discrete inline buttons add **J**.
- **DOM:** `text-align: justify`.
- **Bake:** multiline only — distribute extra space across word gaps via `Tw` (word spacing) per
  line, EXCEPT the last line; single-line justify is a no-op (left-aligned). LTR/WinAnsi.
- **UI (inline):** **J** button next to L/C/R; active gets `btn-active-fmt`.

### 5. Sub / superscript (whole-box)
- **Model:** `baselineShift: 'super' | 'sub'`.
- **Service:** `setBaselineShift(mode: 'super'|'sub'|null)`.
- **DOM:** font-size × 0.65 + vertical offset (up for super, down for sub).
- **Bake:** `Ts {±fontSize*0.33}` baseline shift + draw at 0.65× size.
- **UI (popover):** two toggle buttons (x² / x₂); mutually exclusive; re-click clears.

## The Operator-Based Bake (core component)
`renderText` decides per element:
- If **no** advanced attr is set OR the element is rotated → existing `page.drawText` path
  (BYTE-IDENTICAL; rotated elements ignore advanced attrs — documented ceiling, consistent with
  the existing `!elemRot` decoration gating).
- Else → `_drawStyledTextOps(page, te, font, anchor, helpers)` emits one `BT … ET` block per line
  via `page.pushOperators`: `Tf size`, `Tc charSpacing`, `Tz horizontalScale`, `Ts baselineShift`,
  fill `rg`, render mode `Tr` (2 when stroked), `RG`+`w` for stroke, `Td` per line (using the same
  alignment x-offset + `lineHeight` math as `drawText`), `Tj` with the WinAnsi-encoded line. Opacity
  via the existing `ExtGState`/`opacity` mechanism already used by `renderComment`/`drawText`.
- Decorations (underline/strike) and bg rect remain `drawLine`/`drawRectangle`, unchanged and still
  `!elemRot`-gated.

Font: the element's StandardFont (Helvetica family by `fontFamily`/`bold`/`italic`) is embedded/
registered exactly as today; the operator path references it by resource name (the `arabicOverlay`
pattern). The raster export path (`exportPipeline.ts`, redaction pages + thumbnails) honors the new
attrs on a best-effort basis (code-reviewed, like the Slice-1 raster note) — the vector bake is the
pixel-guarded one.

## Components & Boundaries
- `TextElement` — +4 fields, `align` union widened; `toJSON`/`applyStyles`/`_applyInputFormatting`.
- `elementFactory.fromJSON` — rehydrate the new fields.
- `FormattingService` — `setTextStroke`/`clearTextStroke`/`setCharSpacing`/`setHorizontalScale`/
  `setBaselineShift`; `clearFormatting` resets them; justify via `setAlign`.
- `pdfElementRenderer.renderText` + new `_drawStyledTextOps` — the operator bake.
- `exportPipeline.ts` — raster path honors the new attrs (code-reviewed).
- `index.html` — inline **J** button; popover rows (stroke color+width, Tc, Tz, x²/x₂).
- `textOptionsPopover.ts` / `formattingBinder.ts` / `pdfTurboApp.ts` delegators — wire controls.
- `uiController.updateFormattingToolbar` — sync **J** + popover active states.
- `locales/{en,fr,ar}.json` — new `formatting.*` keys (ar [Unverified]).
- **No feature flag** — additive improvements to the always-on toolbar (same rationale as Slice 1).

## Error Handling
- All service methods early-return on non-text selection (no throw).
- Numeric inputs clamped + NaN-safe (`floatOr`/`intOr`, never `parseFloat(...) || x`).
- Operator path WinAnsi-encodes text (StandardFonts encode CP1252); non-WinAnsi chars already handled
  by the existing draw path's font (Arabic uses the separate overlay; out of scope here).

## Testing
- **jsdom unit:** one test per new `FormattingService` method (mutation + command recorded +
  early-return guard); `clearFormatting` resets the new fields; `setAlign('justify')`.
- **Real-Chrome bake guard** (`tests/browser/*.browser.test.ts`): export a text element with stroke +
  char-spacing + horizontal-scale + super/subscript → assert the rendered content stream contains the
  `Tr`/`Tc`/`Tz`/`Ts` operators (and/or pixel evidence: visible outline, wider tracking). Multiline
  justify distributes word spacing. **A guard that an element with NO advanced attrs still bakes via
  `drawText` (operator path NOT taken) — byte-identical regression protection.**
- **Locale guard:** new `formatting.*` keys present in en/fr/ar (hook enforces parity).

## Risks / Mitigations
- **Operator bake parity** (the main risk): the new path must reproduce drawText's color, opacity,
  alignment, multiline, and font selection. Mitigation: reuse the `arabicOverlay` operator pattern;
  keep `drawText` as the default so only advanced-attr elements take the new path; the byte-identical
  regression test guards the fallback.
- **Rotated elements:** advanced attrs ignored under rotation (fall back to `drawText`) — documented
  ceiling, consistent with existing decoration gating.
- **Raster path:** new attrs honored best-effort (code-reviewed, not pixel-guarded) — same posture as
  the Slice-1 raster note.

## Out of Scope → Backlog (after Slice 2)
Per-run/multi-run rich text · find&replace on overlay text · links · bullet/numbered lists ·
Tc/Tz/stroke on Arabic overlay · RTL direction-aware controls · true-edit of these attributes.
