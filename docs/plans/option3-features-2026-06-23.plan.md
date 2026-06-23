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
- [2026-06-23] Slice 3b (row/col add+del) shipped `c08d31c`. DECISION (user): "Option 2 and 3" →
  continue to **Slice 3c/3d (merge/split) now**, THEN **Feature 3 (Arabic-RTL)**. Keep going in order.
- [2026-06-23] Slice 3c/3d shipped `db24f01` → **Feature 2 (DOCX table editing) FULLY DONE** (3b+3c/3d).
  DECISION (user): **CHECKPOINT** — start Feature 3 (Arabic-RTL) in a FRESH window (hard/partly-ceiling,
  heavy context this session). Bypass sentinel left ARMED. 2 commits unpushed (`c08d31c`,`db24f01`); push MANUAL.
- [2026-06-23] DESIGN (3c/3d): model the **PM shape** — `DocCell.colspan?/rowspan?` on the surviving
  cell, covered grid positions ABSENT (matches prosemirror-tables AND docToDocModel). `parseTable` reads
  `w:gridSpan`→colspan and resolves `w:vMerge restart`+continuation runs→rowspan (dropping continuation
  placeholder cells). `writeTable` for a merged table reconstructs each row's `w:tc` sequence from the
  model via a running grid map — places `w:gridSpan`/`w:vMerge restart` on spanning cells, fabricates
  `<w:vMerge/>` continuation placeholders — while PRESERVING each surviving cell's `w:tcPr`+content
  (matched by grid position). Scoped table-grid surgery, NOT a docx-writer rebuild (cardinal rule).

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
### Slice 3c/3d — merge/split ✅ DONE (commit pending)
- `DocCell.colspan?/rowspan?` (PM shape); `parseTable` reads gridSpan→colspan + resolves vMerge restart/continue
  run→rowspan (drops continuation placeholders). PM bridge passes colspan/rowspan through table_cell attrs.
- Toolbar `mergeCells`/`splitCell` buttons (disabled-state = command's own applicability probe).
- `writeTable` 3 paths: simple→3b; merged-unchanged→`reconcileMergedContent` (verbatim structure);
  merged-changed (gridSignature diverges)→`rebuildMergedTable` (emits gridSpan/vMerge + fabricates `<w:vMerge/>`
  continuations; content via reconcileContainer; cell-box tcPr reset = ceiling). Cardinal rule kept.
- Supersedes the 3b merged-REFUSE at the save layer; toolbar still disables row/col on merged tables (v1).
- i18n docxToolbar.{mergeCells,splitCell} (ar [Unverified]).
- Guards: docModelTables (parse+emit+split+unchanged-verbatim+add-row-on-merged), docxTablesMapping (colspan/rowspan
  round-trip), docxToolbar (merge/split via CellSelection + probes), docx-tables.browser (merge→save→reopen).
- Visual: `qa-shots/f2-merge-3cd/` (2 header cells → 1 colspan-2 cell; Split enabled after; 0 console errs).

## Feature 3 — Arabic-RTL deepening — Slice 1 DONE; slices 2/3 queued
- [2026-06-23] **Slice 1 (char-level bidi engine) SHIPPED `11a3253`** (UNPUSHED, push MANUAL). Spec
  `docs/superpowers/specs/2026-06-23-arabic-rtl-bidi-engine-design.md`; plan
  `docs/superpowers/plans/2026-06-23-arabic-rtl-bidi-engine.md`. `src/utils/bidi.ts` (bidi-js@1.0.3 MIT,
  promoted transitive→prod): `logicalToVisual` / `visualToLogical` (bounded inverse) / `visualRuns` /
  `logicalItemOrder`. Wired ALL 4 surfaces: overlay (`drawBidiLine`→visualRuns; dead segmentBidiRuns/
  baseIsRtl removed), copy (`reconstructLogicalText`→span-level logicalItemOrder), search
  (`buildLogicalLines`→item-level, token map preserved), DOCX (`reverseRtlText`→visualToLogical for
  mixed-script words only). **Plan refinements (TDD-discovered):** copy/search use ITEM-level reorder
  (not char-level) so multi-char pdf.js tokens aren't scrambled + search token map stays valid; DOCX
  guarded to mixed-script words to preserve reverseRtlText contract tests; overlay browser guard EXTENDS
  the existing `arabic-overlay.browser.test.ts` (DRY) instead of a new file. Gate GREEN: tsc · oxlint ·
  jsdom **2026+2/173** · real-Chrome overlay 4/4 · npm audit 0. Eyes-on: live in-browser engine eval
  (all transforms + round-trips correct; `qa-shots/f3-bidi/`). **Ceiling:** bracket display-mirror inside
  the overlay (fontkit draws logical glyph); tashkeel GPOS; perfect visual→logical inversion impossible.
- Next: **Slice 2 (RTL-aware toolbar controls)** then **Slice 3 (ligature/tashkeel — evaluate-then-defer)**.
- [2026-06-23] DECISION (user): F3 is a cluster; sequence = **(1) char-level bidi engine → (2) RTL-aware
  toolbar controls → (3) ligature/tashkeel (evaluate-then-likely-defer)**. Each is its OWN spec→plan→impl
  cycle. Start with #1 NOW. Rationale: the SAME char-level-bidi ceiling is documented in 4 surfaces
  (copy `rtlClipboard.ts`, search `textSearchHandler.ts`, DOCX export `flowDoc.ts`, overlay export
  `arabicOverlay.ts`); one shared utility retires all four. `bidi-js@1.0.3` (MIT, full UAX#9) is already
  vendored (transitive via jsdom) → adopt, don't hand-roll; promote to a direct prod dependency.
- Spec (slice 1): `docs/superpowers/specs/2026-06-23-arabic-rtl-bidi-engine-design.md` (brainstorming WIP).
## Feature 3 Slice 2 — RTL-aware toolbar controls — IN PROGRESS (brainstorming)
- [2026-06-23] DECISION (user): after Slice 1 shipped, proceed to **Slice 2 (RTL-aware toolbar)** now.
  Own brainstorm→spec→plan→build cycle. Goal: right-align default + RTL direction toggle when editing
  Arabic overlay text. Builds on the Slice-1 bidi engine.
- [2026-06-23] FINDING: export bake ALREADY auto-RTLs Arabic (`renderText`→`drawArabicLine`); the gap is
  the EDITOR (input has no `dir`) + no explicit control. DECISION (user): **Full scope** — add
  `TextElement.direction?: 'auto'|'rtl'|'ltr'` (default auto) + a toolbar RTL toggle; applies to editor
  input `dir` + RTL-defaults-right-align; **export stays content-auto-detected** (no override — declined the
  risky force-RTL-on-Latin path).
## Feature 3 Slice 3 — queued (ligature/tashkeel evaluate-defer)
## Feature 4 — true-edit F10–F16 + F3 — queued
