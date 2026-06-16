# PDFturbo — Unified Master Plan (2026-06-16)

**Supersedes as the single forward plan**: `mega-roadmap-2026-06-14.plan.md` (Sprints 0–4 + Arabic
DONE — kept as history), `blockers-fixes.plan.md` + `blockers-to-100.plan.md` (batch DONE — history).
This file merges **everything still open** from: `/forge` report `2026-06-16-0103.md` (18 design
findings), `/inspect --vision` report `2026-06-16-0129.md` (1 P0 / 13 P1 / 40 P2 / 28 P3 + 83 vision
proposals), the two fidelity scorecards, `2026-06-15-ceiling-challenge.md`, `2026-06-15-new-ideas.md`,
and `research-2026-06-15-blockers/CONSOLIDATED.md`.

**Honest headline** *(both fresh analyses agree)*: there is **no active data-loss or exploit bug**. The
codebase is disciplined — no secrets, real CSP, i18n escaping on, sound signing crypto, 0 TODO debt,
locales key-identical, `tsc --noUnusedLocals` clean. The lone P0 is a **coverage gap** (the export-render
path has zero direct tests), not a defect. The real work is **reliability hardening + architecture-debt
paydown + the queued feature/ceiling backlog**. Nothing below is an emergency; M0 is the highest leverage.

**Run constraints** (carried from the prior plans — do not relitigate):
- Local binaries only: `./node_modules/.bin/{tsc,oxlint,vitest}`. Browser: `vitest run --config vitest.browser.config.ts`. (PATH versions are rtk-proxied → bogus output.)
- Full gate before every commit: `tsc --noEmit` · `oxlint .` (0/0) · `npm run test` (jsdom) · `test:browser` (real Chrome). CI runs all of them; push-to-master auto-deploys with **no PR gate**.
- `git push` is **MANUAL**. Commits = thematic `feat:`/`fix:`/`refactor:`/`docs:`. **NO Co-Authored-By** (history is published).
- **NEVER** read/print/commit the private PDFs in `tests/fixtures/private/*` — structural metrics only. `test-document.pdf` + `tests/fixtures/qa-*.pdf` are the safe fixtures.
- Every behavior change is **TDD**: failing test first (jsdom or browser harness), then implement. Browser-layer behavior (canvas/pointer/rasterize) is NOT covered by jsdom — use the browser harness.

---

## Decisions Log
- [2026-06-16] AGREED: Synthesize ONE unified plan from forge + inspect/vision + roadmap/ceiling/scorecards/blockers/new-ideas; present ALL findings de-duplicated; recommend a start; drop nothing without a stated reason. (user) Run mode = **fully autonomous** (3C suppressed; risky/destructive actions still pause). (AskUserQuestion)
- [2026-06-16] DECISION: Collapse items flagged by BOTH forge and inspect into single tracked items (error boundary, SavedState versioning, ocr/signing↔IAppContext, the giant-function decompositions, signPdf orchestration) — see the cross-reference column in each milestone.
- [2026-06-16] AGREED: Implementation order = **all of M0 (reliability, 12 items) then M1 (close the P0, 5 items)**, run **autonomously** (no per-item gate), TDD each, thematic commit per item/theme, full gate green before each commit, push MANUAL. Start = M0 #1 (global error boundary + #41 ring-buffer logger). User compacts first, then I begin. (AskUserQuestion)
- [2026-06-16] DONE: **M0 fully complete (12 items + #41 keystone)**, each TDD'd, full gate (tsc·oxlint 0/0·jsdom·browser) green before each commit, push left MANUAL. Commits: #1+#41 `2cb4122`, #2 `3b81437`, #3 `f4b83f0`, #7+#8 `d7edee0`, #4 `7a7c603`, #5 `1c32054`, #6 `a2b0bd6`, #11+#12 `19f5886`, #9 `b72d11f`, #10 `c194889` (+ plan `5f892a6`). Note: #12 was already implemented (sessionManager already toasts storageFull) → added a regression test.
- [2026-06-16] DONE: **M1 P0-closing deliverables complete** — #13 pixel-region browser tests for `renderElementToPdfLib` (redaction opacity / highlight hue / image bbox / rotation anchor) `a2173a0` **← closes the lone P0**; #14 CI coverage gate on the export render path (browser-config v8 thresholds, verified fails@0%/passes@~51%) `f088ca5`; #15 signing error-path tests (loadP12 WRONG_PASSPHRASE/INVALID_P12; ALREADY_SIGNED etc. already in preflight.test.ts) `f224ab4`; #16 core-cluster tests (hitTest geometry + signatureManager; sessionManager+pageRenderPipeline done in M0) `8a1660d`. Full gate green at every commit; push MANUAL.
- [2026-06-16] DEFERRED: **#17 / #23 (polymorphic `renderToPdf` refactor) → M2.** Reason: its stated purpose (de-risk the P0 surface as it's tested) is already achieved by #13+#14; #23 is a large, invasive, behavior-neutral refactor (8 element-type branches + shared `tp`/`anchorForCenter`/`swapDims` helpers → ~9 element classes) that adds regression risk without adding P0 protection when run at the tail of a long autonomous session. Build it as a focused M2 effort, guarded by the now-existing #13 pixel tests. NEXT = M2 (start #18 IAppContext for ocr/signing → #19/#20 sign refactor → #21/#22 decompositions → #23 with the #13 guard).
- [2026-06-16] AGREED: M0+M1-P0 (17 commits) **pushed**. Proceed with **M2 architecture-debt paydown, fully autonomous** (3C/per-item gates suppressed; risky/destructive actions still pause): #18 → #19/#20 → #21/#22 → #23, TDD each, thematic commit per item, full gate green per commit, push MANUAL. (AskUserQuestion)
- [2026-06-16] AGREED: **#23 implementation = Option A + coverage win** (NOT the plan's literal element-class polymorphism). Rationale (challenged + verified): `elements/*` have ZERO pdf-lib coupling today (grep-verified) — moving render branches into element classes would invert the Stable-Dependencies direction (stable domain → volatile pdf-lib/fontkit/arabicOverlay leaf), break SRP, and drag pdf-lib into element unit tests; with TWO output formats (PDF + DOCX/MD) the visitor/strategy shape (per-adapter dispatch) is correct, not per-type methods. So: split the 8-branch `renderElementToPdfLib` into named per-type renderers dispatched by a `Record<ElementType, renderFn>` map IN THE EXPORT LAYER (elements stay pdf-lib-free), AND add unit tests for the branches #13 doesn't cover (shape arrow/ellipse/freehand, comment text, Arabic text path) so the refactor is a net testability gain, not churn. Behavior-neutral; #13 pixel tests + browser suite guard it. (AskUserQuestion — user picked Option 1; user compacts first, then I continue.)
- [2026-06-16] DONE: **#23 — `renderElementToPdfLib` → `Record<ElementType, renderFn>` dispatch (Option A)** `41590b8`. 8-branch if/else split into named per-type renderers (renderText/Signature/Image/Code/Highlight/Shape/Comment/Redaction); shared geometry (tp/swapDims/elemRot/pdfRotVal/anchorForCenter/Ho) computed once → `RenderHelpers`. pdf-lib coupling stays in export layer; `elements/*` untouched. `Record<ElementType,…>` typing = compile-time coverage of every element type. Behavior-neutral (transcribed verbatim; fn returns dispatch promise, callers await). Coverage win: +6 jsdom characterization tests (arrow/ellipse/freehand/comment/empty-text-noop/dispatch-exhaustiveness via recording mock page) + 1 browser test (Arabic text → shaped RTL overlay), all verified green BEFORE the extraction. Gate: tsc 0, oxlint 0/0, jsdom 1153+2xfail, browser 41. **M2 (arch-debt #18-#23) COMPLETE.**
- [2026-06-16] DONE: **#22 — _extractFlowDoc op-walk → pure `src/export/opStreamWalker.ts` walkPageOps** `69b7dbd`. ~190-line inline pdf.js op-walk split pure/impure: walkPageOps returns {colorMap, rules, images:[{name,ctm}]} (no DOM); `_rasterizeImagePlacement` holds the canvas/page.objs rasterization. `_extractFlowDoc` ~260L→~95L. Behavior-neutral (render-gate `includes`→`images.length>0`; `continue`→`return null`); all export + issue3 browser tests green. +5 walkPageOps unit tests. Gate green.
- [2026-06-16] DONE: **#21 — reconstructColumn decomposed into pure stages** `0c77564`. ~290L → 4 fns (clusterWordsIntoLines / groupLinesIntoParagraphs / buildParagraph / mergeListContinuations) + module-level indentTolerance; orchestrator ~20L. Word/Line + first 2 stages exported. Behavior-neutral (reconstructColumn/reconstructPage + all docx/md tests green); +6 property tests. Gate green.
- [2026-06-16] DONE: **#20 — generate-cert sign refs registered in AppDOMRefs** `a2e1d07`. 10 ids (signSourceUpload/Generate, signUploadGroup/Group, signGen{Password,CN,Org,Email,Country,Validity}) queried once at construction; 11 raw `getElementById` casts in openSignModal/closeSignModal/signPdf replaced with `this.ui.<ref>`. Behavior-neutral. Gate green (tsc·oxlint·jsdom·browser).
- [2026-06-16] DONE: **#19 — signPdf orchestration → SigningHandler.runSignFlow** `dfbe86b`. ~107-line flow moved whole into the handler; `app.signPdf()` = 1-line delegator. ISigningContext expanded to {currentFilename, ui, reportError, assemblePdfBytes, closeSignModal}; `_showSignError`/`_downloadBytes` moved with it. Now jsdom-testable: +6 runSignFlow tests (guards / S-FLOW preflight bail / generate→download→sign→close→toast). **Divergence from plan wording**: kept `preflight.test.ts` testing `PdfSigner.preflight` directly (Chesterton — re-pointing at the handler would only add DOM/crypto mocks to test the same signer contract); added handler-level orchestration tests instead. Gate green.
- [2026-06-16] DONE: **#18 — ocr/signing handlers narrowed to role-interfaces** `9eb10c0`. `OcrHandler`→`IOcrContext`, `SigningHandler`→`ISigningContext` (mirrors `ISignatureContext` precedent); PDFTurboApp satisfies both structurally, instantiation sites unchanged; behavior-neutral. New tests build fully-typed narrow mocks (no `as unknown as PDFTurboApp`). Gate green (tsc·oxlint 0/0·jsdom 88f/1130+2xfail·browser 18f/40).

---

- [2026-06-16] AGREED: After surveying M3–M7, next milestone = **M3 security batch (#31–#34)** — four S-effort items landed as one TDD effort, one thematic commit per item, full gate green per commit, push MANUAL. Order: #31 SHA-pin OCR traineddata → #32 CSP base-uri/form-action → #33 zero p12 key object + scrub passphrase on parse-error → #34 untrusted-PDF input caps + isEvalSupported:false. #35 accessibility deferred to its own effort. (AskUserQuestion) Note: M4 #41 ring-buffer logger already shipped in M0 (`2cb4122`) — table row is stale.
- [2026-06-16] DONE: **M3 security batch #31–#34 SHIPPED** (4 unpushed thematic commits; each TDD'd, full gate green tsc·oxlint 0/0·jsdom·browser per commit, push MANUAL):
  - **#32 `a68c6c8`** — CSP `base-uri 'none'` + `form-action 'none'` in index.html. Guard: `tests/security/csp.test.ts`.
  - **#31 `062acf6`** — SHA-256-pin all 8 OCR traineddata downloads (`prepare-ocr-assets.mjs`): committed digest map, verify each download before persist + re-verify cached copies each run, `main()` guarded behind is-main so importing pulls no network. Hashes computed authoritatively (3 local copies matched CDN byte-for-byte; 5 downloaded+verified end-to-end). Guard: `tests/ocr/ocrAssets.test.ts`.
  - **#34 `092bb20`** — untrusted-PDF input caps in `documentLoader.load`: `MAX_PDF_BYTES`=500 MB (refuse before read), `MAX_PDF_PAGES`=10000 (refuse before per-page alloc; `loadingTask.destroy()`), toasts fileTooLarge/tooManyPages (EN/FR/AR). Guard: `tests/ui/documentLoaderCaps.test.ts`. **FINDING (verified, non-obvious): `isEvalSupported:false` is OBSOLETE on pdf.js v6.0.227** — the option AND the eval-based font/PostScript compiler it gated were removed (no `new Function`/eval surface; the only `new Function` grep hit is the substring `FunctionBasedShading`; CSP omits 'unsafe-eval' regardless). It also doesn't type-check against v6 `DocumentInitParameters`. So NOT shipped — documented in `load()` instead of an ineffective no-op.
  - **#33 `cc7491f`** — `scrubForgeKey`/`scrubP12Material` (`p12.ts`): overwrite each jsbn BigInteger `.data` digit array in place + null fields. Signer scrubs in a `finally`; `generateSelfSignedP12` scrubs once packaged. Passphrase (immutable JS string) can't be scrubbed → documented; container bytes already zeroed on every path incl. parse-error by the handler. Guard: `tests/signing/scrubP12.test.ts` + existing sign/cert round-trips prove signing still works.
  - **NEXT: M3 #35 accessibility** (its own M–L effort), or pick another milestone. M0/M1-P0/M2/M3-batch all DONE.
- [2026-06-16] AGREED: M3-batch #31–#34 **pushed** (origin clean). Next = **M3 #35 accessibility sweep** — scope by investigation first, then TDD the concrete sub-items, one thematic commit per coherent area, full gate green per commit, push MANUAL. Autonomous mode (per-item gates suppressed; risky actions still pause). (AskUserQuestion: user pushed + chose Option 2.)
- [2026-06-16] AGREED: After challenge/sequencing discussion, next = **Wave 1 "Lock down"** (cheap hygiene + safety net), autonomous-TDD, thematic commit per item, full gate green, push MANUAL. Order: #40 pre-push hook + .nvmrc/engines → #42 remove dead InkColorCmd/barrel → #43 naming (_autosave→autosave, toolModeManager→…Service) → #38 stale CLAUDE.md anchors → #39 README/CONTRIBUTING → #45 CI npm-audit docs → #37 CVE/supply-chain ownership. Demand-gated (M7/#36/#55) + premature-perf (M5 L-items) deferred until a trigger fires. (AskUserQuestion: user picked "Wave 1: Lock down".)
- [2026-06-16] AGREED (next-work, user compacts first then I continue): do **both** M4 #44 and Wave 2 features — order = **#44 determinate progress indicators FIRST** (finishes M4; builds a reusable determinate-progress component the longer Wave 2 ops can reuse), **THEN Wave 2** in ROI order: #53 sanitize/metadata-scrub (spike first) → #54 File System Access → #59 merge/split (audit PageService first) → #56 table→CSV/XLSX. Autonomous-TDD, thematic commit per item, full gate green, push MANUAL. (AskUserQuestion: user said "do 1 and 2, prioritize"; my recommended order — adjustable on resume.)
- [2026-06-16] DONE: **Wave 1 "Lock down" COMPLETE** — #40 pre-push gate `757120a`, #42 dead InkColorCmd `4442bac`, #38/#45/#37 CLAUDE.md+CI/supply-chain docs `e97d361`, #39 README/CONTRIBUTING `4e24c53`, #43 naming `b8e7927`. Each full-gate green. **8 commits UNPUSHED** (aab923d #35 + 631a8ab + 757120a + 4442bac + e97d361 + 4e24c53 + b8e7927 + this docs commit). M4 remaining: only #44 (determinate progress indicators, M) + #41 (logger, already done in M0). NEXT: Wave 2 features (M6 #53 sanitize → #54 FS Access → #59 merge/split → #56 table→CSV) or pick another.
- [2026-06-16] AGREED: #43 done **in full** (user chose this over my recommendation to skip): `_autosave`→`autosave` (~60 sites incl. 4 role-interfaces + handlers + test mocks/assertions; pdfTurboApp delegator merged to avoid recursion) AND `toolModeManager`→`toolModeService` (file+class+27 sites). Behavior-neutral; full gate green. (AskUserQuestion)
- [2026-06-16] DONE: **M4 #44 — determinate progress bar `efbdc85`.** `ProgressManager.setFraction(0..1|null)` renders a `<progress>` bar (hides spinner)/reverts on null/resets on hide; bar is an optional 3rd ctor arg → 8 existing 2-arg `begin()` sites untouched. `downloadPDF`→`_assemblePdfDoc(onPage?)` drives per-page progress; sign path (`assemblePdfBytes`) omits it. OCR (modal bar) + sign (single-shot compute, in-modal busy row) already contextual — left as-is, NOT faked. +6 jsdom tests. Reusable for Wave 2 page-loop ops. Gate green. **M4 COMPLETE** (only #41 remained, already shipped in M0).
- [2026-06-16] AGREED: Side-quest before Wave 2 — **extract the ~990-line inline `<style>` block from `index.html` into plain modern CSS** under `src/styles/` (split base/toolbar/modals/overlay/…), imported via Vite. Challenged + chosen: **NO SCSS** (native CSS vars+nesting cover it; avoid `sass` dep); **NO HTML componentization** (no component model exists — framework=rewrite, partials=marginal; deferred unless concrete pain); inline `style=` toggle attrs left as-is (stateful); CSP `'unsafe-inline'` stays (full purge deferred). Behavior/visual-neutral; verify via build + parity. (AskUserQuestion: user picked "Extract CSS → plain modern CSS".)
- [2026-06-16] DONE: **CSS extraction `7e980ae`** — index.html 1630→640; ~990 CSS lines → `src/styles/{base,overlay,responsive,editor,pdf-layers,modals}.css` + ordered `@import` barrel in `main.ts`; byte-identical cascade (whitespace-normalized parity diff: zero rule changes); Vite bundles 33.4 KB hashed + PWA precaches it. Full gate green.
- [2026-06-16] DONE: **Wave 2 #53 sanitize/metadata-scrub (core)** — `src/utils/pdfSanitizer.ts` `sanitizePdf(bytes)→{bytes,report}` `e7a9c2f` (3 jsdom) + 🧹 export-flyout `sanitizeAndDownload()` `0b6578d` (real-Chrome e2e). Strips `/Info`/XMP/`/OpenAction`/`/AA`(catalog+pages)/doc-JS/EmbeddedFiles via pdf-lib key-delete (no dep, 1.31 KB lazy chunk); **`updateMetadata:false`** on load so pdf-lib doesn't re-stamp Producer/ModDate (the bug that made the scrub look ineffective). Operates on the assembled (edited) export. **Redaction-completeness check DEFERRED → #53b** (verifies the app's own rasterized redactions — different shape). Full gate green per commit.
- [2026-06-16] DONE: **Wave 2 #54 File System Access (save) `0fb513a`** — `downloadPDF` uses the native Save dialog on Chromium (`showSaveFilePicker`→`createWritable`), picker acquired pre-assembly (transient-activation), silent no-op on cancel, anchor-download fallback elsewhere. `src/utils/fileSystemAccess.ts` (local types, no dep) + `toast.pdfSaved`. **Open-via-picker + recent-files (handle persistence) DEFERRED → #54b.** 6 unit + 3 wired tests; full gate green. NEXT (Wave 2 ROI): #59 merge/split (audit PageService first) → #56 table→CSV/XLSX.
- [2026-06-16] DONE: **Wave 2 #59 merge/split/extract** — AUDIT first: merge (addPages+reorder), rotate/delete/blank already ship; the real gap = **range extract**. Built in 3 commits: `parsePageRange` util `2a3fcbf` (6t); `_assemblePdfDoc(pagesSubset?)` refactor + `downloadPageRange` `ebff3fb` (3t, shared `_saveBytesTo` save/download helper, reuses #54 picker); ✂ Extract-pages modal `bindExtractPagesModal` `784f4b0` (5t) + i18n×3. Behavior-neutral (default subset = whole doc; all export/DOCX/browser tests pass). Full gate green per commit (jsdom 1209+2, browser 42). NEXT (Wave 2 ROI): **#56 table→CSV/XLSX** (cluster underline/strike rule infra → cell grid; SheetJS lazy for XLSX). Deferred: #53b redaction-completeness, #54b open-picker+recent-files.
- [2026-06-16] AGREED: **#56 scope = ruled-table → CSV only, NO new dep** (AskUserQuestion). Spike found: the existing rule infra (`opStreamWalker`) keeps ONLY thin *horizontal* rules (underline/strike) — table grids need vertical rules too, so #56 adds vertical-rule capture (gated, additive — underline/strike untouched). CSV needs no dep ("trivial"); **XLSX/SheetJS DEFERRED → #56b** pending an explicit dependency decision (CI npm-audit posture). Lattice/ruled tables only; **borderless tables = documented CEILING**.
- [2026-06-16] DONE: **Wave 2 #56 ruled-table → CSV** — 2 commits: vertical-rule capture in `walkPageOps` (additive, underline/strike byte-unchanged) + pure `tableExtract.ts` `e89dcca` (9t + 2 vRule tests); `exportService.exportTableCsv` + `_extractPageTableData` + ▦ UI + i18n×3 `b3b8db9` (real-Chrome e2e: pdf-lib ruled table → `A,B\nC,D`). Plain CSV download (no dep). **XLSX/SheetJS → #56b** (explicit dep decision); borderless tables = CEILING. Full gate green (jsdom 1219+2, browser 43). **Wave 2 ROI batch (#53/#54/#59/#56) COMPLETE.** Remaining deferred sub-items: #53b redaction-completeness, #54b open-picker+recent-files, #56b XLSX. Next: revisit milestones (M5 perf #46 thumbnails, etc.).
- [2026-06-16] DONE: **M5 #46 lazy thumbnail rasterization `87ee688`** — IntersectionObserver defers `generateThumbnail` (the dominant per-page pdf.js-render cost) from all-N-on-open to visible+buffer; cached instant; one reused observer (disconnect/re-observe per render); eager fallback when IO absent. DOM/drag/highlight/invalidate untouched. +3 jsdom tests (fake IO). Chose lazy-rasterization over full DOM windowing (rasterization was the bottleneck; windowing would risk drag-reorder for a marginal node-count win — documented). Full gate green (jsdom 1222+2, browser 43). Next M5: #48 OCR runtimeCaching, #47 render-on-demand, or other milestone.
- [2026-06-16] DONE: **M5 #48 OCR assets → runtimeCaching `5ff7943`** — `globIgnores:['**/tesseract/**']` + `ocr-assets` CacheFirst route; the `**/*.js` precache glob had swept the tesseract worker + 3 `*.wasm.js` cores. **Verified precache 16.5 MB → 5.0 MB** (−11.5 MB install for all users). Tradeoff: OCR needs one online use before working offline (documented). SHA-pin + self-serve unchanged. Infra-TDD: 2 vite.config-regression tests + build-manifest verification. Full gate green (jsdom 1224+2, browser 43). Next M5: #47 render-on-demand, #50 keyed element-layer diff, #49 worker offload (L).
- [2026-06-16] DONE: **#35 accessibility — `aab923d` (1 unpushed).** Verify-before-build paid off: the a11y baseline was already ~95% implemented across prior sprints + M0 (12 modals fully ARIA-wired, aria-live toasts, 5 focus-trap managers, on-canvas `role`+`tabindex`+`aria-label`, keyboard thumbnails). Only genuine gap = icon-only `annotateBtn` → fixed with `data-i18n-aria=toolbar.annotateTitle` (EN/FR/AR) + a durable button-label class guard (`tests/ui/iconButtonLabels.test.ts`, jsdom +2). Gate green tsc·oxlint 0/0·jsdom 1173+2xfail·browser 41. **Residual deferred** (contrast/RTL-edge/canvas-tool keyboard ops) — needs manual SR + visual audit, low ROI. **NEXT: pick a milestone** (M3 #31/#37 supply-chain extras, M5 #46 thumbnails, M6 #53 sanitize, …).

## How the ~140 raw findings collapse to ~65 tracked items

| Source | Raw count | Notes |
|--------|-----------|-------|
| inspect health | 1 P0 / 13 P1 / 40 P2 / 28 P3 = 82 | many P3 are stylistic; folded |
| inspect vision | 83 proposals | grouped by track |
| forge | 18 (6 Unjustified / 12 Questionable) | 5 collapse into inspect items |
| roadmap (open) | new-feature tiers G1–G10 | most prior workstreams DONE |
| ceiling-challenge | 6 "breakable" reframes | → M7 |
| new-ideas | 10 proposals | → M6/M5 |
| blockers consolidated | reachable residue + ceiling | most DONE; residue folded |

**De-dup map (the 5 cross-source collapses):**
1. **Global error boundary** = inspect D-P1 + forge [G] + vision VC-1 + VJ-7.
2. **SavedState schema versioning** = inspect VJ-1/F-P1 + forge [F] (+ forge [G] evolution lens).
3. **ocr/signing on concrete `PDFTurboApp` not `IAppContext`** = inspect H-P2 + forge [A] + forge [H] (testability consequence).
4. **`signPdf` 107-line orchestration + raw getElementById** = inspect H-P1 + forge [B]×2.
5. **Giant-function decompose** (`reconstructColumn`, `_extractFlowDoc`) = inspect H-P1×2 + forge [D]×2.

---

## Milestones (priority order)

Effort key: **S** ≤1h · **M** 1–4h · **L** >4h. Severity from the source reports. ✦ = flagged by ≥2 analyses.

### M0 — Reliability & Safety Net  *(START HERE; mostly S/M, highest leverage)*
The cluster both fresh analyses converged on. No active bug today, but each is a real failure mode under
the single-dev / no-PR-gate / push-auto-deploy model. The error boundary is the keystone — it converts
every silent floating-promise rejection below into a visible toast.

| # | Item | Sev | Eff | File:line | Sources |
|---|------|-----|-----|-----------|---------|
| 1 | ✦ **Global error boundary** — `window.onerror` + `unhandledrejection` → toast + ring buffer; never swallow (autosave already protects data) | P1 | S | `main.ts` (absent) | inspect D-P1, forge [G], VC-1/VJ-7 |
| 2 | **Clamp ToUnicode CMap `bfrange` loop** + bound section-scan length — only file-open DoS/OOM surface | P1 | S | `contentStreamEditor.ts:930-937` | inspect A-P1, VG-8 |
| 3 | ✦ **`SavedState.schemaVersion`** + stamp on write + migrate-or-discard on load; switch `onupgradeneeded` on `event.oldVersion` | P1 | S→(L later) | `storage.ts:16-33,52-64`, `sessionManager.ts:30-38`, `documentLoader.ts:94-122` | inspect VJ-1/F-P1, forge [F] |
| 4 | **Render-pipeline per-run epoch guard** — promote the form-field generation token to wrap canvas+text phases; re-check after each await, bail if superseded (stale text-layer cross-contamination on rapid nav/zoom) | P1 | S–M | `pageRenderPipeline.ts:35-54`, `pdfRenderer.ts:79-90`, `pdfTurboApp.ts:134-135` | forge [E], inspect D-P1 |
| 5 | **True-edit commit: edit epoch + `sourcePdfs.get(src.id)===src` identity recheck + try/catch → toast + auto-undo**; `loadingTask.destroy()` on stale (await-gap TOCTOU can snapshot mismatched before/after bytes → silent undo-stack corruption) | P1 | M | `pdfTurboApp.ts:396-410`, `textEditHandler.ts:118,507-518`, `historyManager.ts:21-24` | forge [E], inspect D-P1 |
| 6 | **OCR single-flight guard** (`_running` flag) + same source-identity recheck before the searchable byte-swap; optionally disable `ocrBtn` while running (unbounded WASM workers + double-commit + stale-source swap) | P1 | S–M | `ocrHandler.ts:107-162`, `ocrEngine.ts:156-179` | forge [E], inspect D-P1 |
| 7 | **Confirm-gate `closeDocument`/`clearSave`** behind a reusable `confirmDestructive()` modal (skip when `pageCount===0`) — the only two non-undoable actions in an everything-undoable app | P1 | S | `documentLoader.ts:161-163,185-209`, `modalBinder.ts:122-133` | forge [I] |
| 8 | **Thumbnail nav keyboard a11y** — `role="button"`+`tabindex=0`+`aria-label`+Enter/Space keydown on the nav `<div>` | P1 | S | `pageThumbnailPanel.ts:56-58,130` | forge [I], inspect (a11y blind spot) |
| 9 | **Floating-promise try/catch sweep** (render/zoom/nav) → toast; relieved by #1 | P1 | M | `pageRenderPipeline.ts:35`, `pageService.ts:273,297`, `navigationBinder.ts:24-31` | inspect D-P1 |
| 10 | **Asset-fetch `r.ok`+timeout + fix cached rejection** (a failed Arabic-font/OCR-asset promise is cached → poisons retries) | P2 | S–M | Arabic font + OCR asset fetch sites | inspect D-P2 |
| 11 | **`FileReader`/`Image` upload `onerror`** handlers (image/QR) | P2 | S | image/QR upload paths | inspect D-P2 |
| 12 | **autosave `QuotaExceededError` → toast** (currently dropped → silent stop persisting) | P2 | S | `_autosave` quota path | inspect D-P2 |

### M1 — Test the highest-consequence surface  *(closes the P0)*
| # | Item | Sev | Eff | Sources |
|---|------|-----|-----|---------|
| 13 | **Pixel-region browser tests for `pdfElementRenderer`** (per element type: opaque redaction rect, highlight hue, image bbox, rotation anchor) + `downloadPageAsImage` + overlay/rotation/cropbox/watermark | P0/P1 | M | inspect F-P0/P1, VD-4 |
| 14 | **CI coverage gate** on the export/render path so regressions can't merge | — | S–M | VD-1 |
| 15 | **Signing error-path unit tests** — feed malformed p12 / wrong passphrase / already-signed, assert each `SignErrorCode` | P1 | S–M | inspect F-P1 |
| 16 | **Core-cluster tests** — `sessionManager`/`searchManager`/`pageRenderPipeline`/`canvasClickRouter`/`signatureManager`, `hitTest.ts`, `formFieldOverlay.ts`, ink/fill color commands | P2 | M | inspect F-P2, roadmap D2 |
| 17 | **Do #23 (renderToPdf) WITH #13** — polymorphic dispatch de-risks the P0 surface as it's tested | — | — | forge [G] (sequencing) |

### M2 — Architecture-debt paydown  *(incremental, no big-bang; behavior-neutral)*
| # | Item | Sev | Eff | File | Sources |
|---|------|-----|-----|------|---------|
| 18 | ✦ **`IAppContext` for `ocrHandler`+`signingHandler`** — add `assemblePdfBytes()`, `currentFilename`, `autosave()` to the seam; swap ctor types (restores 8/8 handler decoupling + jsdom-testability of the p12-scrub/byte-swap) | P2 | S | `ocrHandler.ts:17,98`, `signingHandler.ts:14,57`, `appContext.ts` | forge [A], inspect H |
| 19 | ✦ **`signPdf` → `SigningHandler.runSignFlow()`** (one-line delegator on the app); re-point the 9 preflight tests at the handler | — | M | `pdfTurboApp.ts:562-668` | forge [B], inspect H-P1 |
| 20 | ✦ **Register 10 generate-cert IDs in `AppDOMRefs`**; replace 11 raw `document.getElementById` casts in sign flow | — | S | `pdfTurboApp.ts` sign block, `uiController.ts` | forge [B], inspect H-P1 |
| 21 | ✦ **Decompose `reconstructColumn`** (~292L) along its numbered-comment stages → `clusterLinesByBaseline`/`groupLinesToParagraphs`/`buildParagraph` pure fns (unlocks property-based fidelity tests) | P2 | M | `flowDoc.ts:491-783` | inspect H-P1, forge [D] |
| 22 | ✦ **Extract `_extractFlowDoc` op-walk** → pure `src/export/opStreamWalker.ts` `walkPageOps()`; function shrinks to ~40L (kills the exportService serialization hotspot) | P2 | M | `exportService.ts:334-592` | inspect H-P1, forge [D] |
| 23 | **`renderToPdf(page,ctx)` polymorphic on `PDFElement`** — move each export `if(element.type===…)` branch into its element class; collapse `pdfElementRenderer` (kills export-dispatch triplication; do with #13) | — | M | `pdfElementRenderer.ts:98-216`, `exportPipeline.ts:225,236` | forge [G] |
| 24 | **Element commands store `toJSON()` mementos** (Add/Remove/Bulk/ClearAll) reconstructed via `ElementFactory.fromJSON` — severs live-instance sharing; lets history `dispose()` drop multi-MB data-URIs | — | M | `commands/elementCmds.ts:5-50` | forge [F] |
| 25 | **Typed `EditOutcome`** for `replaceTextAt` (`{ok,fidelity}`/`{ok:false,reason}`) — toast "font substituted" on Path-3 redraw instead of unqualified success | — | S | `contentStreamEditor.ts:1238` + caller | forge [C] |
| 26 | **`onTrace?(reason,ctx)` diagnostic sink** on `replaceTextAt`/`deleteTextAt` → `app.reportError.silent` (~31 silent refusal/catch sites become field-diagnosable) | — | M | `contentStreamEditor.ts` | forge [H] |
| 27 | **Role-interfaces vs 136-method god-object** — extract 5–8 narrow `*Host` interfaces handlers depend on; `PDFTurboApp implements` them (runtime unchanged) | — | M | `pdfTurboApp.ts` delegator block, all `handlers/*` | forge [C], VA-1/3 |
| 28 | **Feature-flag / kill-switch seam** — `src/config/features.ts` `isEnabled()` from `import.meta.env.VITE_FEATURE_*` (+localStorage dev override); gate true-edit / searchable-OCR / e-sign so a bad deploy is one env change away from off | — | S–M | absent | forge [G] |
| 29 | **De-dup shared utils** — `utils/fontName.ts` (`extractPsName`), `triggerDownload()`, `EXPORT_RASTER_SCALE` const (`SCALE=2` ×4) | P2 | S | `flowDoc.ts:310`+`contentStreamEditor.ts:459`; 3 blob-download sites | inspect H-P2, VA-5 |
| 30 | **Error-signalling rule in CLAUDE.md** (typed `*Error` for UI-branched ops; sentinel only for trivial helpers) + make `applySearchableLayerToPdf` null/throw channels consistent | — | S | docs + `searchableTextLayer.ts:148-188` | forge [C] |

### M3 — Security hardening, supply chain & accessibility
| # | Item | Sev | Eff | Sources |
|---|------|-----|-----|---------|
| 31 | ✅ DONE `062acf6` **Pin OCR traineddata by SHA-256** — only unguarded supply-chain ingress | P2 | S | VG-1 |
| 32 | ✅ DONE `a68c6c8` **CSP `base-uri 'none'` + `form-action 'none'`** — one meta line | — | S | VG-3 |
| 33 | ✅ DONE `cc7491f` **Zero the `.p12` forge key object** (not just container bytes); passphrase scrub infeasible (immutable JS string) — documented | P2 | S | inspect A-P2 |
| 34 | ✅ DONE `092bb20` **Untrusted-PDF input caps** — max-file-size / max-page guard. (`isEvalSupported:false` is OBSOLETE on pdf.js v6 — option + eval path removed; documented, not shipped) | P1-adjacent | S–M | VG-2, inspect Top-5 |
| 35 | ✅ MOSTLY-DONE `aab923d` **Accessibility sweep** — AUDIT (2026-06-16) found the baseline already near-complete: all 12 modals have `role=dialog`+`aria-modal`+`aria-labelledby`; toasts `role=status`+`aria-live`+`aria-atomic`; `signError` `role=alert`; `findCount` `aria-live`; `trapFocus` used by 5 modal managers; on-canvas elements get `role`+`tabindex=0`+`aria-label` (`elementLayerRenderer`); thumbnails keyboard-nav (M0 #8). Only real gap = icon-only `annotateBtn` ('🖊 ▾') → fixed (data-i18n-aria + guard test `tests/ui/iconButtonLabels.test.ts`). **Residual (deferred, needs manual SR/keyboard + visual audit): contrast ratios, RTL/`dir` edge cases, full keyboard operability of canvas drawing tools** — judgment-heavy, low remaining ROI, best as a manual pass. | P1/P2 | M–L | inspect self-reflection, roadmap E1/E2/E4 |
| 36 | **Trusted Types adoption** | — | L | VG-6 |
| 37 | ✅ DONE `e97d361` **Own dependency CVE / supply-chain** — documented the deploy-blocking `npm audit --audit-level=high` as the supply-chain gate + SHA-pinned traineddata + periodic-review note in CLAUDE.md Git & CI | — | S | inspect self-reflection |

### M4 — DX, docs, tooling & observability
| # | Item | Sev | Eff | Sources |
|---|------|-----|-----|---------|
| 38 | ✅ DONE `e97d361` **Fix CLAUDE.md stale line anchors** → symbol refs not line numbers (pdfTurboApp.ts count, export delegators, isArabicText attribution → flowDoc.ts) | P2 | S | inspect E-P2 |
| 39 | ✅ DONE `4e24c53` **README + CONTRIBUTING** — added OCR/DOCX/e-sign/Lock features; ESLint→oxlint, Node 24, browser tests + audit + ocr:assets + pre-push hook | P2 | S | inspect E, VE, VI |
| 40 | ✅ DONE `757120a` **Pre-push hook + `.nvmrc`/`engines`** — `.githooks/pre-push` (type-check+lint+test) auto-installed via `prepare` (core.hooksPath), no husky dep; Node>=24 pinned | — | S | VB |
| 41 | **Structured ring-buffer logger (VC-6)** — extend the existing `errorReporter` (console.* is only 4 hits); keystone for #1 + VC-1/4/5; privacy-safe, no network | — | S–M | VC |
| 42 | ✅ DONE `4442bac` **Remove dead `InkColorCmd`** (zero callers, grep-verified; `commands/index.ts` barrel didn't exist) | P3 | S | inspect B |
| 43 | ✅ DONE `b8e7927` **Naming honesty** — `_autosave`→`autosave` (~60 sites, delegator merged) + `toolModeManager`→`toolModeService` (file+class+27 sites). NOTE: scope was ~60 sites not "~10"; done in full per user choice over a skip recommendation | — | S(actual M) | VF |
| 44 | ✅ DONE `efbdc85` **Determinate progress bar** — `ProgressManager.setFraction(0..1\|null)` renders a `<progress>` bar (optional 3rd ctor arg, backward-compat); export `_assemblePdfDoc(onPage?)` drives per-page progress. OCR (modal bar) + sign (single-shot, in-modal busy row) already contextual; reusable for Wave 2 page-loop ops | — | M | VC-2 |
| 45 | ✅ DONE `e97d361` **Document CI `npm audit` + `playwright install-deps`** in CLAUDE.md + reconcile `pull_request` trigger vs single-dev reality | P2 | S | inspect G |

### M5 — Performance & scale
| # | Item | Sev | Eff | Sources |
|---|------|-----|-----|---------|
| 46 | ✅ DONE `87ee688` — **lazy thumbnail rasterization** (IntersectionObserver): `render()` no longer eagerly rasterizes all N pages; each uncached item is observed (root=scroll container, 300px margin) and rasterized only near-viewport; cached served instantly; one observer reused per render; eager fallback when IO absent (jsdom/old). DOM/drag/highlight/invalidate unchanged. +3 jsdom tests (fake IO). *(Full windowing of DOM nodes not done — rasterization was the dominant cost)* | P1-perf | M | VH-1 |
| 47 | **Render-on-demand** pages | — | M | VH-2 |
| 48 | ✅ DONE `5ff7943` — **OCR assets → runtimeCaching**: `globIgnores:['**/tesseract/**']` + `ocr-assets` CacheFirst route (before the generic .js rule). The `**/*.js` glob had swept the worker + 3 `*.wasm.js` cores into precache. **Verified: precache 16.5 MB → 5.0 MB** (−11.5 MB, bigger than the ~6 MB estimate). Tradeoff: OCR needs one online use before offline. SHA-pin/self-serve intact. 2 config-guard tests + build manifest check | P1-perf | M | VH-6 |
| 49 | **Web Worker offload** (comlink) for flowDoc reconstruction + content-stream parse + export (OCR already worker-based) | — | L | VH-3, new-ideas T3 |
| 50 | **Keyed element-layer diff** — stop destroy/recreate-all in `renderElements()` | — | L | VH-8 |
| 51 | **Incremental save (history deltas)** | — | L | VH-9 |
| 52 | **OPFS for large-doc persistence** (keep IndexedDB fallback) — *optional; IndexedDB works today* | — | S–M | new-ideas T3 |

### M6 — New features  *(each starts with a named spike; research-before-commit)*
Ordered by ROI-per-effort (new-ideas recommendation + roadmap tiers). All 100% client-side, no upload;
local-AI items are **GRDF-policy-compatible by construction** (transformers.js inference never leaves the device).

| # | Feature | Eff | Spike to validate first | Sources |
|---|---------|-----|-------------------------|---------|
| 53 | ✅ DONE (scrub core) `e7a9c2f` util + `0b6578d` UI — **`sanitizePdf`** strips `/Info`, XMP `/Metadata`, `/OpenAction`, `/AA` (catalog+pages), `/Names→/JavaScript`, `/Names→/EmbeddedFiles` via pdf-lib key-delete (no dep, 1.31 KB lazy chunk); loads `updateMetadata:false` so pdf-lib doesn't re-stamp Producer/ModDate. 🧹 export-flyout button → `sanitizeAndDownload()` over the assembled export → `<base>-sanitized.pdf` + report toast (EN/FR/AR). jsdom round-trip + real-Chrome e2e guards. **Redaction-completeness check DEFERRED** (#53b — verifies the app's own rasterized redactions, different shape) | S–M | ✅ load PDF w/ `/Info`+`/OpenAction`, scrub, assert gone | new-ideas #2 |
| 54 | ✅ DONE (save) `0fb513a` — **File System Access save**: `src/utils/fileSystemAccess.ts` (`canUseFsSave`/`pickSaveTarget`/`writeToHandle`, local types, no dep); `downloadPDF` opens the native Save dialog on Chromium (picker acquired pre-assembly for transient activation), writes via `createWritable`, falls back to anchor download otherwise, silent no-op on cancel. `toast.pdfSaved`. **Open-via-picker + recent-files DEFERRED → #54b.** 6+3 tests | S | ✅ `if('showSaveFilePicker' in window)` round-trip | new-ideas #3 |
| 55 | **Local PII detector** — regex/dictionary MVP (IBAN/email/phone) → optional **transformers.js** NER for one-click smart redaction; policy-safe | M→L | measure NER model size + per-page latency WASM vs WebGPU; ship regex MVP first | new-ideas #4 |
| 56 | ✅ DONE (CSV) `e89dcca`+`b3b8db9` — **ruled-table → CSV**: added vertical-rule capture to `walkPageOps` (additive; underline/strike untouched); `tableExtract.ts` (`clusterPositions`/`buildTableGrid`/`gridToCsv`, RFC4180); `exportService.exportTableCsv` + ▦ UI + i18n×3. Real-Chrome e2e (pdf-lib lines → CSV). **XLSX/SheetJS DEFERRED → #56b** (dep decision); borderless tables = CEILING | M | ✅ ruled-table e2e | new-ideas #5 |
| 57 | **XFDF annotation import/export** — share markups without the PDF; round-trip with Acrobat. Plain XML, no dep | M | map element model ↔ XFDF round-trip | new-ideas #6 |
| 58 | **PDF compare / diff** — pixel (pixelmatch-style) + text diff via pdf.js | M | — | new-ideas #7, roadmap G6 |
| 59 | ✅ DONE `2a3fcbf`+`ebff3fb`+`784f4b0` — **AUDIT**: merge (addPages appends + reorder), rotate/delete/blank already shipped; the GAP was range extract/split. Built: `parsePageRange` util (6t), `_assemblePdfDoc(pagesSubset?)` + `ExportService.downloadPageRange` (3t, FS-Access/download via shared `_saveBytesTo`), ✂ export-flyout **Extract-pages modal** (`bindExtractPagesModal`, 5t) + i18n×3. Behavior-neutral refactor (default = whole doc) | S–M | ✅ audit done; range round-trip tested | roadmap G1 |
| 60 | **Compression / optimize** (image downsample + re-embed) | M | — | roadmap G3 |
| 61 | **Bates / page numbering** (must hit all 3 export paths) | M | — | roadmap G7 |
| 62 | **Form/annotation flattening** | S–M | — | roadmap G4 |

### M7 — Ceiling-breakers  *(documented ceilings the challenge proved reachable; ROI-gated, build only on demand)*
| # | Item | Verdict | Route | ROI |
|---|------|---------|-------|-----|
| 63 | **PAdES-BES** (`ETSI.CAdES.detached`) | BREAKABLE-NOW | swap node-forge → **PKI.js** on the CMS path; same ByteRange plumbing; ESS signing-certificate-v2 attr | **High** *if* compliance names PAdES |
| 64 | **Lattice (ruled) tables → DOCX + CSV** | BREAKABLE-CUSTOM | reuse vector-rule extraction → x/y grid clustering → docx `Table` (pairs with #56) | **High** |
| 65 | **R6 AES-256** (PDF-2.0 hardened) | BREAKABLE-CUSTOM | patch vendored `PDFSecurity`: Algorithm 2.B KDF + `/Perms` (~60–100 LOC WebCrypto) | Med — only if R6 mandated |
| 66 | **TSA timestamp (PAdES-T) + LTV/DSS** | BREAKABLE-NOW* | PKI.js TSP — *requires a network call → breaks the "100% client-side" guarantee; must be explicit opt-in* | Med, opt-in only |

---

## REAL CEILING — documented, NOT promised  *(stated so nothing here looks "forgotten")*
These are structural limits of a 100%-client-side, no-backend PWA, or low-ROI moonshots. Each is a
deliberate non-goal with a reason — re-open only with explicit justification.

| Item | Why it stays a ceiling |
|------|------------------------|
| In-place Arabic **true-edit** (preserving original subset font) | Subset CID fonts lack the new glyphs; re-embedding Noto gives the same visual result as the overlay we already ship — overlay IS the answer |
| Mixed LTR+RTL single-line bidi reorder; tashkeel GPOS | Needs full UAX#9 char-level bidi + HarfBuzz-class shaping; word-level reorder ships, char-level is large/fragile |
| Vector graphics → DrawingML/raster | Effectively a vector translator; huge, low ROI |
| Borderless / inferred-structure tables | No lines to detect → needs layout ML |
| Recursive 3+ column XY-cut | One V-cut ships; recursive degrades on magazine layouts, niche |
| Exact subset-font face match | `ABCDEF+` subset carries no recoverable family — impossible without the embedded program |
| Type3 true-edit; cm-scale/rotation in Path-3 redraw; rotated-page inline-input placement | Rare; overlay/refuse already handles them correctly; low ROI |
| Tagged-PDF `getStructTree` fast path; header/footer routing | ~15% of PDFs / noisy band-detection; separate multi-day paths, deferred |
| CA-issued / **trusted** certs | "Trusted" means a CA vouches — inherently external to a client-only tool. Not a code problem |
| **PDF/A** | Only via Ghostscript-WASM = **AGPL + 18 MB** → license + size incompatible. **Dropped.** |
| Accessibility **PDF tagging** (authoring struct tree) | No mature in-browser lib (pdf-lib can't author struct tree) → defer |

---

## Recommended starting sequence

**Start with M0, in this order** (security/leverage-first, matches both reports' own Top-5 ordering):

1. **#1 Global error boundary** (S) — the keystone; turns every silent floating-promise rejection into a visible toast and relieves #4/#5/#6/#9. Do **#41 ring-buffer logger** alongside it (its sink).
2. **#2 Clamp the CMap loop** (S) — kills the only file-open DoS/OOM; pure untrusted-input hardening.
3. **#3 SavedState `schemaVersion`** (S) — cheap *now*, expensive forever if a shape change ships first; seed the seam before it's needed.
4. **#7 Confirm-gate Close/Reset** (S) + **#8 thumbnail keyboard a11y** (S) — two small honesty fixes (everything-undoable contract; a11y-sprint completion).
5. **#4–#6 the epoch/identity/single-flight guards + try/catch** (S–M) — the TOCTOU cluster; do after #1 so failures are already visible.

Then **M1** (close the P0 with the right test *type* + a CI gate so it can't recur), then **M2** in dependency order (#18 IAppContext → #19/#20 sign refactor → #21/#22 decompositions → #23 renderToPdf with M1 → the rest). M3–M7 are scheduled by appetite; **M6/M7 are spike-gated and build-on-demand** (don't pre-build features).

**One-week quick-win batch** (all S, can land together): #1, #2, #3, #7, #8, #12, #29, #31, #32, #38, #39, #40, #42, #43.

---

## Verification (per item)
TDD每项: failing test first (jsdom or `test:browser`) → implement → full gate green → update KNOWN_ISSUES/scorecards/CLAUDE.md/FEATURES as touched → thematic commit (no Co-Authored-By) → push is manual. Browser-layer behavior (canvas/pointer/rasterize/image-extract) MUST be guarded in the real-Chrome harness, not jsdom.
