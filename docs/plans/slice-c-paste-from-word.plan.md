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

## Status
DONE — 2026-06-20. Commits: 503c8d3 (cleaner), c871407 (wiring + plain-text), 20214b9 (browser guard), + CLAUDE.md docs. Gate: type-check 0, lint 0, jsdom 1748+2xfail, browser 91/91.

### Implementation deviations from plan (both improvements, documented)
- **Plain-text path uses `tr.insertText`, NOT `view.pasteText`** — pasteText constructs a `ClipboardEvent` internally, which jsdom lacks (the plan's documented fallback). insertText is jsdom-safe and correctly "match destination style": drops SOURCE formatting, inherits cursor context.
- **Browser test uses `view.pasteHTML(html)`** (the real paste entry point that applies transformPastedHTML) instead of dispatching a synthetic `ClipboardEvent` — synthetic events cannot populate `clipboardData` for untrusted events.
- **T2+T3 committed together** (one EditorView-props edit + one shared test file — splitting was artificial).

### Known limitations (documented in CLAUDE.md)
- Pasted tables → ProseMirror default (grid dropped, cell text → paragraphs); feature #3 upgrades.
- Colour/highlight/strikethrough dropped (no schema mark). Link URL survives in editor but not OPC save (`DocRun` has no `linkUrl`).
