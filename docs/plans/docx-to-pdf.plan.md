# DOCX→PDF (#1d) Plan

## Decisions Log
- [2026-06-20] AGREED: DOCX→PDF export uses **Approach A** — a minimal pure flow→PDF renderer (pdf-lib StandardFonts, word-wrap, paginate, per-run bold/italic), zero new deps, selectable text, internally consistent with the editor's paragraphs+bold/italic model. Approach B (docx-preview raster) is the documented future high-fidelity option.
- [2026-06-20] AGREED: Design approved as specced — `src/docx/docxToPdf.ts` pure renderer + `getModel()` on the handle + export button in the editor modal + WinAnsi sanitize-to-`?` with a warn toast. A4/72pt/11pt/1.15 defaults. Rides `VITE_FEATURE_DOCX_EDIT` (no new flag).

## Formal Plan

Implemented per `docs/superpowers/plans/2026-06-20-docx-to-pdf.md` (6 tasks, TDD, inline autonomous).

**DONE (2026-06-20)** — commits on master, UNPUSHED (user pushes):
- `22feb81` T1 WinAnsi sanitizer
- `52787a6` T2 DocModel→PDF renderer (word-wrap + pagination)
- `f281170` T3 `getModel()` on the handle
- `d9aa0d7` T4 Export PDF button + i18n + `notify` `'warn'` seam
- `41366e8` T5 real-Chrome text-extraction guard
- (T6 docs/verify — this commit)

Verification: type-check 0 · lint 0 warnings · jsdom 1700 + 2 xfail · docx-to-pdf browser 2/2.

Spec: `docs/superpowers/specs/2026-06-20-docx-to-pdf-design.md`
