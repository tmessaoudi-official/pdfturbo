# DOCX Rich-Text Toolbar (Phase 2 Slice A) Plan

## Decisions Log
- [2026-06-20] AGREED: MVP scope = **full toolbar** — bold/italic/underline + headings + font family + size + lists, all round-tripping in place to `word/document.xml` (the OPC cardinal rule).
- [2026-06-20] AGREED: Heading/list strategy = **inject minimal defs if missing** — reuse existing Heading1–3 / list definitions in `styles.xml`/`numbering.xml` when present, else inject minimal spec-valid definitions so the toolbar works on ANY document. Untouched OPC parts still pass through verbatim.

## Formal Plan

Implemented per `docs/superpowers/plans/2026-06-20-docx-rich-text-toolbar.md` — 11 tasks
(T0 dep → T1/T2 model → T3/T4 opcParts → T5 schema → T6 mapping → T7 toolbar → T8 wiring
→ T9 browser → T10 docs), TDD, inline autonomous, commit per task. Push manual.
