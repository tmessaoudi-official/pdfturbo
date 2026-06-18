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
- [2026-06-18] DONE (autonomous, TDD, UNPUSHED): Option 1 `a2e1483` (A1 focus-trap 4 display modals via MutationObserver helper + A2 crop `P` shortcut + help row en/fr/ar); Option 2 `ad7790b` (N2 prune all-empty lattice CSV columns); Option 3 `9ffe072` (D1 = VERIFIED FALSE POSITIVE — pdf.js v6 pre-resolves Separation/spot → `setFillRGBColor(["#ff8000"])`, walker already captures it; added regression guard, no src change). Full suite green (1485 jsdom + browser guards). PUSHED by user.
- [2026-06-18] AGREED: Option 3 Arabic string review (`اقتصاص الصفحة`) = correct/idiomatic (matches MS/Adobe AR "Crop" convention) — no change. Option 2 residual backlog = implement ALL THREE batches, TDD, one commit per batch, push MANUAL: (a11y) A3 modeBadge `aria-live`, A4 toolbar submenu-trigger accessible-name, A5 progress-overlay empty `aria-label`; (robustness) B1 form-fill option-mismatch toast, B3 `fromJSON` id-guard vs NaN-poison; (i18n) I1 dead barcode placeholder, I2 unreferenced `toast.clickToPlaceImage`. Also: corrected stale findings.md rows A1/A2/N2 (shipped, were still "open").
- [2026-06-18] DONE: a11y batch A3/A4/A5 committed `05429a4` (UNPUSHED) — modeBadge `role=status aria-live=polite`, submenu trigger `aria-label/title=t('toolbar.submenuTrigger')` ("More tools" en/fr/ar), dropped empty `aria-label` on #progress-overlay. Guards: indexHtmlA11y.test.ts (A3/A5), toolbarCustomizer.test.ts (A4). Suite 1488+2xfail green. Batches 2&3 (B1/B3, I1/I2) PAUSED.
- [2026-06-18] PIVOT (user-directed): paused backlog batches 2&3; researched (2 Explore agents, file:line-grounded) + brainstormed user's new concerns. User chose to BUILD ALL FOUR features, sequenced F-A→F-B→F-C→F-D (see RESUME STATE "NEXT FEATURE QUEUE"): F-A mobile drag/draw (touch-action tool-mode-aware + setPointerCapture), F-B app version display+semver bump, F-C e-sign visual rect + embed drawn-signature PNG in appearance, F-D e-sign multi-signer = APPROVAL MODEL B (N visible drawn sigs + 1 sealing digital sig; true N-party crypto co-sign is a structural ceiling — pdf-lib full-resave, no incremental update). NOT started — user is compacting first. Confirm F-D UX before coding it.
- [2026-06-18] DONE (TDD, UNPUSHED): F-A `31c6c1f` (mobile drag/draw — `canvasCapturesGesture` + `setCanvasTouchAction` in toolModeService→setMode sets touch-action:none for draw/placement/crop, pan-x pan-y for select/editText/fillBucket; setPointerCapture in DrawingHandler; guards toolModeService.test.ts + mobile-touch-action.browser.test.ts). F-B `e7189bb` (version footer — Vite `define __APP_VERSION__` from package.json, appVersion.ts `typeof`-guarded fallback, #appVersion in footer, main.ts wiring; bump policy `npm version patch/minor`; verified prod build injects "1.0.0"; guard appVersion.test.ts). Suite 1514+2xfail green.
- [2026-06-18] DONE (TDD, UNPUSHED): F-C C1 `30a9d1d` (embed drawn-signature PNG in e-sign appearance: SignOptions.appearanceImage + async _drawAppearance drawImage; dataUrlToBytes threaded from app.currentSignature; sign-modal preview+Remove control; i18n×3 ar-unverified; guard appearanceImage.test.ts incl. full sign→image-XObject) + F-C C2 `1cb6539` (visual "Pick on page": geometry.displayRectToUserSpaceRect + new signRect ToolMode in DrawingHandler + beginSignRectPick/onSignRectPicked/_reopenSignModal + Esc safety; guards geometryUserSpace.test.ts + drawingHandlerSignRect.test.ts). Suite 1527+2xfail; build injects version; browser smoke+signing green.
- [2026-06-18] AGREED (F-D scope, AskUserQuestion + feasibility challenge): build BOTH Option 3 (editable "Lu et approuvé" mention + name/date caption per drawn signature) AND Option 2 (guided signers panel), PLUS a research/POC spike of true incremental-update multi-signing. Feasibility brief recorded: (Q1) automated remote multi-signer needs a backend → out of scope (privacy promise); round-robin file-passing works for VISIBLE sigs. (Q2) multiple VISIBLE sigs already work; multiple CRYPTO sigs blocked by pdf-lib FULL re-save (renumbers objects → invalidates prior /ByteRange) — same cert doesn't help; TRUE multi-crypto needs incremental-update (append-only) signing = a real engine (hand-rollable via byte-splicing like /Contents, but high-effort/high-risk: a bad xref silently invalidates ALL sigs). (Q3) "Lu et approuvé" caption = low risk. Correct model for a no-backend privacy tool = visible approval sigs + 1 optional crypto seal. Build order: D1 caption (SignatureElement.label/signer/date + render + EXPORT bake + tests) → D2 signers panel → D3 incremental-sign POC (research + prototype + honest verdict). Push MANUAL.
- [2026-06-18] DONE (TDD, UNPUSHED): F-D D1 `be58137` (approval caption on SignatureElement: optional signer/mention("Lu et approuvé")/signedDate + hasCaption/captionLines + pure buildSignatureCaptionLines; DOM render + EXPORT bake both reserve a bottom caption band, rotation-correct, ABSENT→byte-identical; factory restores, toJSON omits when unset = no schema bump; guard signatureCaption.test.ts). Suite 1535+2xfail; export branch-cov + real-Chrome renderer green.
  **F-D REMAINING (resume here):**
  - **D2 — guided signers panel (Option 2).** A panel/modal listing signer slots: each = name + editable mention (default "Lu et approuvé") + a "draw signature" step → places a captioned `SignatureElement` (D1 fields) on the page; repeat for N signers; then the existing single digital seal (🔏) seals all. Reuses: signatureManager/signaturePad (draw), placementManager (place SignatureElement — extend `new SignatureElement(...,{...caption})` at placementManager.ts:196 to thread caption), the ✍ flow. NEW: a signers-panel UI (mirror batesPanel/watermarkPanel modal pattern) + per-signer caption capture before placement. Thread caption into the placement path (currentSignature is just the PNG; need a parallel "pending caption" the placement reads). i18n×3 (ar unverified). Gate `VITE_FEATURE_*`? (reuse eSign flag or new). TDD: panel logic + placement-with-caption.
  - **D3 — incremental-update multi-sign POC (research + prototype + honest verdict).** Goal: prove/disprove TRUE N independent crypto signatures client-side via PDF incremental updates (append-only: keep original bytes verbatim, append sig dict + 2nd AcroForm field + incremental xref/trailer, byte-splice each /Contents — NOT pdf-lib full re-save which invalidates prior /ByteRange, pdfSigner.ts:96). Deliverable: a spike module + test signing twice and verifying BOTH /ByteRange ranges validate, OR a written verdict in docs/reviews/ explaining the exact blocker if it can't be done robustly. Do NOT remove the ALREADY_SIGNED guard in the shipped path until/unless the POC proves safe. High-risk: a bad xref silently invalidates ALL sigs.
- [2026-06-18] AGREED (F-D D2 design, AskUserQuestion): build **Approach A — guided wizard** (one signer at a time, re-invoke to add the next; the PAGE is the roster since each placed sig is already a selectable/deletable element). Rejected B (persistent roster panel — element↔roster desync) and C (caption fields on the pad — regresses the plain-✍ byte-identical path). Mechanism = a `pendingSignatureCaption` chokepoint on SignatureManager: panel sets it → `setMode('addSignature')` opens the pad → `commitPlacement` (placementManager.ts:196) reads/applies `{...caption}` then CLEARS it. Leak guard (worst-failure = plain sig inherits stale caption): plain ✍ click (toolBinder) + `S` shortcut (keyboardBinder) + pad-cancel (closeModal) all clear pendingCaption first → a plain signature can NEVER inherit a caption (provable invariant + explicit regression test). New `#signersModal` (mirrors batesPanel: own focus-trap/Esc/backdrop) + `#signersBtn` 👥 after ✍, gated by NEW `signers` feature flag (#28; main.ts removes when off). Date = today's ISO via a checkbox (free-text editable date = v1b ceiling).
- [2026-06-18] FEASIBILITY (user challenge — "signers not in same room, sign→export→pass to next?"): YES, remote round-robin VISIBLE approval signing works with ZERO extra code — D1 bakes each signature into page content on export; the next signer opens the exported PDF (baked sigs are immutable page content, not editable elements) and adds theirs; repeat. HONEST LIMITS surfaced to user + folded into the panel hint string: (1) visible ≠ cryptographic (approval-stamp grade, not tamper-evident); (2) the 🔏 crypto seal applies ONCE and must be LAST — any re-export after sealing invalidates it (ALREADY_SIGNED guard); true N-party crypto co-sign = the D3 ceiling; (3) between visible rounds the file is unprotected (inherent to any no-backend workflow). Panel will carry a one-line "sign → export → pass → seal last" note.
- [2026-06-18] DONE (TDD, UNPUSHED): **F-D D2** guided Signers panel (Approach A wizard). New `src/ui/signersPanel.ts` (pure `buildSignerCaption`/`isoDate` + `SignersPanel` open/draw/close, mirrors batesPanel) + 👥 `signersBtn` + `#signersModal` (index.html) gated by new `signers` feature flag (features.ts + main.ts removal). `pendingSignatureCaption` chokepoint on SignatureManager threaded through PlacementManager.commitPlacement (placementManager.ts:196 → `{...caption}`, consumed+cleared). Leak guard (plain ✍ toolBinder + `S` keyboardBinder + pad-cancel closeModal all clear pendingCaption) → plain signatures stay byte-identical (provable invariant). i18n×3 (10 keys; **ar [Unverified]**). Guards: signersPanel.test.ts (10), placementSignatureCaption.test.ts (2), keyboardBinder.test.ts (+3: signers-Esc + S-guard), signatureManager.test.ts (+1 closeModal clears), features.test.ts (+signers). Suite **1549 jsdom + 2 xfail**, browser 66, type-check+lint clean, build injects+wires signers. Remote round-robin works zero-extra-code (D1 bakes on export); honest limits in the panel hint. **D3 remains** (incremental-sign POC).
- [2026-06-18] AGREED (F-C UX, AskUserQuestion): (1) visual rect = "Pick on page" button IN the sign modal → temporarily hide modal, drag a box on the current page, reopen with X/Y/W/H prefilled (numeric inputs still authoritative). (2) signature image = AUTO-use the drawn signature (✍ `currentSignature`) with name/date text below, fall back to text-only when none; PLUS a delete/remove control in the sign modal so the user can drop the image (→ text-only) at any time. Build F-C as 2 commits: C1 image-embed (types.appearanceImage + async `_drawAppearance` drawImage + thread through signingHandler + modal sig-preview+remove + i18n×3 + tests), C2 pick-on-page rect (modal button + draw mode + display→content transform via geometry helpers + prefill + tests).

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

## RESUME STATE — compact checkpoint #4, 2026-06-18 (READ THIS FIRST on resume)

> ### Where we are
> - Option 1/2/3 (A1/A2/N2/D1) + a11y batch (A3/A4/A5) all DONE. Commits `a2e1483`, `ad7790b`,
>   `9ffe072`, `8b53d27` **PUSHED** (user confirmed). a11y batch `05429a4` = **UNPUSHED** (top of tree).
> - **PAUSED / deferred** (low-priority backlog, NOT abandoned): robustness B1 (form-fill option-mismatch
>   toast) + B3 (`fromJSON` id-guard vs NaN-poison); i18n cleanup I1 (dead barcode placeholder) + I2
>   (unreferenced `toast.clickToPlaceImage`). Resume these only if the user asks.
> - **PUSH IS MANUAL — never push autonomously.** Commits in /stack/projects allowed; ask before pushing.
>
> ### NEXT FEATURE QUEUE — user chose ALL FOUR (2026-06-18 brainstorm), build in this order. NOT yet started.
> Each is TDD-first (write/extend the failing test, then implement); `npm run type-check && npm run lint &&
> npm run test` (+ `npm run test:browser` for any pointer/canvas/export change) before each commit. One
> commit per feature. Research below is grounded — file:line verified by two Explore agents 2026-06-18.
>
> **F-A — Mobile drag + "can only place, can't draw" (do FIRST, highest user-pain).**
>   ROOT CAUSE (Verified): `src/ui/binders/navigationBinder.ts:87` sets `canvas.style.touchAction='pan-x pan-y'`
>   → browser claims single-finger drag for scroll BEFORE `pointerdown` handlers run; `e.preventDefault()`
>   (`drawingHandler.ts:81`) is too late. Corroborating: `DrawingHandler` never `setPointerCapture()`s (but
>   `inkLayerHandler.ts:38` does); `addText` has no touch drag-threshold buffer (element-drag works because
>   `interactionHandler.ts:61-71` does). FIX DIRECTION: make `touch-action` **tool-mode-aware** — `none` while a
>   draw/placement/ink tool is active (canvas owns the gesture), `pan-x pan-y` in select/idle; add
>   `setPointerCapture` to DrawingHandler. Trade-off ACCEPTED by user (implicitly via "build it"): tool active ⇒
>   canvas drag draws, doesn't scroll (scroll via thumbnail panel / select mode). Verify on real-Chrome harness +
>   a touch-emulation test. Missing `touch-action:none` surfaces: `#pdfCanvas`, `.canvas-container`, dynamic drawPreview SVG.
>
> **F-B — App version display + bump (quick win, do SECOND).**
>   Today: `package.json` version=`1.0.0`, shown NOWHERE; app `<footer>` at `index.html:206` is the home.
>   DIRECTION: Vite `define` `__APP_VERSION__` (read package.json) in `vite.config.ts` → render in footer
>   (optional + git short-SHA / build date). Bump policy: semver — patch=fix, minor=feature (manual `npm version`
>   or a tiny release step). Add a TS ambient decl for `__APP_VERSION__`. Guard: a jsdom test asserting the footer
>   shows a semver string.
>
> **F-C — E-sign visual rect + real signature image (do THIRD, medium).**
>   Q2b (visual rect): rect is ALREADY editable via 4 numeric inputs X/Y/W/H (`index.html:554`), bounds-validated
>   (`src/signing/appearance.ts:23` validateRect). MISSING = visual placement. SEAM: `DrawingHandler` ALREADY has an
>   `addSignature` drag-rect preview (`drawingHandler.ts:460`) → add a "draw box on page → prefill the modal X/Y/W/H"
>   flow. Q2c (real signature image): digital sig currently draws TEXT+border only (`src/signing/pdfSigner.ts:148`
>   `_drawAppearance`, no image). App already captures drawn signature as PNG (`signaturePad.ts:54 getDataURL`) +
>   embeds PNG (`pdfElementRenderer.ts:145 renderSignature`). SEAM: add `appearanceImage?: Uint8Array` to `SignOptions`,
>   make `_drawAppearance` async + `await doc.embedPng(...)` into the rect; thread the PNG from `signatureManager.currentSignature`
>   through `signingHandler` → `buildSignOptions`. Caveat (state to user): appearance is a viewer aid, covered by the
>   page ByteRange like any content — fine, not separately bound.
>
> **F-D — E-sign multi-signer = APPROVAL MODEL B (do LAST, design-confirm with user first).**
>   TRUE N-party crypto co-signing is a STRUCTURAL CEILING (Verified): `@cantoo/pdf-lib` does a FULL re-save
>   (`pdfSigner.ts:96 doc.save({useObjectStreams:false})`), not an incremental-update append → a 2nd signature
>   rewrites byte offsets and invalidates the 1st signature's `/ByteRange`; re-sign is REFUSED today via
>   `isPdfSigned()` (`pdfSigner.ts:56`) + `ALREADY_SIGNED` preflight (`pdfSigner.ts:118`). MODEL B (reachable, what
>   the user picked): N **visible drawn signatures** (one per person, the ✍ tool already exists) + **ONE** sealing
>   digital signature applied last. Build = a multi-slot drawn-signature flow; the existing single e-sign seals the
>   result. Do NOT remove the ALREADY_SIGNED guard. Confirm exact UX with user before coding (Phase 4 gate).
>
> --- (historical below: the now-completed Option 1/2/3 + QA sweep spec) ---

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
