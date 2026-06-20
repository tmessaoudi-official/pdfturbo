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

## Brainstorm status (PAUSED for compaction 2026-06-20)
3a design decisions still OPEN (resume here):
1. How tables enter `DocModel` — it is currently FLAT (`paragraphs: DocParagraph[]`). Cells must round-trip, so the model needs an ordered block list (paragraph | table). BLAST RADIUS: every consumer of `model.paragraphs` (PDF export `docxToPdf.ts`, DOCX→PDF, find/replace via the PM doc not the model, `applyParagraphRuns` save). Likely recommend: extend to `blocks: (DocParagraph|DocTable)[]` while keeping a `paragraphs` view, or thread tables separately.
2. In-place save cell-addressing — `applyParagraphRuns(originalXml, …)` rewrites top-level body `w:p`. Tables need each cell's `w:p` runs written back into the right `w:tbl>w:tr>w:tc` by position, WITHOUT rebuilding via the docx writer (cardinal rule). Design the position-addressed cell-paragraph writer.
3. Editor wiring — `tableEditing()` plugin + `columnResizing()` (optional) + table node specs merged into `docxSchema`; `docModelToDoc`/`docToDocModel` emit/read table nodes; CSS for cells; gated by `VITE_FEATURE_DOCX_EDIT` (no new flag).
Then: write spec (`docs/superpowers/specs/2026-06-20-docx-tables-3a-*.md`) → user review → writing-plans → TDD.

## Formal Plan
<!-- written at Phase 4 approval, per sub-slice -->
