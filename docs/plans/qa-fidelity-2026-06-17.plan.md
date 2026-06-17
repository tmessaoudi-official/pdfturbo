# QA + Fidelity Sweep Plan — 2026-06-17

Goal: exhaustive QA discovery (bugs, UX friction, non-intuitiveness, missing buttons/features,
missing/weak translations, unclear flows, a11y, mobile) ACROSS the whole app, then triage, then
depth-first fidelity sprints to push DOCX / Arabic export / element positioning / every feature
to "100% fidelity to its honest promise" — raising reachable ceilings and honestly re-scoping
structural ones.

## Decisions Log
- [2026-06-17] AGREED: Structure = Discover → Triage → Fidelity sprints (breadth before depth; do NOT merge fidelity research into the discovery sweep).
- [2026-06-17] AGREED: Execution mode = multi-agent workflow (explicit opt-in to orchestration).
- [2026-06-17] AGREED: Test corpus = user-provided PDFs (~/Downloads, ~/Documents, tests/fixtures/private) + sourced public-domain PDFs covering all cases in EN/FR/AR (tables, multi-column, CJK, forms, signed, scanned, real Arabic text).
- [2026-06-17] AGREED: Reframe — target is "100% fidelity to the honest promise", not "destroy every ceiling". Some ceilings are structural (no backend / format / subset-CID-font limits) → raise where reachable, honestly re-scope + graceful fallback where not.
- [2026-06-17] CONSTRAINT: Live browser sweep is serial (single Chrome); static discovery fans out. Phase 1 = hybrid.
- [2026-06-17] CONSTRAINT: Personal/RGPD/financial PDFs treated as opaque fixtures — contents never transcribed into reports/agent output.
- [2026-06-17] AGREED: Execution = Autonomous (Option 1) — converge internally, spawn fleet, run live sweep, build report; stop only for results / risky actions.
- [2026-06-17] NOTE: Prior autonomous run completed Phase-1 static discovery (6 raw files) but hung before synthesis/live-sweep (the ask-human-gate-blocks-background-continuations trap). Resumed inline (not as a background workflow) to avoid re-hanging.
- [2026-06-17] AGREED: Resume sequence = (1) fix P0 signature regression → (2) + P1 a11y fixes (signModal/ocrModal focus trap + Esc-close gaps) → (3) synthesize findings.md → (4) rerun live browser sweep.

## Known P0 (user-reported, 2026-06-17)
- **SIG-REGRESSION**: The DRAWN-signature tool (toolbar.sign — NOT the PKCS#12 e-sign / toolbar.signCert) loses the signature on Save — "when I click Save it resets". Must reproduce live + root-cause. Likely in the signature pad modal save handler or the command/persist path. First target of the live browser sweep + static bug agent.

## Formal Plan
<!-- written at Phase 4 approval -->
### Phase 1 — Discovery (hybrid)
- Static-discovery workflow (parallel agents, ≤5 concurrent), each writes raw → docs/reviews/qa-2026-06-17/raw/<dim>.md:
  - i18n: fr/ar value parity (untranslated / identical-to-EN / placeholder), hardcoded strings bypassing t(), Arabic quality flags
  - Discoverability/UX surface: enumerate every button/tool/modal; flag hidden-behind-flag, unlabeled, missing tooltip/aria, missing buttons for documented features
  - Missing features / stubs / deferred #xxb / unfulfilled promises (gaps-style)
  - Silent failures / contract violations / edge-case bugs (sleuth-style)
  - Accessibility (beyond axe gate): keyboard traps, focus order, ARIA, RTL
  - Fidelity-baseline reconciliation: verify scorecard "DONE" claims still hold; measure current gap
- Serial live browser sweep (/qa-sweep + manual): every control/modal/error/empty state, each corpus PDF rendered + exported, mobile/responsive.
- Output: docs/reviews/qa-2026-06-17/findings.md — severity-ranked (P0–P3), category-tagged.

### Phase 2 — Triage
- Merge Phase-1 findings + existing ceiling backlog. Classify each: Bug / Polish / Reachable-fidelity-gap / Structural-ceiling. Evidence-graded.

### Phase 3 — Fidelity sprints (depth, per feature)
- DOCX, Arabic export, element positioning, + top reachable gaps from triage. Each: baseline (scorecard) → research → prototype → real-browser test → re-measure.

## Baseline corpus (manifest)
<!-- built in Phase 1 setup: tests/fixtures/corpus.manifest.md -->
