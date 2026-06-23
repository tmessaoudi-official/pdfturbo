# Option 3 — feature backlog / ceilings (2026-06-23)

## Decisions Log
- [2026-06-23] AGREED: after the P3 backlog (DONE, `a2255f6..561f540`), do **Option 3 — feature work**.
- [2026-06-23] User: "All of them" + asked for recommended order. AGREED order (value-first,
  risk-ascending, dependency-aware):
  1. **PDF overlay find & replace** — reuses the warm DOCX findReplace core; high value, low risk.
  2. **DOCX table editing (3b–3d)** — add/del row+col, merge/split; builds on 3a; medium risk
     (stresses the in-place OPC reconcile cardinal rule).
  3. **Arabic-RTL deepening** — mixed LTR+RTL single-line bidi + ligature reorder; unblocks the
     gated RTL-direction-aware toolbar controls; hard (partly a ceiling).
  4. **true-edit F10–F16 + F3 byte-splice** — edge-case hardening; lowest user-visible value,
     lowest regression risk; do last when the feature surface above is settled.
- One feature per commit (or per slice), TDD, gate after each, push MANUAL. NO Co-Authored-By.
- [2026-06-23] DECISION (user): after Feature 1 shipped, **CHECKPOINT** — pause the session at this
  clean boundary; Features 2–4 resume in a fresh window. State saved (this plan + handoff + memory).
  Bypass sentinel left ARMED for the next session's autonomous continuation (remove when the whole
  feature sequence is truly done).

## Feature 1 — PDF overlay find & replace ✅ DONE (commit pending)
Shipped: pure `overlayReplace.applyReplacement`, `MatchResult.elementId` tagging, `FindBarController`
`replaceCurrent`/`replaceAll`, app `replaceOverlayText` (TextEditCmd/MacroCmd, undoable), find-bar UI
(`#replaceInput`/`#replaceBtn`/`#replaceAllBtn`) + i18n en/fr/ar (ar [Unverified]). Source-text matches
stay find-only (hint). Gate: tsc/oxlint clean, jsdom 1994+2/173. Visual+undo confirmed in real Chrome
(`qa-shots/f1-find-replace/` — "hello world hello"→"HI world HI", undo restores, 0 console errors).


**Key finding (Phase 2):** the FIND side already exists — `SearchManager.run()` matches overlay
`TextElement` + `CommentElement` text on every page (searchManager.ts:86–100). The new work is
**REPLACE**, scoped to OVERLAY elements only (source-PDF-text matches stay find-only — editing those
is the separate true-edit tool; Replace skips them with a hint).

**Plan (Phase 4):**
1. Pure `src/core/overlayReplace.ts` `applyReplacement(text, query, replacement, {caseSensitive, regex})`
   → new text with ALL occurrences replaced (string or regex with $1; reuses the `_isSafeRegex` ReDoS guard).
2. `MatchResult` gains optional `elementId?: number` (set for overlay matches in `searchManager.run`,
   absent for source-text matches → those are not replaceable).
3. `FindBarController.replaceCurrent()` / `replaceAll()`:
   - current: if the active match is an overlay element, replace all occurrences in THAT element,
     then re-run search + advance.
   - all: replace across ALL matched overlay elements in ONE MacroCmd; re-run search.
   - delegate execution to a new `ctx.replaceOverlayText(edits)` on the app (owns historyManager)
     → TextEditCmd / MacroCmd (undoable) + autosave + re-render.
   - source-text-only / no overlay matches → toast hint, no-op.
4. UI: `#replaceInput` + `#replaceBtn` + `#replaceAllBtn` in the find bar (index.html), i18n en/fr/ar.
5. Tests: `overlayReplace` (pure), `searchManager` (elementId), `findBarController` (replace/undo/source-skip)
   jsdom + a real-Chrome browser guard. One commit for Feature 1.

## Feature 2 — DOCX table editing (3b–3d)
### Slice 3b — add/del row & column ✅ DONE (commit pending)
- `docxToolbar.ts`: 4 buttons (addRowAfter/deleteRow/addColumnAfter/deleteColumn) via prosemirror-tables;
  disabled outside a table (`isInTable`).
- `docModel.ts` `writeTable`: in-place row & cell COUNT reconcile (clone last `w:tr`/`w:tc`, trim tail,
  `syncTableGrid` for `w:gridCol`); **no-op → byte-identical for non-structural edits**. Cardinal rule kept.
- REFUSE gate `tableHasMerges` (gridSpan/vMerge) → 3a text-only fallback (structure verbatim). The
  merged-table restructure is **3c/3d**.
- i18n docxToolbar.{addRow,deleteRow,addColumn,deleteColumn} (ar [Unverified]).
- Guards: docModelTables (add/del row+col, grid sync, merged refusal, byte-identical), docxToolbar (4 acts),
  docx-tables.browser (add-row via button → save → reopen → 3 rows; disabled outside table).
- Visual: `qa-shots/f2-table-3b/` (before 2 rows / after 3 rows "Bob"; buttons enable inside table; 0 console errs).
### Slice 3c/3d — merge/split — queued
- Needs `DocCell.colspan?/rowspan?` + parse/emit `w:gridSpan` (horizontal) & `w:vMerge` (restart/continue,
  vertical) + PM table_cell colspan/rowspan round-trip. Highest cardinal-rule risk → its own commit.

## Feature 3 — Arabic-RTL deepening — queued
## Feature 4 — true-edit F10–F16 + F3 — queued
