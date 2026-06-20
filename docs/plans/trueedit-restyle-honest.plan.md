# True-PDF Restyle — Honest Font-Substitution (Phase 2 Slice B) Plan

## Decisions Log
- [2026-06-20] AGREED: Slice B scope = **harden + test what exists** (Option 1), NOT a new restyle panel. The safe-subset restyle is already wired (textEditHandler reuses the main toolbar → replaceTextAt with style); the gap is honesty + test coverage, not UI.
- [2026-06-20] AGREED: Substitution UX = **toast after the edit** (mirrors `toast.trueEditOverlay`); no pre-edit inline hint, no new layout.
- [2026-06-20] AGREED: Engine signals the path via a `false | 'inplace' | 'substituted'` return from `replaceTextAt` (truthy-compatible — the one production caller's `if (!ok)` and all pixel guards keep working). Toast names no specific base-14 family (deferred nicety).
- [2026-06-20] AGREED: Approved to write spec + implementation plan; execute autonomously per task on master, push manual (same as Slice A).

## Formal Plan
<!-- written at Phase 4 by writing-plans -->
Design spec: `docs/superpowers/specs/2026-06-20-trueedit-restyle-honest-design.md`.
Implementation plan: `docs/superpowers/plans/2026-06-20-trueedit-restyle-honest.md` (next).
