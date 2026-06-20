# DOCX→PDF export (#1d) — design

**Date:** 2026-06-20
**Status:** Approved (Approach A) — ready for implementation plan
**Track:** B (DOCX read+edit editor)
**Feature flag:** rides `VITE_FEATURE_DOCX_EDIT` (no new flag)

## Goal

Let a user who opened and edited a Word document in PDFturbo's DOCX editor export it
as a **PDF**. This completes the read → edit → export loop. The exported PDF carries
**selectable text** (not a raster), so it can be re-opened in PDFturbo's own PDF editor.

## Decision: Approach A — minimal flow→PDF renderer

Chosen over (B) a high-fidelity raster export (docx-preview → canvas → image PDF) because:

- **Zero new dependencies** — `@cantoo/pdf-lib` (`StandardFonts`, `widthOfTextAtSize`) is
  already present. License-clean (no copyleft); the project may go proprietary.
- **Selectable text** — the output is a real text PDF, re-editable in PDFturbo.
- **Internally consistent** — the DOCX editor's editable model is *exactly* paragraphs +
  per-run bold/italic. Rendering that model to PDF is at parity with what the editor can
  edit. (Tables/images survive the `.docx` save path as opaque XML but are not editable,
  so their absence from the PDF is not a regression of editing capability.)
- It is the flow→PDF **sibling** of the existing `flowDocWriters.ts` (flow→DOCX/MD/TXT).

Approach B remains a documented future option ("high-fidelity image export").

## Architecture

```
DocModel (paragraphs → runs{text,bold,italic})
   │
   ▼  docModelToPdfBytes(model, opts?)          ← src/docx/docxToPdf.ts (PURE)
   │     • embed 4 Helvetica StandardFonts
   │     • inline layout + word-wrap + pagination
   │     • WinAnsi sanitization
   ▼
{ bytes: Uint8Array, hadUnsupportedChars: boolean }
   │
   ▼  controller exportPdf()                    ← src/docx/docxEditorController.ts
        download(bytes, "<base>.pdf")  +  toast
```

### Component 1 — `src/docx/docxToPdf.ts` (new, pure, jsdom-testable)

```ts
export interface DocxToPdfOptions {
  pageWidth?: number;   // default 595.28 (A4)
  pageHeight?: number;  // default 841.89 (A4)
  margin?: number;      // default 72 (1 inch)
  fontSize?: number;    // default 11
  lineHeight?: number;  // default 1.15 (× fontSize)
  paragraphGap?: number;// default 6 (pt after each paragraph)
}

export interface DocxToPdfResult {
  bytes: Uint8Array;
  hadUnsupportedChars: boolean;
}

export async function docModelToPdfBytes(
  model: DocModel,
  opts?: DocxToPdfOptions,
): Promise<DocxToPdfResult>;
```

Layout algorithm:
1. Create a pdf-lib doc; embed Helvetica, HelveticaBold, HelveticaOblique,
   HelveticaBoldOblique once. `fontFor(bold, italic)` picks one.
2. Add the first page; `y = pageHeight − margin`.
3. For each paragraph:
   - If it has no non-empty runs → advance `y` by one line (blank line); continue.
   - Flatten runs → **word tokens** `{ text, font, spaceBefore }` by **run-level
     tokenization**: split each run's (WinAnsi-sanitized) text on whitespace; each
     resulting word becomes a token carrying that run's font. `spaceBefore` is true when
     the token follows whitespace (within its run, or a run boundary where the previous
     run ended on a space / this run starts with one), false otherwise — so a word split
     across a font boundary mid-word (e.g. bold "hel" + regular "lo") is drawn adjacently
     with no gap, while space-separated words keep their gap. The space width is
     `font.widthOfTextAtSize(' ', size)` of the token's own font.
   - Greedy line fill: accumulate tokens while the measured line width
     (`Σ tokenWidth + Σ spaceWidth`) ≤ `pageWidth − 2·margin`. A single token wider than
     the content width is hard-broken by character. The first token on a line never emits
     a leading space.
   - Before drawing a line, if `y − lineHeightPt < margin` → `addPage`, reset `y`.
   - Draw the line token-by-token, advancing `x` by each token's width (plus its leading
     space when not line-start); decrement `y` by `lineHeightPt`.
   - After the paragraph, decrement `y` by `paragraphGap`.
4. `return { bytes: await doc.save(), hadUnsupportedChars }`.

WinAnsi safety (`sanitizeWinAnsi(s): { text, replaced }`): pdf-lib `StandardFonts`
encode CP1252 only; an unencodable codepoint throws in `widthOfTextAtSize`/`drawText`.
Map any codepoint outside the WinAnsi set to `?` and OR `replaced` into the
doc-level `hadUnsupportedChars`. French/German/Spanish accents are in CP1252 → unaffected.

### Component 2 — `DocxEditorHandle.getModel()` (small addition)

Add to the handle returned by `mountDocxEditor`:

```ts
getModel(): DocModel;   // returns docToDocModel(view.state.doc) — the exact call save() makes
```

Non-breaking (additive). The PDF export needs the live model, not the re-zipped `.docx`.

### Component 3 — controller wiring (`src/docx/docxEditorController.ts`)

- Add `exportPdfBtn` ("📄 PDF") to the modal header beside Save.
- `onExportPdf()`: guard `handle`; `const { bytes, hadUnsupportedChars } =
  await docModelToPdfBytes(handle.getModel())`; `download(bytes, pdfName(currentName))`;
  toast `docxEditor.pdfExported` (info), and `docxEditor.pdfUnsupportedChars` (warn) when
  `hadUnsupportedChars`. On throw → `docxEditor.pdfFailed` (error).
- `pdfName(filename)` = `<base>.pdf` (strip `.docx`). Reuses the injectable `download` seam
  (so jsdom drives it deterministically).
- `docModelToPdfBytes` is **dynamically imported** inside `onExportPdf` (keeps pdf-lib out
  of the controller's already-lazy chunk's eager path; pdf-lib is large).

### i18n

Add to en/fr/ar under `docxEditor`: `exportPdf`, `pdfExported`, `pdfUnsupportedChars`,
`pdfFailed`. Arabic values are `[Unverified]` (machine-translated; flagged for native review).

## Error handling

- Empty document (no paragraphs / all blank) → still produces a valid 1-page PDF.
- Unsupported characters → sanitized to `?`, user warned (non-fatal).
- Any pdf-lib failure → caught in the controller, `docxEditor.pdfFailed` toast; the editor
  stays open and intact.

## Testing (TDD — failing test first at each layer)

1. **jsdom** `tests/docx/docxToPdf.test.ts` (pure):
   - model → bytes start with `%PDF`; reloads via `PDFDocument.load`.
   - 1 short paragraph → 1 page; a large model (e.g. 300 paragraphs) → >1 page.
   - bold run selects HelveticaBold (assert distinct embedded font / page font resources).
   - `sanitizeWinAnsi` replaces a CJK/emoji char with `?` and sets `hadUnsupportedChars`.
   - a long unbroken token is hard-broken (no throw, >1 line).
2. **browser** `tests/browser/docx-to-pdf.browser.test.ts` (real Chrome):
   - model → PDF → `pdf.js getTextContent` contains the run text in reading order.
   - accented French (`é è à ç`) round-trips intact.
3. **controller** extend `tests/docx/docxEditorController.test.ts`:
   - clicking export downloads a `*.pdf` (via the injected download seam).

## Documented ceilings (match the editor's own model limits)

NOT rendered (not in the editable `DocModel`): tables, images, styles, colors, font faces,
headers/footers, lists/numbering, paragraph alignment, doc-defined page size/margins.
Non-WinAnsi scripts (CJK, Arabic, emoji) are sanitized to `?` — font-embedding is the
future path; Arabic has the Noto Naskh seam but RTL layout is out of MVP scope.
High-fidelity raster export (Approach B) is the documented future alternative.
