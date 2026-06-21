# Richer Text Toolbars + DOCX→PDF Fidelity Plan

## Decisions Log
- [2026-06-21] AGREED: resume order = **B2 first, then ONE combined visual-evidence pass** covering A/B1/C/B2 (single browser session). Then CLAUDE.md docs + stage commit.
- [2026-06-21] AGREED: DOCX→PDF export fidelity = headings (sizes) + list markers (bullet/ordered + indent) + run underline + run **color** (full slice: model+parser+writer+ProseMirror+toolbar+render).
- [2026-06-21] AGREED: PDF text toolbar = "All three": (B) fix dead Bold/Italic during true-edit + add underline/strike to true-edit; (also subsumes the minimal B/I-only fix); (C) enrich the addText overlay TextElement toolbar (underline/strikethrough/alignment).
- [2026-06-21] FINDING: true-edit restyle plumbing already exists (textEditHandler `_openTrueEditInput`/`commit` → `replaceTextAt(style)`); size/family/color work, Bold/Italic are dead because `FormattingService.toggleBold/Italic` early-return without a selected TextElement so `btn-active-fmt` never toggles.

## Formal Plan

### Workstream A — DOCX→PDF export fidelity (`src/docx/docxToPdf.ts`; model fields already present except color)
- A1 Heading sizes: render `DocParagraph.heading` 1/2/3 at larger bold sizes (e.g. 20/16/13 pt) + extra gap. Pure renderer; per-paragraph size override (currently size-uniform).
- A2 List markers: bullet `•` (unordered) / ordinal `1.`,`a.`,… (ordered, restart per contiguous run) + indent by `list.level`. Hanging indent for wrapped lines.
- A3 Underline: draw a thin line under each `DocRun.underline` run (per-token, at baseline−~1pt).
- A4 Run color: add `color?: string` (#rrggbb) to `DocRun`; parse `w:color@w:val` (docModel parser); write `w:color` in `buildRun` + add to `MANAGED_RPR`; ProseMirror color mark (docxSchema) + map (docxProseMirror); color control in `docxToolbar`; render via `rgb()` in docxToPdf.
- Guards: `tests/docx/docxToPdf.test.ts` (heading size, list marker text/indent, underline line, colored run), `tests/docx/docModelRichText.test.ts` (color round-trip), real-Chrome `tests/browser/docx-to-pdf.browser.test.ts`.

### Workstream B — True-edit PDF text toolbar (`textEditHandler.ts`, `contentStreamEditor.ts`, `index.html`, locales)
- B1 Fix dead Bold/Italic: in `_openTrueEditInput`, attach session-local click listeners on boldBtn/italicBtn that toggle `btn-active-fmt` (removed on close), independent of FormattingService. `commit()` already reads the class.
- B2 Add Underline/Strike toggles to the true-edit toolbar: new `underlineBtn`/`strikeBtn` in HTML + ui refs; extend `TextStyle` with `underline`/`strikethrough`; toggling forces Path-3 redraw (like restyle) and emits a decoration line under/through the redrawn text. Refuse paths keep overlay fallback.
- Guards: `tests/handlers/textEditHandler.test.ts` (B/I now flips style), `tests/utils/contentStreamEditor.test.ts` (underline/strike emit), real-Chrome `tests/browser/trueedit-restyle.browser.test.ts`.

### Workstream C — addText overlay TextElement toolbar (`textElement.ts`, `formattingService.ts`, `index.html`, `pdfElementRenderer.ts`, locales)
- C1/C2 Underline + Strikethrough: `TextElement.underline/strikethrough` props; `FormattingService.toggleUnderline/toggleStrike`; toolbar buttons; DOM render (`text-decoration`); export bake; `toJSON` (NO schema bump — optional).
- C3 Alignment: `TextElement.align` (left/center/right); setter + button cycle; render + export.
- Guards: element/service unit tests + real-Chrome overlay render screenshot.

## Progress (2026-06-21)
- A DONE + green: heading sizes, list markers (bullet/decimal/alpha/roman + indent), run underline, run color (model `w:color` round-trip + ProseMirror `color` mark + toolbar picker + render). Guards: docxToPdf/docModelRichText/docxMapping/docxToolbar tests + docx-to-pdf.browser case.
- B1 DONE + green: dead Bold/Italic during true-edit fixed (session-local toggles in `_openTrueEditInput`). [Visual confirmation pending]
- C DONE + green: TextElement underline/strikethrough/align — model+factory+DOM+export bake (drawLine, align offset; rotated = ceiling)+toolbar buttons+binder+service+locales. Guards: formattingService/pdfElementRenderer/elements.render tests. [Visual confirmation pending]
- B2 DONE + green (2026-06-21): standalone decoration (option a). `addDecorationAt`/`buildStandaloneDecoration` in
  contentStreamEditor.ts (font-preserving stroked line, embedded-advance width + proxy fallback, `tilted`/invisible/
  undecodable refuse gates); wired into `textEditHandler` commit (ADD-only toggles on underlineBtn/strikeBtn, both
  save-paths, no-op-save guard). Guards: 6 engine + 2 handler jsdom + `trueedit-add-decoration.browser.test.ts` (2,
  real Chrome). jsdom 1826/+2xfail, lint 0, type-check 0; true-edit browser suite 15/15.
- Visual-evidence pass DONE (synthetic PDF, `qa-shots/b2-session/` — NO private fixtures): b2-01 richer toolbar
  (U/S/Align buttons), b2-02 before, b2-03/04 editing+armed, b2-06 underline in-place, b2-07 bold in-place, b2-08
  all three in-place (bold / bold+underline / underline, same font, no overlay), b2-09 overlay U+S render + active
  toolbar buttons. b2-05 (combined-via-messy-injection) showed a stray overlay artifact — NOT reproduced cleanly
  (b2-08 confirms combined works in-place). A (DOCX→PDF) covered by `docx-to-pdf.browser.test.ts` pixel assertions.
- Phase 7 DONE: CLAUDE.md documents A (heading sizes/list markers/underline/color) + B1/B2/C (richer toolbar).

## STATUS: Implemented + verified — staged, NOT committed (awaiting user's commit choice).

## Sequencing
A (pure renderer, lowest risk) → A4 color slice → C (overlay, self-contained) → B (engine, highest risk). Commit per workstream. Push MANUAL (user). No Co-Authored-By.
