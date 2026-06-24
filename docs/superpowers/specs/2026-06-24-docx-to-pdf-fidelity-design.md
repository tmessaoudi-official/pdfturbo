# Feature 5 — DOCX→PDF fidelity: fonts + merged cells + images (design)

**Date:** 2026-06-24  **Status:** approved (autonomous-design; user chose FULL scope incl. images)
**Program:** feature-program-2026-06-24

## Goal

Three fidelity upgrades to `src/docx/docxToPdf.ts` (`docModelToPdfBytes`):
1. **Real font faces** — map `DocRun.fontFamily` → Times / Courier / Helvetica StandardFonts
   families (today everything renders Helvetica).
2. **Merged-cell tables** — honour the existing `DocCell.colspan`/`rowspan` (from the 3c/3d
   table work) in the PDF grid (today every cell is one equal column → merged tables misrender).
3. **Images** — render DOCX inline images (`word/media/*` via `w:drawing`→`r:embed`) in the PDF.

## Cardinal-rule safety (non-negotiable)

The DOCX editor's **in-place save** (`applyBlocks`/`buildRun` rewrites each model run as a text
`w:r`) is the project's highest-value invariant. Putting image data into the editable
`DocModel`/`DocRun` would route it through `buildRun` → corrupt the `w:drawing`. Therefore
**images are decoupled from the editable model**: they are extracted **separately, read-only,
for export only**. The save path and the PM round-trip are UNTOUCHED → zero regression risk.

## Part 1 — Real font faces (`docxToPdf.ts`)

Pure `resolveStandardFontFamily(family?: string): 'Helvetica' | 'Times' | 'Courier'`:
- Mirrors `flowDoc`'s allowlist spirit. Lowercased contains-match:
  - serif → `Times`: times, georgia, garamond, cambria, serif, "ptserif", minion, book antiqua.
  - mono → `Courier`: courier, consolas, mono, menlo, "lucida console".
  - else → `Helvetica` (arial, calibri, helvetica, segoe, verdana, tahoma, sans, unknown, undefined).
- `fontFor(family, bold, italic)` picks the 4-way variant within the family (the 12 non-symbol
  StandardFonts: Helvetica[-Bold][-Oblique], TimesRoman/Times-Bold/-Italic/-BoldItalic,
  Courier[-Bold][-Oblique]). All 12 embedded once up-front (cheap). Tokens already carry their
  `font`; `tokenize` now resolves the family per run (heading paragraphs stay bold).
- Width math is per-font (already `tok.font.widthOfTextAtSize`), so wrapping stays correct.

## Part 2 — Merged-cell tables (`docxToPdf.ts`)

Replace the equal-`colCount` grid with a colspan/rowspan-aware layout (mirrors `rebuildMergedTable`):
- `gridWidth(t)` = max over rows of `sumColspans(row) + (cols occupied by active rowspans at that row)`.
  Reuse `sumColspans` from `docModel`.
- Walk rows top-down with a `rowspanRemaining: number[]` (per grid column). For each row, place its
  cells left→right into the next FREE columns (skipping columns with `rowspanRemaining>0`), a cell
  occupying `colspan` columns × `rowspan` rows. Column width = `contentW / gridWidth` (equal columns
  — per-column `w:tblGrid` widths are NOT in the model → ceiling).
- A colspan cell draws `colspan*colW` wide. A rowspan cell draws from its start-row top down through
  the summed heights of the rows it spans (height = Σ spanned row heights); lower rows skip its
  columns. Row height = max content height of the rowspan=1 cells starting in that row (a rowspan
  cell taller than its summed rows overflows — documented, no redistribution in v1).
- Pure helper `buildCellGrid(t)` → `{ gridWidth, placements: {row,col,colspan,rowspan,cell}[] }`
  (jsdom-testable: assert column count + placement offsets for a colspan/rowspan fixture).

## Part 3 — Images (decoupled, export-only)

`src/docx/docxImages.ts`:
```ts
export interface DocImage {
  blockIndex: number;       // index among TOP-LEVEL w:p/w:tbl blocks it follows/sits in
  dataB64: string;          // raw base64 (no data: prefix)
  mime: 'image/png' | 'image/jpeg';
  widthPt: number; heightPt: number; // from wp:extent EMU (914400/in, 12700/pt); fallback intrinsic
}
export function extractDocImages(files: Record<string, Uint8Array>): DocImage[];
```
- Parse `word/document.xml`; for each top-level block (index i), find `a:blip/@r:embed` inside any
  `w:drawing`; resolve the relId via `word/_rels/document.xml.rels` (`Id`→`Target`, e.g.
  `media/image1.png`); read `word/<target>` bytes from `files`; sniff mime (PNG magic `89 50 4E 47`
  else JPEG); base64-encode; read `wp:extent @cx,@cy` (EMU→pt). Only PNG/JPEG (pdf-lib embeds those);
  others skipped. Never throws (a missing rel/media → skip that image).
- `mountDocxEditor` computes `extractDocImages(opc.files)` once and exposes `getImages(): DocImage[]`
  on `DocxEditorHandle`. The controller passes them to the export.
- `docModelToPdfBytes(model, { images })`: after drawing top-level block i, draw any image with
  `blockIndex === i` (embed via `doc.embedPng`/`embedJpg`, scale to fit `contentW`, paginate like a
  tall line). Default `images = []` → byte-identical to today. Index drift after heavy editing is a
  documented ceiling (clamp to range).

## Wire-up — `docxEditorController.ts`

`docModelToPdfBytes(model, { images: handle.getImages() })`. (Editor DISPLAY of images is NOT in
scope — this is export fidelity; images stay in `document.xml` and the in-place save preserves them.)

## Tests

- `tests/docx/docxToPdf.test.ts` (jsdom) — `resolveStandardFontFamily` mapping; `buildCellGrid`
  colspan/rowspan placement + gridWidth; existing render tests still green (byte-shape unchanged for
  plain docs).
- `tests/docx/docxImages.test.ts` (jsdom) — `extractDocImages` over a hand-built OPC files map (a
  tiny PNG in `word/media/image1.png` + rels + a `w:drawing` in document.xml) → one DocImage with the
  right mime/size/blockIndex; missing rel → skipped; non-PNG/JPEG → skipped.
- `tests/browser/docx-to-pdf.browser.test.ts` (real Chrome) — extend: a model with a serif run →
  exported PDF text uses a Times font (assert via pdf.js `getOperatorList`/font name or fallback to a
  width check); a 1-row 2-col table with a colspan=2 header renders a full-width top cell; an image
  passed via `{ images }` appears (page has an image XObject / non-trivial ink in its region).

## Gate (one commit)

`npm run type-check && lint && test && test:browser && build`. No Co-Authored-By. Push manual.
Visual confirmation: a real .docx with a heading, a serif paragraph, a merged-cell table, and an
image → exported PDF screenshot in `qa-shots/f5-docx-pdf/`.
