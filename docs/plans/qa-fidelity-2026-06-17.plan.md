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

---

## RESUME STATE — compact checkpoint 2026-06-17/18 (READ THIS FIRST on resume)

### Commits made this session (ALL UNPUSHED — push is MANUAL)
- `e1dedda` fix: drawn-signature reset-on-Save P0 + modal a11y (focus traps + Esc-close). VERIFIED LIVE.
- `17a7fb7` docs(qa): findings.md + raw/ + this plan + 4 small corpus fixtures. arxiv (5.1MB) gitignored.
- (`5b8872d` #60 compress was already committed+pushed before this session.)
- Working tree after those commits: was clean except the in-progress edits below.

### DONE + VERIFIED LIVE (Playwright real Chrome, dev :5174) — 0 app console errors
- F1 P0 signature: Save keeps pad, places element (0→1). F2/F3 sign+ocr focus traps (Tab-wrap, Esc, focus-return). F4 Esc-close all 8 modals.
- #60 compress lossless (66887→52592B), #56 table-CSV (lattice), OCR visible (+91 els), DOCX (CJK, valid zip), e-Sign generate-cert (valid /ByteRange+pkcs7 signed PDF), empty-state, responsive@375, restore-dialog.
- N1 FIXED: regenerated valid borderless `data-tables.pdf` (was corrupt HTML); loads 1pg, 0 err.
- Full results table + N1/N2/N3 findings: `docs/reviews/qa-2026-06-17/findings.md`.

### IN PROGRESS when compacted — deferred Option-2 live items (user wants: #57 → #62 → Arabic)
- **#57 XFDF round-trip (mid-test):** browser has `data-tables.pdf` loaded (1pg) + **1 highlight element** just drawn via the highlight tool. NEXT STEPS:
  1. Open export flyout (`#exportChevronBtn`) → click `#exportXfdfBtn`; read `window.__caps` for the .xfdf download; `fetch(href)` the XFDF text; assert it contains `<highlight`.
  2. Re-import: reparent+show `#xfdfInput` (hidden file input), upload the saved XFDF (write blob to a tmp file first, or test parseXfdf), assert a highlight element is recreated on the page.
- **#62 flatten:** corpus has NO AcroForm PDF. Either generate one with `@cantoo/pdf-lib` (form.createTextField) like the data-tables generator, OR just confirm `#flattenBtn` produces a valid PDF (form.flatten() no-op without a form). Covered by jsdom `flatten.test`.
- **Arabic overlay:** no Arabic fixture. Add Arabic text via the addText tool (split-button default), export PDF, assert the Noto-Naskh overlay renders multi-glyph ink width (the arabicOverlay path). Covered by `arabic-overlay.browser.test`.

### Browser/env state (Playwright session — may be stale after compact; re-establish if so)
- Dev server: `npm run dev` on **:5174** (stale one also on :5173). If down: `npm run dev &` then use :5174.
- Download-capture technique (reused all session): in page, `delete window.showSaveFilePicker` (force anchor path — FS-Access picker has no UI under Playwright), `URL.revokeObjectURL=()=>{}` (keep blobs fetchable), hook `HTMLAnchorElement.prototype.click` to push `{name,href}` into `window.__caps`, then `fetch(href)` to inspect bytes.
- Load a PDF: reparent `#fileInput` to body + `style.cssText='position:fixed;...;display:block'` (offsetParent is null for fixed — element IS visible), `browser_click('#fileInput')` opens chooser, `browser_file_upload([path])`.
- Clear persisted session (avoid restore-dialog intercepting clicks): delete IndexedDB `keyval-store` + `pdf-editor`, then reload.
- Corpus valid fixtures: `tests/fixtures/corpus-public/{w3c-accessible-table,sample-tables-lattice,japanese-cjk,data-tables}.pdf` (+ gitignored arxiv-multicol-japanese.pdf, 5.1MB, local only).

### Resume sequence on next session
1. Re-verify tree state: `git log --oneline -3` (expect 17a7fb7, e1dedda, 5b8872d), `git status`.
2. Finish #57 XFDF round-trip (steps above), then #62 flatten, then Arabic overlay.
3. Update findings.md "Not exercised live" section as each completes.
4. Optionally commit any new fixtures/findings; PUSH IS MANUAL — never push autonomously.
5. Trap to avoid: the prior autonomous run hung on the ask-human-gate-in-background; run the sweep INLINE, not as a background workflow.
