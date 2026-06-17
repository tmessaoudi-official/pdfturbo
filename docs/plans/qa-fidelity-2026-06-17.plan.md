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
- [2026-06-18] AGREED: QA sweep COMPLETE + pushed (`bbd919c`); next work queue = Option 1 (A1 modal focus-traps + A2 crop `P` shortcut) → Option 2 (N2 lattice-CSV empty columns) → Option 3 (D1 DOCX spot-color). TDD each; push stays MANUAL. Anchors in "NEXT WORK QUEUE" below.
- [2026-06-18] DONE (autonomous, TDD, UNPUSHED): Option 1 `a2e1483` (A1 focus-trap 4 display modals via MutationObserver helper + A2 crop `P` shortcut + help row en/fr/ar); Option 2 `ad7790b` (N2 prune all-empty lattice CSV columns); Option 3 `9ffe072` (D1 = VERIFIED FALSE POSITIVE — pdf.js v6 pre-resolves Separation/spot → `setFillRGBColor(["#ff8000"])`, walker already captures it; added regression guard, no src change). Full suite green (1485 jsdom + browser guards). PUSH STILL MANUAL.

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

## RESUME STATE — compact checkpoint #3, 2026-06-18 (READ THIS FIRST on resume)

> The QA sweep AND the follow-up queue (Option 1/2/3) are **DONE**. Option-1/2/3 commits are
> **UNPUSHED** (`a2e1483`, `ad7790b`, `9ffe072` on top of pushed `bbd919c`). Push is MANUAL —
> ask the user. There is no committed open work item left from this plan; the remaining backlog
> is the lower-priority findings.md rows (A6/A7/I1/I2 P3 polish, D2/D5/D7 reachable-low-ROI,
> D3/D4/D6 ceilings). Nothing queued — await user direction.
>
> --- (historical: the NEXT WORK QUEUE below was the now-completed Option 1/2/3 spec) ---

> The QA discovery+triage+live-verify sweep is **COMPLETE and PUSHED**. The work below is the
> NEXT queue the user chose: **Option 1 (A1 + A2) → Option 2 (N2) → Option 3 (D1)**. Start at A1.

### Commits (user confirmed PUSHED — deployed via GitHub Pages)
- `bbd919c` docs(qa): live-verify deferred items #57 XFDF / #62 flatten / Arabic overlay.
- `17a7fb7` docs(qa): findings.md + raw/ + plan + 4 small corpus fixtures (arxiv 5.1MB gitignored).
- `e1dedda` fix: drawn-signature reset-on-Save P0 + modal a11y (focus traps + Esc-close).
- (`5b8872d` #60 compress — earlier.)
- Tree is CLEAN. No `src/` changed in the resume sweep (verification only).

### DONE + VERIFIED LIVE (Playwright real Chrome, dev :5174) — 0 app console errors
- F1 P0 signature: Save keeps pad, places element (0→1). F2/F3 sign+ocr focus traps (Tab-wrap, Esc, focus-return). F4 Esc-close all 8 modals.
- #60 compress lossless (66887→52592B), #56 table-CSV (lattice), OCR visible (+91 els), DOCX (CJK, valid zip), e-Sign generate-cert (valid /ByteRange+pkcs7 signed PDF), empty-state, responsive@375, restore-dialog.
- N1 FIXED: regenerated valid borderless `data-tables.pdf` (was corrupt HTML); loads 1pg, 0 err.
- Full results table + N1/N2/N3 findings: `docs/reviews/qa-2026-06-17/findings.md`.

### Deferred Option-2 live items — ALL DONE (resume sweep, in `bbd919c`)
#57 XFDF export→import round-trip (recreated at identical coords), #62 flatten (valid %PDF-1.7),
Arabic overlay (downloadPDF embeds Noto Naskh Type0/CIDFont). Live results table in findings.md.

### NEXT WORK QUEUE — user-chosen sequence: Option 1 (A1+A2) → Option 2 (N2) → Option 3 (D1)
Each is TDD: write/extend the test first, then implement. `npm run type-check && npm run lint && npm run test`
before any commit (CI parity). Push is MANUAL.

**Option 1 — P2 a11y batch (do FIRST):**
- **A1 — focus-trap the 4 display-toggled modals** (blankPage / extractPages / pdfPassword / lockPdf).
  Esc already closes them (F4). They still let Tab escape to the toolbar.
  PATTERN to replicate: `openSignModal`/`closeSignModal` in `src/core/pdfTurboApp.ts:652-672` and
  `openOcrModal`/`closeOcrModal` (`:604-618`) — on open: `_focusTrapService.getCleanup()?.()` then
  `setCleanup(trapFocus(<modalContentEl>, <triggerBtn>))`; on close: `getCleanup()?.()` + `setCleanup(null)`.
  ACTION: find where each of the 4 modals is shown (search `style.display = 'flex'` / their open path in
  `src/ui/binders/modalBinder.ts` + `documentLoader.openBlankPageModal`) and their Cancel/close path, and
  wrap with `trapFocus` the same way. Guard: extend `tests/ui/keyboardBinder.test.ts` or a focus-trap test.
  Beware `keyboardBinder` Esc already clicks their Cancel — keep that working (don't double-close).
- **A2 — crop "(P)" shortcut mismatch**. `index.html:74` advertises `title="Crop page (P)"` but no `P`
  handler exists; help table omits crop. DECISION (recommend ADD the handler — advertised shortcut should
  work; `p` is currently UNBOUND): add `case 'p': case 'P':` to the single-key `switch` in
  `src/ui/binders/keyboardBinder.ts:56`, mirroring the click toggle in `toolBinder.ts:44-46`
  (`if (!app.ui.cropBtn.disabled) app.setMode(app.mode === 'crop' ? 'select' : 'crop')`), gated by
  `isEnabled('crop')`. Also add a crop row to the help/shortcuts table. Guard: keyboardBinder test case.

**Option 2 — N2 lattice-CSV spurious empty columns:**
- `src/utils/tableExtract.ts`: `buildTableGrid` (`:55`) builds `colBounds` from `clusterPositions(vRules center x, tol)` (`:62`).
  V-rule over-detection yields empty interstitial cols (`,,`). FIX (safe, targeted): post-filter columns
  that are empty across ALL rows before `gridToCsv` (`:93`), OR widen the column-cluster tol / merge near-
  adjacent bounds. Pure functions → extend `tests/utils/tableExtract.test.ts` with a `,,`-repro first.

**Option 3 — D1 DOCX spot/Separation color black-collapse (fidelity, heavier):**
- DOCX text-run color collapses spot/Separation `scn` to black on export. NOTE: `fillOpToHex` already
  exists in `src/utils/flowDoc.ts:943` (normalizes RGB/Gray/CMYK/Separation/spot → `#rrggbb`) and the
  true-edit twin is DONE (`resolveRedrawColor`). INVESTIGATE FIRST: which op-walk feeds DOCX *run* color —
  confirm it calls `fillOpToHex` for the text-fill (`scn`/`sc`) op, not just the rules path. The gap is
  likely that the run-color path doesn't track `setFillColorN`. Guard: `tests/utils/flowDoc*` + a
  `docx-color.browser.test.ts` extension.

### Browser/env state (Playwright session — may be stale after compact; re-establish if so)
- Dev server: `npm run dev` on **:5174** (stale one also on :5173). If down: `npm run dev &` then use :5174.
- Download-capture technique (reused all session): in page, `delete window.showSaveFilePicker` (force anchor path — FS-Access picker has no UI under Playwright), `URL.revokeObjectURL=()=>{}` (keep blobs fetchable), hook `HTMLAnchorElement.prototype.click` to push `{name,href}` into `window.__caps`, then `fetch(href)` to inspect bytes.
- Load a PDF: reparent `#fileInput` to body + `style.cssText='position:fixed;...;display:block'` (offsetParent is null for fixed — element IS visible), `browser_click('#fileInput')` opens chooser, `browser_file_upload([path])`.
- Clear persisted session (avoid restore-dialog intercepting clicks): delete IndexedDB `keyval-store` + `pdf-editor`, then reload.
- Corpus valid fixtures: `tests/fixtures/corpus-public/{w3c-accessible-table,sample-tables-lattice,japanese-cjk,data-tables}.pdf` (+ gitignored arxiv-multicol-japanese.pdf, 5.1MB, local only).

### Resume sequence on next session
1. Re-verify tree state: `git log --oneline -4` (top should be `bbd919c`), `git status` (clean).
2. Start **Option 1 / A1** (modal focus traps), then **A2** (crop `P` shortcut), then **Option 2 / N2**
   (CSV columns), then **Option 3 / D1** (DOCX spot color). TDD each; type-check+lint+test before commit.
3. Update `docs/reviews/qa-2026-06-17/findings.md` (mark A1/A2/N2/D1 fixed) as each lands.
4. PUSH IS MANUAL — never push autonomously. Commits in /stack/projects are allowed but ask before pushing.
5. Trap to avoid: a prior autonomous run hung on the ask-human-gate firing inside a background
   continuation — run this work INLINE, not as a background workflow. (memory: project_ask_human_gate_background_loop)
