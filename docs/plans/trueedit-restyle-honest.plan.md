# True-PDF Restyle — Honest Font-Substitution (Phase 2 Slice B) Plan

## Decisions Log
- [2026-06-20] AGREED: Slice B scope = **harden + test what exists** (Option 1), NOT a new restyle panel. The safe-subset restyle is already wired (textEditHandler reuses the main toolbar → replaceTextAt with style); the gap is honesty + test coverage, not UI.
- [2026-06-20] AGREED: Substitution UX = **toast after the edit** (mirrors `toast.trueEditOverlay`); no pre-edit inline hint, no new layout.
- [2026-06-20] AGREED: Engine signals the path via a `false | 'inplace' | 'substituted'` return from `replaceTextAt` (truthy-compatible — the one production caller's `if (!ok)` and all pixel guards keep working). Toast names no specific base-14 family (deferred nicety).
- [2026-06-20] AGREED: Approved to write spec + implementation plan; execute autonomously per task on master, push manual (same as Slice A).

## Formal Plan
Design spec: `docs/superpowers/specs/2026-06-20-trueedit-restyle-honest-design.md`.
Implementation plan: `docs/superpowers/plans/2026-06-20-trueedit-restyle-honest.md`.

## Status — DONE (2026-06-20)

All 5 tasks complete and committed: T1 engine return contract `1b6f388`, T2 i18n `cf802eb`,
T3 handler wiring `3ebf2a4`, T4 real-Chrome guard `6da42aa`, T5 docs (this) + audit. Spec/plan
`82f74d6`, decisions `bd653fb`. **Design refinement during T1 (TDD-driven):** the substitution
signal is gated on `byteSwapUnsafe` (Path 3 on a non-standard embedded font), NOT "any Path 3" —
a Path-3 redraw of an already-standard base-14 font returns plain `true` (no false alarm). Audit
of `commit()` branches: clean, no defect. Full gate green (type-check 0 · lint 0 · jsdom · real
Chrome). Push remains manual. Next: Slice C (find/replace, tables, paste-from-Word).
