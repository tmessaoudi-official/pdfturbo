# DOCX→PDF (#1d) Plan

## Decisions Log
- [2026-06-20] AGREED: DOCX→PDF export uses **Approach A** — a minimal pure flow→PDF renderer (pdf-lib StandardFonts, word-wrap, paginate, per-run bold/italic), zero new deps, selectable text, internally consistent with the editor's paragraphs+bold/italic model. Approach B (docx-preview raster) is the documented future high-fidelity option.
- [2026-06-20] AGREED: Design approved as specced — `src/docx/docxToPdf.ts` pure renderer + `getModel()` on the handle + export button in the editor modal + WinAnsi sanitize-to-`?` with a warn toast. A4/72pt/11pt/1.15 defaults. Rides `VITE_FEATURE_DOCX_EDIT` (no new flag).

## Formal Plan
<!-- written at Phase 4 / writing-plans approval -->

Spec: `docs/superpowers/specs/2026-06-20-docx-to-pdf-design.md`
