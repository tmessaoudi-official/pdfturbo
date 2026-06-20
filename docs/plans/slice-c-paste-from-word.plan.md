# Slice C — Paste-from-Word Plan

## Decisions Log
- [2026-06-20] AGREED: Slice C = three independent features (paste-from-Word, find/replace, DOCX table editing), each its own brainstorm→spec→plan→TDD cycle.
- [2026-06-20] AGREED: Build order = Paste-from-Word → Find/replace → DOCX table editing.
- [2026-06-20] AGREED: Find/replace surface (DOCX editor vs PDF true-edit) deferred to its own brainstorm.
- [2026-06-20] AGREED: First feature = Paste-from-Word into the ProseMirror DOCX editor (Track B), riding Slice A's per-run formatting model.
- [2026-06-20] AGREED: Paste preserves ALL editor-supported formatting (bold/italic/underline, H1–H6, bullet/numbered lists, font family & size, hyperlinks); unsupported bits (colors, images, tables) degrade gracefully. Maps to the EXISTING schema — no new marks/nodes.
- [2026-06-20] AGREED: Table-aware paste DEFERRED to feature #3 (table editing). For paste v1, pasted tables fall back to ProseMirror's default (grid dropped, cell text → paragraphs) — documented limitation.
- [2026-06-20] AGREED: Provide plain-text "paste without formatting" via Ctrl+Shift+V, alongside formatted Ctrl+V.

## Formal Plan
- Design spec: `docs/superpowers/specs/2026-06-20-docx-paste-from-word-design.md`
- Implementation plan (5 TDD tasks): `docs/superpowers/plans/2026-06-20-docx-paste-from-word.md`
- Approach A: pure `cleanWordHtml` sanitiser + `transformPastedHTML` hook + Ctrl+Shift+V plain-text path; existing schema, no new deps, no new flag.
