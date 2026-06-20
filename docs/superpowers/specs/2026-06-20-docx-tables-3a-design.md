# DOCX Table Editing — Slice C #3a (cell content) Design

**Date:** 2026-06-20
**Status:** Design — pending user review
**Feature flag:** `VITE_FEATURE_DOCX_EDIT` (existing; no new flag)
**Dependency:** `prosemirror-tables@1.8.5` (MIT; transitive deps already in tree; 0 vulns)

## Goal

Make the cells of a Word table editable inside the existing DOCX editor — typed
text, per-run formatting, cell paragraph props, and **nested** tables — while the
table's *structure* (grid, borders, widths, shading, styles) round-trips verbatim
through the in-place OPC save. This is the foundational sub-slice of full structural
table editing; rows/columns/merge-split are deferred to 3b/3c/3d.

## Scope

### In scope (3a)
- Edit **cell content**: each cell's paragraphs + per-run **bold / italic / underline /
  font family / font size**.
- Edit **cell paragraph props**: heading (1–3) and list (bullet/ordered) *inside* cells.
- **Nested tables** (`w:tbl` inside a `w:tc`): editable to the same fidelity, recursively.
- **Round-trip preservation**: `w:tblPr`, `w:tblGrid`, `w:trPr`, `w:tcPr` (grid, borders,
  cell/column widths, shading, vertical-merge markers, table/cell styles) pass through
  the in-place save byte-stable — they are never modeled, never rewritten.

### Out of scope (3a) — deferred to later sub-slices
- **Structural edits** — add/remove **row** (3b), add/remove **column** (3c),
  **merge/split** cells (3d). In 3a the table grid is **read-only**: prosemirror-tables'
  structural commands are NOT bound, and no toolbar/keymap exposes them.
- **Find/replace inside cells** — find/replace continues to search only top-level
  paragraphs (already the documented v1 ceiling in the find/replace plan). Searching cell
  text is a follow-up once tables are in the PM model long enough to validate.
- Column resize handles, cell background/border *editing* (only preservation), table
  insertion/deletion as a whole.

### Cell-content note (not structural)
Pressing Enter inside a cell **splits a cell paragraph** — this changes the cell's
*paragraph count*, not the table grid. It is a content edit and is handled by the
cell-paragraph append/remove-by-cloning logic (same mechanics as today's top-level
writer). It is explicitly allowed in 3a.

## Architecture

Three units extend the existing DOCX editor (`src/docx/*`). No new files are strictly
required, but the table node specs and the recursive save warrant their own module.

### 1. Model — `src/docx/docModel.ts` (extend)

Today the model is flat: `DocModel = { paragraphs: DocParagraph[] }`. Extend to an
ordered recursive block list (`blocks`) **and keep `paragraphs` as a populated
top-level field** for back-compat (lowest blast radius — see rationale below).

```ts
export type DocBlock = DocParagraph | DocTable;            // discriminated by `kind`
export interface DocParagraph { kind: 'paragraph'; runs: DocRun[]; heading?: 1|2|3; list?: {ordered:boolean; level:number}; }
export interface DocTable { kind: 'table'; rows: DocRow[]; }
export interface DocRow   { cells: DocCell[]; }
export interface DocCell  { blocks: DocBlock[]; }           // recursive → nested tables
export interface DocModel {
  blocks: DocBlock[];          // full ordered body content (paragraphs + tables)
  paragraphs: DocParagraph[];  // = blocks.filter(b => b.kind === 'paragraph') — top-level only, cells excluded
}
```

- **Discriminant**: add `kind: 'paragraph'` to `DocParagraph` so `DocBlock` is a clean
  discriminated union (avoids `'rows' in block` structural sniffing). The added `kind`
  is the only shape change to `DocParagraph`; existing code reading `.runs`/`.heading`/
  `.list` is unaffected.
- **`paragraphs` stays populated**: `parseDocModel` and `docToDocModel` both set
  `paragraphs = blocks.filter(b => b.kind === 'paragraph')`. Its meaning is *exactly today's*
  — top-level paragraphs, cells excluded. So every current consumer
  (`docxToPdf.ts:132`, `docxSpike.ts`, ~30 `tests/docx/*` assertions) keeps passing
  **untouched**; tables ride only in `blocks`, and the save switches to `applyBlocks`.
- Rationale: a `paragraphs` field that flattened cells in would silently change
  `docxToPdf.ts`/PDF-export output. Keeping it top-level-only preserves current behavior
  exactly, while `blocks` carries the new table data for the save and the editor.

#### Parse (`parseDocModel`)
- Walk `w:body` children in order. `w:p` → `DocParagraph` (existing logic, + `kind`).
  `w:tbl` → `DocTable` via a new recursive `parseTable(el)`:
  `w:tr` → `DocRow`; `w:tc` → `DocCell` whose `blocks` are parsed by recursing the same
  body-child walk over the cell's children (so a `w:tbl` inside a `w:tc` recurses).
- Numbering map (numId→format) is threaded into the recursion unchanged.

#### Save (`applyParagraphRuns` → generalized to `applyBlocks`)
- The current writer addresses **top-level `w:p` by index**. Generalize to address
  **body-level block elements** (`w:p` *and* `w:tbl`) by position: the i-th body block
  element corresponds to `blocks[i]`.
  - `w:p` block → existing `setRuns` (rebuild runs from `DocParagraph`, clone first run's
    `w:rPr` as base, apply heading/list props when `ids` present).
  - `w:tbl` block → `writeTable(tblEl, docTable)`: zip `w:tr`↔`rows` and `w:tc`↔`cells`
    **by position** (structure is read-only in 3a, so counts match), then for each cell zip
    its body-level block children ↔ `cell.blocks`, recursing (`w:p`→setRuns, `w:tbl`→writeTable).
  - **Cell paragraph count change** (Enter split / deletion): inside a cell, apply the same
    append-by-cloning-last / remove-extra logic the top-level writer uses — scoped to that
    `w:tc`. The cell's grid props (`w:tcPr`) are never touched.
- **Never touched**: `w:tblPr`, `w:tblGrid`, `w:trPr`, `w:tcPr`, and any non-`w:p`/`w:tbl`
  child of a cell (bookmarks, etc.) → verbatim pass-through, exactly as today.
- Back-compat: `applyParagraphRuns(xml, paragraphs, ids)` is retained as a thin wrapper that
  builds a paragraph-only `blocks` list and calls `applyBlocks`, so #1c callers are byte-stable.

### 2. Schema + mappers — `src/docx/docxSchema.ts`, `src/docx/docxProseMirror.ts` (extend)

- Merge prosemirror-tables node specs (`table`, `table_row`, `table_cell`,
  `table_header`) into `docxSchema` via `tableNodes({ tableGroup: 'block', cellContent:
  'block+', cellAttributes: {} })`. Cell content group is `block+` so cells hold
  paragraphs, headings, lists, and nested tables.
- `docModelToDoc`: emit a `table` node for a `DocTable` block (rows → `table_row`, cells →
  `table_cell` whose content is the recursive block emit). Top-level paragraph/list blocks
  use the existing flat→nested logic, now driven off `model.blocks` instead of
  `model.paragraphs`.
- `docToDocModel`: read `table` nodes back into `DocTable`; recurse cell content through the
  existing `emitBlock` (extended to recognize `table`). Produces `DocModel.blocks`.
- Add `tableEditing()` to the plugin list (cell selection, arrow-key nav, shift-click range).
  Do **not** add `columnResizing()` (resize is out of scope) and do **not** bind
  addRow/addColumn/mergeCells/splitCell (structural — 3b–3d).

### 3. Styling — `src/styles/*` (extend)

- Minimal cell CSS: `.ProseMirror table { border-collapse: collapse }`,
  `.ProseMirror td, .ProseMirror th { border: 1px solid var(--border); padding: …;
  vertical-align: top }`, plus the prosemirror-tables `.selectedCell` overlay. Editor-only
  presentation; does NOT affect the saved `.docx` (cell borders come from `w:tcPr`, preserved).

## Data flow

```
.docx bytes
  → openOpc → document.xml
  → parseDocModel  ⇒ DocModel.blocks (paragraphs + tables, recursive)
  → docModelToDoc  ⇒ PM doc (paragraph/heading/list + table/row/cell nodes)
  → [user edits cell text/runs/props/nested tables]
  → docToDocModel  ⇒ DocModel.blocks
  → applyBlocks(originalXml, blocks, ids)   // in-place; grid/styles verbatim
  → setDocumentXml → packOpc ⇒ edited .docx bytes
```

PDF export (`getModel()` → `docxToPdf.ts`): **unchanged in 3a**. It walks `model.paragraphs`
(top-level only) exactly as today, so table cell text is NOT rendered to the exported PDF —
the same behavior as before tables were editable. Rendering cell text (and eventually the
grid) into the PDF is a clean follow-up that reads `model.blocks`. This keeps 3a's PDF-export
path byte-identical and zero-churn.

## Error handling
- `parseTable` on a malformed table (missing `w:tr`/`w:tc`) → skip the malformed node,
  leave it in the pass-through XML untouched (never throw; never lose the table).
- `applyBlocks` mismatch (model block count ≠ body block-element count, which should not
  happen in 3a since structure is read-only) → fall back to the existing top-level-only
  write for paragraph blocks and leave tables verbatim, rather than corrupt the document.
  Logged via the project's error reporter.
- Save remains synchronous and total: any DOMParser error returns the original XML
  unchanged (existing guarantee preserved).

## Testing

### jsdom (`npm run test`)
- `parseDocModel`: table → `DocTable` with correct row/cell/block nesting; nested table
  inside a cell; cell run formatting (bold/italic/underline/font/size); cell heading/list.
- `applyBlocks`: round-trip a doc with a table — edit cell text → assert `w:tblPr`/
  `w:tblGrid`/`w:tcPr` byte-stable, edited cell run text changed, sibling cells untouched.
- **Nested-table round-trip** (dedicated task): edit text in a nested cell → both the outer
  and inner `w:tbl` structure preserved, only the target cell paragraph rewritten.
- Cell paragraph split/merge: add a paragraph to a cell (Enter) → cell gains a `w:p`; delete
  → cell loses it; `w:tcPr` untouched.
- `docModelToDoc`/`docToDocModel`: PM table node ↔ `DocTable` symmetry incl. nesting.
- Back-compat: `applyParagraphRuns` wrapper byte-identical to pre-3a on a table-free doc.
- Top-level `paragraphs` field: equals `blocks.filter(kind==='paragraph')`; on a doc with a
  table, cell paragraphs are NOT in `model.paragraphs` (preserves today's meaning).

### Real Chrome (`npm run test:browser`)
- `docx-tables.browser.test.ts`: open a real .docx with a table (and a nested table) →
  `mountDocxEditor` → type into a cell and a nested cell, toggle bold in a cell → save →
  reopen → assert the typed text + bold survive AND the table grid/borders survive
  (the cardinal in-place rule, validated end-to-end where jsdom can't lay out tables).
- Structure read-only: assert no add-row/column affordance is wired (the structural
  commands are absent from the toolbar/keymap).

## Global Constraints (copied to the plan verbatim)
- **No new feature flag** — rides `VITE_FEATURE_DOCX_EDIT`.
- **One new dependency**: `prosemirror-tables@1.8.5` (MIT). Add a `THIRD-PARTY-NOTICES.md`
  entry at implementation time. No other new deps.
- **Cardinal rule**: edit `word/document.xml` in place + re-zip; NEVER rebuild via the
  `docx` writer (drops unmodeled parts).
- **Before commit**: `npm run type-check && npm run lint && npm run test` (+ `test:browser`
  for the editor change) — matches CI.
- **Push is manual** (the user pushes). No Co-Authored-By trailers.
- Linters: oxlint — no `any`/non-null `!`; `_`-prefix unused/private; private methods `_`.

## Resolved decisions (were open, now locked)
- **Model shape** — dual field: `blocks` (full ordered content) + populated top-level
  `paragraphs` (cells excluded). Lowest blast radius; existing consumers untouched.
- **PDF export of table cells** — DEFERRED to a follow-up. 3a leaves `docxToPdf.ts`
  byte-identical (top-level paragraphs only). Cell-text-in-PDF reads `blocks` later.
