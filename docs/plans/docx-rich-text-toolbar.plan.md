# DOCX Rich-Text Toolbar (Phase 2 Slice A) Plan

## Decisions Log
- [2026-06-20] AGREED: MVP scope = **full toolbar** — bold/italic/underline + headings + font family + size + lists, all round-tripping in place to `word/document.xml` (the OPC cardinal rule).
- [2026-06-20] AGREED: Heading/list strategy = **inject minimal defs if missing** — reuse existing Heading1–3 / list definitions in `styles.xml`/`numbering.xml` when present, else inject minimal spec-valid definitions so the toolbar works on ANY document. Untouched OPC parts still pass through verbatim.

## Formal Plan
<!-- written at Phase 4 approval -->
