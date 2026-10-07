# Review remediation Plan

Follow-up of the read-only whole-repo review of 2026-10-07/08 (five lenses: architecture against the DDD + Hexagonal
target, code quality, tests and delivery, security and safety promises, framework sync and docs; 102 findings:
P0 1, P1 13, P2 39, P3 49). The lens reports were transient (`var/claude/review-20261007/`, gitignored); every
finding this plan acts on is restated in its Status row so the plan stands on its own. The architecture migration
has its own plan: `docs/plans/architecture.plan.md`.

## Decisions Log
- [2026-10-08 01:33] AGREED: SEC-1 (P0): qualify the three SECURITY.md rows now (docs only), then fix test-first under the milestone panel; then TEST-1, TEST-2, TEST-3 and QUAL-1 the same way (developer, review session 2026-10-08).
- [2026-10-08 01:33] AGREED: Push cadence: drop the per-green-change push override; adopt global Rule 10's batch-of-10 (milestone ends and stops are push points) (developer, review session 2026-10-08).
- [2026-10-08 01:33] AGREED: Milestone certification: drop the repo's two-consecutive-clean-rounds tier; one three-lens panel per milestone on a frozen commit, as the certification schedule says (developer, review session 2026-10-08).
- [2026-10-08 01:34] AGREED: framework-health step 9 L4 pack in this repo: path-scoped additions to .claude/rules/ only, after the stale-gotcha prune; no domain-* skills, no unscoped core; amend the three-skills line to say why. Relayed to the ~/.claude session (developer, review session 2026-10-08).
- [2026-10-08 01:34] AGREED: Author casing: 'Takieddine MESSAOUDI' is canonical (git config and every commit since 2026-08-18); CLAUDE.md drops the false 'matches 100% of history' claim (developer, review session 2026-10-08).
- [2026-10-08 01:34] AGREED: Re-sign + force-push happens only after CLOUD sessions (no GPG keys there); local commits are signed at creation. Keep the fetch-first rule, scoped to after a cloud session (developer, review session 2026-10-08).
- [2026-10-08 01:34] AGREED: Docs and config drift: all of it in one docs-only pass; P2 code findings fold into the roadmap or become plan rows, P3s are fixed when their file is touched; work starts in this session in the order of the Status block (developer, review session 2026-10-08).

## Formal Plan

Two milestones, each certified by ONE three-lens panel (`export-fidelity-reviewer`, `safety-promises-reviewer`,
`completeness-reviewer`) on a frozen commit, then pushed. A P0 fix is never held back by the batch-of-10 push rule:
the milestone boundary is a push point.

**Milestone 1 — SEC-1 fixed (rows 1–2).**
SEC-1 (P0): an excluded page — redacted, deleted, or outside an extracted range — is serialised whole into the export
when a kept page references it (a link `/Dest` or `/A /GoTo`, a multi-page form field's `/Kids` → widget `/P`,
probably `/Popup` / `/IRT`). `copySourcePages` deep-copies everything a kept page reaches, `_assemblePdfDoc` filters
page indices only, and pdf-lib does not garbage-collect. Reaches Download, Extract range, single-page download,
Flatten (link vector) and `assemblePdfBytes` → signed, sanitized and compressed outputs. Measured 2026-10-07 with a
probe of `copySourcePages` (2-page source, page 2 excluded): no reference → clean; GoTo `/Dest` → secret in bytes;
shared field `/Kids` → secret in bytes; control → the scan sees the secret.

**Milestone 2 — correctness P1s, docs batch, architecture steps 0–3 (rows 3–9).**

## Status
<!-- progress-block v1 -->
| # | Step | Size | State | Evidence | Files |
|---|------|------|-------|----------|-------|
| 1 | Qualify the three SECURITY.md rows SEC-1 refutes (Redaction, Delete page, Extract page range) with an open-issue note and a working workaround (KNOWN_ISSUES holds no open defects by its own definition, so no entry there); record the review rulings and the architecture plan | S | doing | - | SECURITY.md, docs/plans/** |
| 2 | SEC-1 fix: red fixtures first (GoTo /Dest, shared field /Kids) at the copySourcePages seam and through the real export for redaction, delete page and extract range; then cut references to excluded pages, sweep, byte no-op on clean documents; sabotage; restore the SECURITY.md rows | M | todo | - | src/export/copySourcePages.ts, src/export/exportService.ts, tests/** |
| 3 | TEST-1: replace the raw NUL byte in src/core/undoRedoController.ts:45 with the escape, and forbid raw control bytes in src/ with a source-level test | S | todo | - | src/core/undoRedoController.ts, tests/tools/** |
| 4 | TEST-2: setFormXObjectContent (contentStreamEditor.ts ~1069) swallows every error and its 3 callers report a successful true-edit — surface the failure so the caller falls back honestly | S | todo | - | src/utils/contentStreamEditor.ts, tests/** |
| 5 | TEST-3: the bare catch at exportService.ts ~832 ("no form fields") also hides form.flatten() failures — narrow it so Flatten & download never ships live fields silently | S | todo | - | src/export/exportService.ts, tests/** |
| 6 | QUAL-1: release pdf.js documents (loadingTask.destroy) on close/open, after the undo history is cleared; leave undoable page delete to the commands' dispose() | M | todo | - | src/core/**, src/ui/documentLoader.ts, tests/** |
| 7 | Docs and config drift in one docs-only pass (rulings 2026-10-08: batch-of-10 push, one panel per milestone, author casing MESSAOUDI, re-sign only after cloud sessions; SYNC-1/3/6; README/FEATURES/VISION form fill + recent files; CHANGELOG; archive master.plan.md; rules-file caps; undici pin; stale memory notes; container-era wording; settings .bak leftovers) | M | todo | - | CLAUDE.md, .claude/**, README.md, FEATURES.md, VISION.md, CHANGELOG.md, docs/** |
| 8 | Architecture steps 0–3 (see docs/plans/architecture.plan.md) | L | todo | - | src/**, tests/tools/** |
| 9 | Remaining P2 findings as plan rows; P3 findings fixed when their file is touched (list in § Known issues) | M | todo | - | - |
<!-- /progress-block -->
### Blocked
### Needs input
### Needs research
### Fragile
### Known issues
