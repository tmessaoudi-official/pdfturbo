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
DONE (DOCX surface) — 2026-06-20, autonomous build. Commits: 653aed1 (spec+plan), 902a41d (T1 core),
df4e522 (T2 plugin), 773a0c6 (T3 bar+CSS+i18n), 44db9df (T4 wiring+browser guard), + CLAUDE.md docs.
Gate: type-check 0, lint 0, jsdom 1775+2xfail, browser 92/92. PUSH IS MANUAL (user pushes).

### Deviations from plan (documented)
- `openFindReplace(withReplace)` — the plugin command ignores `withReplace` (it only flips `active`);
  the BAR tracks find-vs-replace visibility. The keymap calls `bar.open(withReplace)` directly.
- Locale `findReplace.*` keys added during T3 (the bar test asserts the formatted counter) rather than T4.
- No standalone `docxEditorController` test added for the bar mount — covered by the real-Chrome guard
  (the controller mount is a one-line `insertBefore`, exercised end-to-end in the browser test via mountDocxEditor).

### Next (separate brainstorm)
- PDF true-edit find/replace ("DOCX first, PDF after") — reuse `textSearchHandler` search + `replaceTextAt`;
  inherits all true-edit ceilings (subset/CID fonts, Arabic, XObjects, rotated pages → refuse/overlay).
- v1b for DOCX: cross-paragraph match, preserve-case smart replace, replace-within-selection scope, table cells (feature #3).
