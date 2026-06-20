# DOCX Rich-Text Toolbar (Phase 2 Slice A) Plan

## Decisions Log
- [2026-06-20] AGREED: MVP scope = **full toolbar** — bold/italic/underline + headings + font family + size + lists, all round-tripping in place to `word/document.xml` (the OPC cardinal rule).
- [2026-06-20] AGREED: Heading/list strategy = **inject minimal defs if missing** — reuse existing Heading1–3 / list definitions in `styles.xml`/`numbering.xml` when present, else inject minimal spec-valid definitions so the toolbar works on ANY document. Untouched OPC parts still pass through verbatim.

## Formal Plan

Implemented per `docs/superpowers/plans/2026-06-20-docx-rich-text-toolbar.md` — 11 tasks
(T0 dep → T1/T2 model → T3/T4 opcParts → T5 schema → T6 mapping → T7 toolbar → T8 wiring
→ T9 browser → T10 docs), TDD, inline autonomous, commit per task. Push manual.

## Status — DONE (2026-06-20)

All 11 tasks complete and committed (T0 `6b8fd11`, T1+T2 `4469c69`, T3+T4 `234a6ca`,
T5 `b53d769`, T6 `194cc92`, T7 `ba61dc7`, T8 `1dac92e`, T9 `b80e451`, T10 docs; spec
`36ffc68`, plan `ea30de8`). Slice A shipped: B/I/U + heading + font + size + lists toolbar,
round-tripping in place to the OPC package (inject-if-missing styles/numbering). Full gate
green (type-check 0 · lint 0 · jsdom suite · real-Chrome `docx-toolbar.browser.test.ts`).
Push remains manual. Next: Phase 2 Slice B (true-PDF restyle toolbar, safe subset).
