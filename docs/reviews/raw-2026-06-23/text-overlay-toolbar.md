# QA — Text overlay + addText + rich-text toolbar (Slice 1 + Slice 2)

Date: 2026-06-23
Reviewer: skeptical senior pass
Files read: src/elements/textElement.ts, src/core/formattingService.ts, src/ui/textOptionsPopover.ts,
src/export/styledText.ts, src/utils/textCase.ts, src/utils/recentColors.ts,
src/export/pdfElementRenderer.ts (renderText), src/export/exportPipeline.ts (raster path),
src/utils/elementFactory.ts, src/ui/binders/formattingBinder.ts, src/ui/uiController.ts (updateFormattingToolbar),
src/core/pdfTurboApp.ts (selectElement / resetDocumentModel), src/main.ts (_renderColorSwatches),
locales/{en,fr,ar}.json.

## Summary

The 13 controls are well-structured: every mutation in `FormattingService` goes through a `MoveResizeCmd`
(undo is sound), all 13 fields round-trip through `toJSON` (conditional spread) and `elementFactory.fromJSON`
(typed `typeof === 'number'` / union guards), clamps are NaN-safe (`Number.isFinite`, never `parseFloat||x`),
and the format painter is disarmed on document load (`resetDocumentModel → cancelPainter`), so it cannot leak
across PDFs. The vector bake (`styledText.ts` + `renderText`) is the guarded primary path. Genuine defects are
in the **raster export path** (advanced attrs silently dropped, an inconsistency that is only partly documented),
a **localStorage crash** vector in recentColors, a **double-shrink** of sub/superscript in the editor preview,
and **missing UX feedback** for the format painter.

---

## Findings

### P1 — Corrupted `recentColors` localStorage crashes the color-swatch render at startup
- **File**: src/utils/recentColors.ts:19-26, consumed in src/main.ts:31
- **Category**: bug / data-safety
- **Evidence**: `read()` does `return raw ? (JSON.parse(raw) as string[]) : _mem;` with **no `Array.isArray`
  validation**. `_renderColorSwatches` then does `const colors = [...COLOR_PRESETS, ...getRecentColors()];`
  (main.ts:31). I verified: if `localStorage['pdfturbo.recentColors']` holds a JSON object (`{}`) or number
  (`42`) — non-iterable — the spread throws `TypeError: parsed is not iterable`. If it holds a JSON string
  (`"abc"`) it spreads into individual characters → garbage swatches with `style.background = 'a'` etc.
  The `try/catch` in `read()` only catches `JSON.parse` *syntax* errors, not the downstream spread, because
  the throw happens at the call site in main.ts, outside the try.
- **Impact**: a single malformed key (written by a prior version, another tab, an extension, or a future schema
  change) bricks the toolbar swatch row on every load. localStorage is shared/persistent, so the failure is
  sticky until the key is manually cleared.
- **Recommendation**: in `read()`, validate the shape:
  `const v = JSON.parse(raw); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : _mem;`

### P2 — Sub/superscript shrinks the editor preview font TWICE (visual mismatch vs bake)
- **File**: src/elements/textElement.ts:112-115
- **Category**: export-fidelity / ux
- **Evidence**: In `_applyInputFormatting`, line 87 already sets `input.style.fontSize = (this.fontSize * scale)`.
  Then lines 112-115, when `baselineShift` is set, **re-assign** `input.style.fontSize = (this.fontSize * 0.65 * scale)`
  AND set `verticalAlign`. So far so good — but the vector bake (`pdfElementRenderer.renderText:153`) uses
  `drawSize = subSup ? te.fontSize * 0.65 : te.fontSize` and a `rise` offset. The editor uses CSS
  `vertical-align: super|sub` which already raises the glyph; combined with the 0.65 shrink the *preview* matches
  the bake reasonably. **However the raster path (`exportPipeline.ts:330-337`) ignores `baselineShift` entirely**
  (`fontPx = Math.round(te.fontSize * SCALE)` — full size, no rise), so a sub/superscript text element on a
  redaction-bearing page bakes at full size and on-baseline. Editor preview ≠ vector bake ≠ raster bake for the
  same element. (Marked P2 because the raster path is only hit on redaction pages; see P1-grade raster finding
  below for the systemic version.)
- **Recommendation**: apply the same `0.65` shrink + rise offset in the raster text loop, or document the
  divergence explicitly in the same place the other raster ceilings are noted.

### P1 — Raster export path silently drops ALL Slice-2 advanced attrs and decorations
- **File**: src/export/exportPipeline.ts:316-339 (the `e.type === 'text'` canvas loop)
- **Category**: export-fidelity
- **Evidence**: The vector renderer (`renderText`) honors stroke/charSpacing/horizontalScale/baselineShift/justify
  (via `hasAdvancedText` → `drawStyledTextLine`) and underline/strikethrough (drawn lines). The raster path used
  for any page that contains a **redaction** re-implements text drawing from scratch and applies ONLY
  `opacity`, `backgroundColor`, `italic`, `bold`, `color`, `fontFamily`, and `lineHeight`. It does NOT apply:
  `strokeWidth` (no `ctx.strokeText`), `charSpacing` (no `ctx.letterSpacing`), `horizontalScale` (no x-scale
  transform), `baselineShift` (no shrink/rise), `align` (always draws at `te.x`, left-aligned — center/right/justify
  ignored), `underline`, or `strikethrough`. A user who adds a redaction to a page then exports gets text that
  looks materially different from the same text on a redaction-free page.
- **Note**: CLAUDE.md documents the raster path as "code-reviewed, NOT pixel-test-guarded" for lineHeight/opacity/
  bg, and "code-reviewed for these attrs, NOT pixel-guarded" for Slice-2 — but the code does not actually *apply*
  the Slice-2 attrs or alignment/decorations at all; it is not a fidelity gap, it is a no-op. The documentation
  implies they are handled. This is an **undocumented behavioral gap** (silent drop), not the documented "pixel
  fidelity uncertain" caveat.
- **Recommendation**: at minimum apply `align` offset (it already computes nothing — text always left-aligned on
  a redaction page is a clear regression), `ctx.letterSpacing` for charSpacing, and the sub/super shrink+rise;
  underline/strike are 2 `fillRect`s. If a true ceiling, state explicitly in the raster loop comment that these
  attrs are intentionally dropped and why.

### P2 — `align` (center/right/justify) is ignored in the raster text bake
- **File**: src/export/exportPipeline.ts:334-337
- **Category**: export-fidelity / bug
- **Evidence**: `ctx.fillText(line, Math.round(te.x * SCALE), …)` always anchors at the element's left x with the
  default `textAlign: 'left'`. A center- or right-aligned overlay text element renders left-aligned in the raster
  output. The vector path computes an `off` offset (renderText:187-188); the raster path has no equivalent. This
  is a subset of the P1 above but is the single most visible divergence (alignment is a Slice-1 control, not an
  exotic Slice-2 one).
- **Recommendation**: compute the same alignment offset from `ctx.measureText(line).width` and the box width, or
  set `ctx.textAlign` accordingly.

### P2 — No feedback (toast/aria) when the format painter is armed or pasted
- **File**: src/ui/textOptionsPopover.ts:54-58, src/core/pdfTurboApp.ts:825-829
- **Category**: ux / a11y
- **Evidence**: Clicking the format-painter button calls `copyTextStyle()` and toggles `btn-active-fmt` on the
  button — but the button lives **inside the "Text ⋮" popover**, which the user typically closes before clicking
  the next element to paste onto. There is no toast, no cursor change, and no status text telling the user
  "style copied — select a target". `grep` confirms zero toast keys for painter/clear/case (`sessionCleared`,
  `annotationsCleared` are the only adjacent ones). The paste (`selectElement → pasteTextStyle`) is also silent.
  A screen-reader user gets no `aria-live` announcement of either state.
- **Recommendation**: add a toast on arm ("Style copied — pick a target") and on paste, or move the armed-state
  indicator out of the popover; add `aria-pressed` on the painter button (it only gets a CSS class today).

### P2 — `clearFormatting` and case transforms give no confirmation; clear is a large silent mutation
- **File**: src/core/formattingService.ts:338-379
- **Category**: ux
- **Evidence**: `clearFormatting` resets 15 fields in one `MoveResizeCmd` (good — undoable) but with zero feedback.
  For a heavily styled element this is a large, surprising change with no toast. (Undo works, so not data-loss.)
- **Recommendation**: minor — a toast ("Formatting cleared") would close the loop; the existing undo is the safety net.

### P3 — Title-case lowercases the remainder of every token (loses intentional internal caps)
- **File**: src/utils/textCase.ts:25-32
- **Category**: bug (minor)
- **Evidence**: `tok[0].toUpperCase() + tok.slice(1).toLowerCase()` — "PDFturbo" → "Pdfturbo", "iPhone" → "Iphone",
  "RGB" → "Rgb". This is the conventional title-case definition, but it is lossy for acronyms/brand casing and is
  irreversible except via undo. Documented behavior ("capitalizes the first letter of each word") matches the code,
  so this is expected, not a defect — flagged only for awareness.
- **Recommendation**: none required; optionally offer a "capitalize first letter only" variant that doesn't
  lowercase the tail.

### P3 — Text background swatch is a standalone `<input type=color>`, not the shared palette
- **File**: src/ui/textOptionsPopover.ts:42-45 (`ui.textBgColor`)
- **Category**: ux (consistency)
- **Evidence**: The project convention (CLAUDE.md + memory `feedback_reuse_color_palette`) is "reuse the ONE color
  palette, never a lone picker". The text-background color in the popover is a lone `<input type=color>` with no
  preset/recent swatch row, unlike the main text color (`#colorSwatchRow`, main.ts:27-64). Minor inconsistency;
  the outline-stroke control already correctly reuses the fill color (per the Slice-2 correction).
- **Recommendation**: optionally wire `textBgColor` through `getRecentColors`/presets for consistency; low priority.

---

## Checked and OK (no finding)

- **Undo coverage**: every mutator (setAlign, setLineHeight, setTextOpacity, setTextBackground/clear,
  setTextStroke/clear, setCharSpacing, setHorizontalScale, setBaselineShift, transformCase, clearFormatting,
  copy/pasteTextStyle) records a `MoveResizeCmd` before `rebuildElementLayer` + `autosave`. No raw mutation
  bypasses history.
- **Round-trip**: `toJSON` (textElement.ts:133-145) conditionally spreads all 7 optional Slice-1/2 fields;
  `fromJSON` (elementFactory.ts:37-42) reads each with a `typeof==='number'` or union guard → legacy blobs and
  malformed values fall back to `undefined` cleanly. No SCHEMA_VERSION bump needed (all optional). Verified.
- **Clamps NaN-safe**: setLineHeight (1..3), setTextOpacity (0..1), setTextStroke (0..10, `Number.isFinite`),
  setCharSpacing (-5..20, `Number.isFinite`), setHorizontalScale (50..200, `Number.isFinite`). The popover's
  `floatOr`/`parseFloat` wrappers also default on NaN. No `parseFloat(...)||fallback` anti-pattern that would
  rewrite a legitimate 0.
- **Format-painter cross-document leak**: `resetDocumentModel` (pdfTurboApp.ts:265-268, called from documentLoader
  on every open/restore) invokes `cancelPainter()` → `_copiedTextStyle = null`. `pasteTextStyle` also self-clears
  on a non-text selection. No leak.
- **Justify Tw scaling**: `justifyWordSpacing` correctly divides by `Tz/100` per PDF §9.4.4 (styledText.ts:66-70),
  and only applies to non-last lines (renderText:181). Matches the cc349e1 fix.
- **i18n parity**: en/fr/ar `formatting.*` keys are identical (38 keys each, including justify/stroke/charSpacing/
  horizontalScale/baseline/superscript/subscript). Arabic values are flagged [Unverified] in CLAUDE.md (native
  review pending) — consistent with project state, not a new defect.
- **XSS**: no `innerHTML` with user/translation data in this domain. `row.innerHTML = ''` (main.ts:30) is a
  static clear. `input.value = this.text` and `ctx.fillText` are text-safe.
- **Toolbar disabled-state**: updateFormattingToolbar disables all 16 text controls when no text element is
  selected and reflects active states (bold/italic/underline/strike/align/super/sub) — guards against acting on
  the wrong element type (each service method also early-returns on non-text).
- **Rotated-element gating**: bg fill, underline/strike, and advanced attrs all gate on `!elemRot` (the numeric
  rotation signal, not the always-truthy `pdfRotVal`) — documented ceiling, correctly implemented.
