# Slice C — Find/Replace Plan

## Decisions Log
- [2026-06-20] AGREED: Surface = BOTH — DOCX-editor find/replace FIRST, PDF true-edit find/replace as a separate follow-up brainstorm ("DOCX first, PDF after").
- [2026-06-20] AGREED: Matching engine = FULL — plain + case-sensitive toggle + whole-word toggle + regex (with `$1` capture-group replacement).
- [2026-06-20] AGREED: Replacement formatting on a mixed-format match = INHERIT MATCH START (marks of the match's first character).
- [2026-06-20] AGREED: Highlight ALL matches via a ProseMirror decoration plugin, active match emphasized, Next/Prev cycling, "n of m" counter.
- [2026-06-20] AGREED: No new dep, no new flag (rides VITE_FEATURE_DOCX_EDIT). i18n keys in en/fr/ar (ar [Unverified]).
- [2026-06-20] AGREED: Run unattended/autonomous — full DOCX F/R build (spec→plan→TDD→commit), push manual. Stop before the PDF follow-up.

## Formal Plan
- Design spec: `docs/superpowers/specs/2026-06-20-docx-find-replace-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-20-docx-find-replace.md`
- Architecture: pure core (`findReplace.ts`) + PM plugin (`findReplacePlugin.ts`) + bar UI (`findReplaceBar.ts`) + wiring (`docxProseMirror.ts`, `docxEditorController.ts`).

## Status
IN PROGRESS — autonomous build 2026-06-20.
