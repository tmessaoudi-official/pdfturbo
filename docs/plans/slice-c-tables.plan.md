# Slice C #3 — DOCX Table Editing Plan

## Decisions Log
- [2026-06-20] AGREED: Scope target = FULL structural table editing (cell text + add/remove rows + add/remove columns + cell merge/split).
- [2026-06-20] AGREED: Delivery = incremental shippable sub-slices — 3a cell-text → 3b rows → 3c columns → 3d merge/split. Each its own spec/plan/TDD/commit. Brainstorm 3a first.
- [2026-06-20] AGREED: Table model = adopt `prosemirror-tables@1.8.5` (MIT, official, 0 vulns, deps already in tree). Licensing reviewed: MIT = sellable + code stays the author's; only duty is THIRD-PARTY-NOTICES.md attribution (contrast AGPL/SuperDoc, previously rejected). Hand-roll rejected (reimplements solved cell-selection/structural-ops).
- [2026-06-20] AGREED: 3a fidelity = MAXIMAL (user chose options 1+2+3): cell text + run formatting (bold/italic/underline/font/size) editable, PLUS cell paragraph props (headings/lists inside cells), PLUS nested-table editing. Table structure/grid/borders/widths/shading/styles still preserved verbatim through the in-place save.
- [2026-06-20] AGREED (resolves the prior flag): nested-table editing STAYS in 3a (NOT split to a 3a'). I challenged this on round-trip risk (prosemirror-tables nested support is a sharp edge; the in-place save is the riskiest path); user chose full ambition in the foundational slice. Mitigation moves into the plan: nested-table round-trip gets its own dedicated TDD task + a real-Chrome guard before 3a is declared shippable.
- [2026-06-20] AGREED (decision 1 — model shape): `DocModel` extends from flat `paragraphs: DocParagraph[]` to an ordered `blocks: (DocParagraph | DocTable)[]`, keeping a derived `paragraphs` view so existing consumers (`docxToPdf.ts`, find/replace, PDF export) don't break. `DocTable` = `{ rows: DocRow[] }`, `DocRow = { cells: DocCell[] }`, `DocCell = { blocks: (DocParagraph | DocTable)[] }` (recursive → nested tables).
- [2026-06-20] AGREED (decision 2 — in-place save): position-addressed cell-paragraph writer extends `applyParagraphRuns` to walk `w:tbl > w:tr > w:tc > w:p` and rewrite each cell paragraph's runs in place; `w:tblPr`/`w:tblGrid`/`w:tcPr` (grid/borders/widths/shading/styles) untouched. No docx-writer rebuild (cardinal rule, one level deeper).
- [2026-06-20] AGREED (decision 3 — wiring): `tableEditing()` plugin + prosemirror-tables node specs merged into `docxSchema`; `docModelToDoc`/`docToDocModel` emit/read table nodes; gated by existing `VITE_FEATURE_DOCX_EDIT` (no new flag).

## Brainstorm status — 3a design CLOSED (2026-06-20)
All three open decisions resolved (see Decisions Log above): (1) dual-field model `blocks` +
populated top-level `paragraphs`; (2) table-anchored recursive in-place reconciler `applyBlocks`;
(3) prosemirror-tables node specs + `tableEditing()` (selection/nav only). Spec approved by user.

## Formal Plan
- **Design spec**: `docs/superpowers/specs/2026-06-20-docx-tables-3a-design.md` (committed e0a7444, refined fae5112)
- **Implementation plan**: `docs/superpowers/plans/2026-06-20-docx-tables-3a.md` — 11 TDD tasks (T0 dep → T1 model → T2 parse → T3 applyBlocks → T4 cell round-trip → T5 nested → T6 schema → T7 mappers → T8 wiring → T9 browser guard → T10 docs)
- **Key design crux**: in-place save uses a table-anchored, recursive segment reconciler (naive index-zip corrupts table position on top-level paragraph insert). `applyParagraphRuns` becomes a thin wrapper over `applyBlocks` → existing tests stay byte-stable.

## Status
3a: DONE — committed T0–T9b (92a724b through 513fad1). Recursive `DocTable`/`DocCell` model, in-place `applyBlocks` reconciler (cell text editable + formatting + nested tables), `prosemirror-tables@1.8.5` schema integration + `tableEditing()` (structure read-only), find/replace reaches cells. Guards: docModelTables / docxTablesMapping / docx-tables browser. Next: 3b (rows — add/delete).

## Status — prior
3a: spec + plan DONE, awaiting execution-mode choice. Next sub-slices after 3a ships: 3b rows → 3c columns → 3d merge/split.

## Decision (during execution, 2026-06-20)
- AGREED: Putting tables in the PM doc (T7) made C#2 find/replace operate on table CELL text too — out of the 3a spec's stated scope but a free, desirable feature (position mapping is per-textblock, identical to paragraphs). User chose to ACCEPT it: update the stale find/replace browser-test assertion, add a guard that find/replace finds+replaces INSIDE a cell, and update the 3a spec's "find/replace cells out of scope" line. The C#2 plan's "table cells out of scope" ceiling is now LIFTED for the DOCX editor.
