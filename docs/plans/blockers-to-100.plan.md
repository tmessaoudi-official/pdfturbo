# Blockers to 100% — Deep Research + Confirming Tests Plan

Deep research across ALL feature domains answering "what blocks 100% correctness/
fidelity on everything," with a committed test proving each blocker is real.

## Decisions Log
- [2026-06-15] AGREED: Scope = all 6 domains (true-edit, DOCX/MD, Arabic, OCR, e-signing, core editing/export) via ≤5 parallel research agents, then parent synthesis. (AskUserQuestion)
- [2026-06-15] AGREED: "Tests to confirm" = RED tests that prove each blocker empirically — not assertions. (AskUserQuestion)
- [2026-06-15] DESIGN: Red tests use vitest `it.fails()` (passes *because* the broken behavior fails today; flips red when fixed → forces conversion). Ceilings get normal passing tests that PIN current degraded output. Keeps CI green while proving every blocker.
- [2026-06-15] DESIGN: Research agents are READ-ONLY deep-dive; they write raw findings to disk (compaction safety) + design each confirming test (exact input + failing assertion). PARENT writes AND runs the actual test files — verifying each `it.fails` genuinely fails-as-expected and each ceiling-pin passes (parent integration gate catches agent false-positives, as this session repeatedly required).

## Formal Plan
### Phase 5a — research fan-out (5 read-only agents, raw → docs/reviews/research-2026-06-15-blockers/raw/)
1. DOCX/MD fidelity — extend scorecard-docx; confirm each 🟡/⛔; MD-specific gaps; NEW gaps.
2. True-edit — extend scorecard-trueedit; confirm each path/gap; NEW gaps.
3. Arabic — DOCX + overlay + true-edit (uses research-2026-06-15-arabic/).
4. OCR + E-signing — NOT yet scorecarded: OCR accuracy ceilings; signing TSA/LTV/multi-sig/encrypt-then-sign/PAdES.
5. Core — undo/redo, export pipeline, encryption, forms, redaction, persistence, render fidelity, PWA, i18n/RTL UI, a11y residual.

Each agent returns: blockers as {id, domain, one-line, class reachable|ceiling, file:line, root cause, confirming-test design (input + assertion that fails today)}.

### Phase 5b — parent synthesis + tests
- Consolidate → docs/reviews/research-2026-06-15-blockers/CONSOLIDATED.md (unified table, all domains, reachable vs ceiling, ROI-ranked).
- Write tests/blockers/*.blockers.test.ts — `it.fails()` per reachable blocker, passing pin per ceiling. RUN them; verify each behaves as designed.
- Full gate: tsc 0 / oxlint 0 / jsdom green / browser green.

### Phase 7 — docs
- Refresh scorecards with empirical (test-backed) status; note new gaps; update KNOWN_ISSUES.md.

## Verification
Every blocker has a runnable test. `it.fails` green = blocker confirmed real. Gate green overall.

## OUTCOME (2026-06-15) — DONE
- 5 read-only research agents → `docs/reviews/research-2026-06-15-blockers/raw/{docx,trueedit,arabic,ocr-signing,core}.md`.
- Synthesis → `docs/reviews/research-2026-06-15-blockers/CONSOLIDATED.md` (all 6 domains, reachable vs ceiling, ROI-ranked).
- Confirming tests → `tests/blockers/*.blockers.test.ts`: **11 blockers proven via `it.fails` + 2 behavior pins**, all green.
- **verify-why (3C refinement #2) caught two issues:** (1) my first B-1 assertion was the wrong symptom — `1e-3` → number `1` + bogus `e-3` operator (fixed the assertion); (2) agent S3 claim of *silent* sig corruption was WRONG — re-signing throws an opaque ByteRange crash, no clean refusal (test now asserts the correct typed refusal).
- **P0s:** CORE-P0-1 rotated-redaction pixel leak (Verified by source read; browser pixel-test designed, deferred — lands with the fix) and CORE-P0-2 AES-128 encryption (tested).
- Phase 7: flipped 5 stale `scorecard-docx.md` rows (13/21/23/24 ✅, 26 ✅-partial) + tally; cross-linked KNOWN_ISSUES.md.
- Gate: tsc 0 · oxlint 0/0 · jsdom 1012 pass + 11 expected-fail. Browser suite unchanged. NOT pushed (manual).
- This was a research+tests pass — **no production code behavior changed**; the reachable fixes are queued (ROI list in CONSOLIDATED.md).
