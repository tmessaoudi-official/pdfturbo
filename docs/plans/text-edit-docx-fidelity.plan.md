# Text-Edit & DOCX Fidelity Fix Plan (2026-06-12)

## Decisions Log
- [2026-06-12] AGREED: Task = Large — investigate both systems, produce fix plan, then implement
- [2026-06-12] DECISION: 9 confirmed root causes across 2 systems (see diagnosis below)
- [2026-06-12] DECISION: P1 fixes = in-stream replacement (font/color/size), PostScript name extraction, color tracking, blankAllNearby, overlay improvements; P2a = getOperatorList color export; P3 (shapes/images) = roadmap
- [2026-06-12] DECISION: Autonomous gates (_AUTONOMOUS_3C=0, full gates active); 3C converged at 8/8

## Diagnosis Summary

### True Text Editing (RC-T1 through RC-T5)
- RC-T1: replaceTextAt always embeds Helvetica; fontKey detected but unused
- RC-T2: locateTextOps never tracks rg/g/k/sc color ops; TextOpInfo has no fillColor
- RC-T3a: findTarget returns single nearest op; shadow/outline text (multiple overlapping ops) not blanked
- RC-T3b: overlay fallback RedactionElement bgColor sampled from single canvas pixel per corner
- RC-T4: inline input always styled as Helvetica regardless of original font
- RC-T5: size calculation correct for standard cases

### DOCX Export (RC-E1 through RC-E5)
- RC-E1: commonObjs.get() throws for lazy fonts → bold/italic detection always false
- RC-E2: getTextContent() has no color → all DOCX text is black
- RC-E3: fontFamily is CSS generic only (serif/sans-serif/monospace → TNR/Arial/Courier)
- RC-E4: shapes/images absent (Phase 2 roadmap)
- RC-E5: run merge key lacks PS font name → cross-font merges

## Formal Plan

### P1 — True text editing fidelity

**Step 1: extractPsName utility + color tracking in contentStreamEditor.ts**
- Add `fillColor?: string` (raw PDF color ops string, e.g. `"1 0 0 rg"`) to `TextOpInfo`
- Track `rg/RG, g/G, k/K, sc/SC, scn/SCN, cs/CS` in `locateTextOps` switch
- Add `extractPsName(internalId: string): string` — extracts PostScript name from
  `ABCDEF+PostScriptName` subset-tagged internal ids; falls back to `internalId`

**Step 2: In-stream text replacement in contentStreamEditor.ts**
- Add `replaceShowOpText(op, newText)`: replaces the string operand of Tj/TJ/'/'' in place
  - Eligible if: original operand is a literal string `(...)`, newText is ASCII-safe (chars 32-126)
  - For Tj: replace `(original)` → `(encodedNew)`
  - For TJ arrays: replace the first string element, drop kerning numbers
  - For hex strings or non-ASCII: return false (caller falls back to blank+redraw)
- Update `replaceTextAt`:
  - Try `replaceShowOpText` first → if OK: setPageContent (no redraw, no font change)
  - If not eligible: blank op, setPageContent, inject `fillColor` ops before drawText call,
    look up page Resource /FontKey → detect standard font family → use matching StandardFonts value
    instead of always Helvetica

**Step 3: Blank all nearby ops in contentStreamEditor.ts**
- Add `findAllNearby(ops, textOps, origin, primaryRadius, secondaryRadius)`:
  picks primary match (≤primaryRadius) then finds additional ops within secondaryRadius of primary
- Update `deleteTextAt` / `replaceTextAt` to use findAllNearby for the blank pass

**Step 4: Font family in textEditHandler.ts (inline input display)**
- After picking `best` item: use `extractPsName(best.fontName)` to get real PS name
- Use the PS name for `fontFamily` detection (same heuristics as overlay path's bold/italic)
- Set `input.style.font` to the detected family (e.g. `${fontPx}px "Times New Roman", serif`)

**Step 5: Overlay bgColor improvement in textEditHandler.ts**
- Replace single-pixel corner sampling with a 5×5 pixel grid at each corner
- Use the statistical mode (most frequent RGB value in the 20-sample grid) as bgColor
- Increase cover rect padding from 2px to 4px (top) / 2px (sides/bottom) to capture ascenders

### P2a — DOCX color extraction

**Step 6: PostScript name extraction + merge key in flowDoc.ts**
- Export `extractPsName` from contentStreamEditor.ts OR duplicate in flowDoc.ts (prefer export)
- In `reconstructPage`: use `extractPsName(it.fontName)` when `fonts[it.fontName].name` is
  still an opaque internal id (contains `g_d0_` pattern or lacks meaningful content)
- Add `psName` to run merge key: runs only merge when psName AND style match

**Step 7: Color per text item in pdfEditorApp.ts (_extractFlowDoc)**
- After `page.getTextContent()`, call `page.getOperatorList()` concurrently
- Walk OPS array tracking fill color state (OPS.setFillRGBColor, OPS.setFillGray,
  OPS.setFillColorN, OPS.setFillCMYKColor)
- Build Map<string, string> from `"${x.toFixed(1)},${y.toFixed(1)},${text}"` → hex color `RRGGBB`
- For each text item: look up color in the map; pass as `fontColor` to `FontInfoMap` entry
- If getOperatorList() throws (encrypted page): catch and continue without color

**Step 8: color field in FlowRun, FlowDoc types**
- Add `color?: string` to `FlowRun` (hex without #, e.g. `"FF0000"` for red)
- Populate in `reconstructPage` from the fontColor if available

**Step 9: DOCX writer outputs color**
- In `flowDocToDocxBase64`: add `color: r.color` to TextRun options (only when defined)
- Markdown and TXT writers: ignore color (plain text formats)

### Step 10: Tests (TDD — write failing tests first)
- contentStreamEditor.test.ts:
  - color tracking: stream with `1 0 0 rg (Red) Tj` → TextOpInfo.fillColor = '1 0 0 rg'
  - in-stream replacement: replaceTextAt on ASCII Tj preserves font reference in stream
  - blankAllNearby: two ops at (50,300) and (51,299) → both blanked after replaceTextAt
- flowDoc.test.ts:
  - extractPsName: `g_d0_ABCDEF+Arial-BoldMT` → `Arial-BoldMT`; `g_d0_f1` → `g_d0_f1`
  - merge key: two adjacent runs with different PS names stay separate
- flowDocWriters.test.ts:
  - DOCX output includes color when FlowRun.color is set; absent when undefined

## Acceptance Criteria
- True edit on a standard office PDF (Word/LibreOffice export): replacement text uses SAME font,
  size, and color as original (visual match, not just close approximation)
- No overlap after true edit: original text invisible, only replacement visible
- Inline input during editing: shows the correct font family (Times/Arial/Courier/Helvetica)
- DOCX export bold/italic: a PDF with Arial-BoldMT → bold runs in DOCX
- DOCX export color: colored PDF text → matching DOCX color (where detectable)
- All 410+ existing tests continue to pass; 15+ new tests covering the fixes
- type-check + lint + build green

## Rollback
All changes in existing files. Revert = git restore src/utils/contentStreamEditor.ts
  src/handlers/textEditHandler.ts src/core/pdfEditorApp.ts src/utils/flowDoc.ts
  src/utils/flowDocWriters.ts + corresponding test changes.
