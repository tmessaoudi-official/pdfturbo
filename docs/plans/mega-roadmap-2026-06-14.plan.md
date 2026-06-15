# PDFturbo Mega-Roadmap Plan — 2026-06-14

Comprehensive, research-backed plan to "wrap up without compromise": true-edit reliability,
DOCX near-100% fidelity, full quality/a11y/i18n/security audit, new features, and total doc
refresh. Evidence-graded. Raw research: `docs/reviews/research-2026-06-14/01..05-*.md`.

## Decisions Log
- [2026-06-14] AGREED: Deliverable = full research + ONE comprehensive prioritized plan; no code changes this session beyond trivial. (user: "Full research + mega-plan")
- [2026-06-14] AGREED: Research engine = HYBRID — parallel research agents for the static sweep + main-loop live browser QA; NOT a heavy multi-agent Workflow (the empirical core is single-browser/sequential; Workflow agents are headless and can't drive the browser). (user delegated via "challenge me")
- [2026-06-14] AGREED: Personal PDFs (CV, attestation) used as black-box test inputs only — never extract/print contents (personal data). `test-document.pdf` is the primary safe fixture.
- [2026-06-14] DONE: Sprint 1 executed (4 parallel TDD agents + parent integration gate) — REDACT-DOCX leak (P0, confirmed RED then fixed in flowDoc/exportService), MEMLEAK (P1, Command.dispose + loadingTask.destroy; corrected agent's no-op doc.destroy), TRUEEDIT-XOBJECT no-op (P1→overlay fallback), TRUEEDIT-OVERBLANK (P1, shadow radius 4→0.5pt), A11Y canvas/toast + I18N update toast (P1). Caught + fixed 2 agent integration misses (no-op destroy via type-check; DOCX browser-test fixture regression). Gate: type-check clean, oxlint 0/0, jsdom 800, browser 11. KNOWN_ISSUES.md updated.
- [2026-06-14] DONE: Sprint 0 executed — H1 (CLAUDE.md doc-truth: escapeValue/registerType/export-consolidation), C1 (oxlint 76→0 warnings), C2 (stale eslint-disable modernized in touched files), D4 (dead `diagnosePage` removed; `getFormXObjectMatrix` NOT dead — 2 live callers), F2 (IndexedDB privacy note in SECURITY.md). Gate: oxlint 0/0, type-check clean, jsdom 771, browser 11. Migration committed separately (462f53e).
- [2026-06-15] DONE: Sprint 2 executed (2 parallel TDD agents, disjoint files, parent full gate + real-Chrome manual QA). True-edit A-1..A-5 (XObject/refused→overlay, full-TJ-hex, UTF-16BE cmap, scoped blanking, Type3/vertical/invisible refuse) + DOCX B-1..B-5 (font allow-list, margins, spacing, floating images, justify/indent). Gate: type-check clean, oxlint 0/0, jsdom 832, browser 11/11. Commits 780193d/d662f98/45a8423. CI failed on flaky `issue1-toolbar-dnd` (verified non-deterministic: 1 fail/4 pass same code) → fixed with scoped `retry:2` (7dd7fd2). CI now green. Confirmed `test:browser` IS in deploy.yml.
- [2026-06-15] AGREED: Sprint 3 = Fidelity & UX Deep Sweep. Fidelity goal = "(1) scorecard + fix reachable + mark ceiling, THEN (2) attempt the hard ones." Method = hybrid (parallel static-research agents to disk + main-loop live browser empirical testing + TDD fixes). Persist plan → user compacts → resume. Fold the live-found text-tool UX defect into Track 3; recommended fix = separate Add Text (draw-to-place) from Edit PDF text. (user: "1 then 2", "persist plan then I compact", "challenge me")
- [2026-06-14] AGREED: Sprint 2 = fidelity, BOTH workstreams, gate mode "Default 30/8 with stops" (user). Scope re-cut around correctness-first: Workstream A = A1 B4 XObject no-op→overlay, A2 B3 replaceShowOpHex all-TJ-segments, A3 B2 cmapHexToUnicodeStr UTF-16BE 4-hex+surrogates, A4 B5 blankAllNearby restrict-to-same-font-size, A5 defensive routing (Type3/vertical/invisible-Tr → overlay). Workstream B = B1 broaden font allow-list, B2 page margins, B3 para/line spacing, B4 image x/y positioning, B5 justify+indent. DEFERRED (research-confirmed multi-day/hard): lattice tables, vector→raster, recursive 3-col XY-cut, rotated-page true-edit, RTL logical reorder, A6 cm-rotation redraw (regression risk). Method: 2 parallel TDD agents on disjoint files + parent full gate; locale edits in parent. (user: "Approve full plan")

- [2026-06-14] AGREED (Sprint 3, batch 2): user selected ALL four reachable items + "deep research and tests for all": DOCX hyperlinks, DOCX JPEG re-encode, true-edit TJ-kerning, DOCX list nesting + headings H4–H6. Method = main-loop TDD (shared flowDoc files; no parallel agents). (user: AskUserQuestion multi-select + "Do deep research and tests for all items")
- [2026-06-15] AGREED (Sprint 4 — PARALLEL program): run fidelity/bug hunt + THREE net-new features concurrently. Model = 3 background **worktree** sub-agents build feature CORES as new files only + unit tests and RETURN A WIRING SPEC (they must NOT edit shared files); parent (main loop) runs fidelity Batch 3 AND serially integrates each feature into the shared wiring files + full gate. Run mode = **auto + integrate-as-they-land** (Option 1): autonomous, pause only for risky/destructive actions or a NEW dependency failing the security/deprecation check. 3C gate 30/8. (user: "1 & 2 & 3 all with the fidelity hunt", "Option 1", "challenge me")
- [2026-06-15] AGREED: feature scopes — (1) **E-signing** = client-side cryptographic signature via zgapdfsigner (MIT) with user-supplied .p12/PKCS#12 + visible appearance; LTV/TSA deferred. (2) **Page ops** = reorder/rotate/delete pages (thumbnail panel + history commands). (3) **OCR** = tesseract.js, DYNAMICALLY imported, lang data lazy-fetched (offline caveat). ALL heavy deps dynamic-imported; ALL 100% client-side (no upload). Each needs a real-browser test (jsdom can't cover crypto/canvas/download). "Regression hunt" = the full gate on every integration (no open regression backlog today; 858/12 green).
- [2026-06-14] DONE (Sprint 3, batch 2): all four landed TDD. (1) DOCX hyperlinks — `getAnnotations` Link+url → `FlowLinkRect` → bbox-tag `FlowRun.linkUrl` (merge key) → `ExternalHyperlink` (blue+underline) + MD `[text](url)`. (2) DOCX JPEG re-encode — `pickImageMime` (alpha→PNG, large opaque→JPEG q0.85) + canvas alpha sampling. (3) List nesting — `listDepth` from x0 vs colLeft. (4) Headings H4–H6 — type `0..6`, `slice(0,6)`, writer HEADINGS extended. (5) True-edit TJ kerning — `replaceShowOpInPlace`/`replaceShowOpHex` distribute text across TJ segments preserving kerning numbers; new `decodeLiteralString`; A2 no-stale-glyph guarantee held. Gate: type-check clean, oxlint 0/0, jsdom **858**, browser **12/12**. Scorecards/CLAUDE.md/KNOWN_ISSUES.md refreshed. NOT pushed (manual).
- [2026-06-15] DONE (Sprint 3, batch 1): Research fan-out (3 agents → `docs/reviews/research-2026-06-15/01-docx-gaps.md`, `02-trueedit-matrix.md`, `03-ux-a11y.md`) + 2 fidelity scorecards (`scorecard-docx.md`, `scorecard-trueedit.md`). Fixes: **UX text-tool trap** (editText edits existing text only; blank click no longer drops a box → reverts ISSUE-5; commit 873dd37) + **DOCX lettered/parenthesized ordered-list markers** (decimal `(1)`/`1)`, lower/upper-alpha paren forms → docx LevelFormat + per-format numbering refs; commit 5a95192) + ISSUE-5 browser guard updated (7730110). Gate: type-check clean, oxlint 0/0, jsdom **842**, browser **11/11**. Docs refreshed (CLAUDE.md, KNOWN_ISSUES.md, FEATURES.md). NOT pushed (manual).
- [2026-06-15] AGREED (Sprint 4 — integration UX decisions): (S) **E-signing output = download-only** ('<name>-signed.pdf'); NO auto-resign toggle — challenged & rejected as a security/trust anti-pattern (would retain .p12+passphrase in memory; auto-stamp destroys non-repudiation; v1 signer is full-resave not PAdES). Instead: detect an already-signed PDF on edit and WARN that edits invalidate the signature; re-signing stays a deliberate act. (O) **OCR output = undoable text elements** (elementFactory + historyManager Command → searchable/selectable/exportable). (P) **Page-ops backend = existing PageService** — feature ALREADY shipped (PageService + thumbnail panel drag-reorder/delete/rotate, annotation-aware); Agent P's PageOpsService facade was REDUNDANT+inferior → deleted (commit 813cd6c). Pace = all 3 wired now, autonomous, commit-per-feature + gate, then push checkpoint. (user: "Option 1 + resign toggle? challenge me", "Undoable text elements", "do we not have those? challenge me", "All 3 now autonomous")
- [2026-06-15] AGREED (Sprint 4 — signing scope + next): (1) **Signing must cover EDITS** — refactor `exportService` to expose assembled PDF bytes (annotations/edits baked in via the existing downloadPDF pipeline), then sign+download those bytes (NOT the raw source). (2) Next = signing wiring (Option 2) + fidelity pass on the 3 real docs (Option 3), then a FULL live QA + qa-sweep. CHALLENGE (recorded): true parallel code-edit is NOT clean — signing's exportService bytes-refactor and fidelity (b underline/strike, d rotated-image) BOTH touch `exportService` op-walk → conflict. So: PARENT does signing wiring incl. the exportService refactor SERIALLY; a READ-ONLY background agent does deep gap analysis + fix-design (file:line) for underline/strike + rotated-image in parallel (no code edits → no collision); parent applies those fixes AFTER signing; empirical real-doc fidelity measurement is parent-only (headless agents can't drive Chrome). (user: "Sign WITH edits", "Option 2 & 3 in parallel then full live QA + qa-sweep, challenge me", "compact then continue without loss")
- [2026-06-15] DONE (Sprint 4): Batch 3a color fidelity (d7879fb — pdf.js v6 hex-string color args + Tm/Td/T* text-matrix tracking; fixes silent black-collapse that was never actually working end-to-end in v6), Batch 3 c+e (50ac4d5 — roman lists + super/subscript), feature cores integrated (7483397 — signing/ocr + deps node-forge/tesseract.js, 0 vulns), page-ops facade removed (813cd6c). zgapdfsigner REJECTED (transitive forbidden bare pdf-lib@1.17.1) → node-forge@1.3.1 chosen. Remaining: wire OCR + signing UI; Batch 3 (b) underline/strike + (d) rotated-image deferred to final fidelity pass.
- [2026-06-15] DONE (Sprint 4 — SIGNING WIRING, sign-with-edits): `exportService` refactored to expose `assemblePdfBytes()` (extracted `_assemblePdfDoc`; `downloadPDF` now delegates — behaviour-preserving; NOT encrypted, ByteRange-safe). New `src/handlers/signingHandler.ts` (`buildSignOptions` pure 1-based→0-based map; `sign()` assembles → `PdfSigner` → download `<base>-signed.pdf`; `.p12` zeroed in finally). UI: `signBtn` + `signModal` (cert/password/page/x-y-w-h/reason/location/name + privacy note + error + progress), `openSignModal/closeSignModal/signPdf` on app (scrubs password on close), `SignErrorCode`→`sign.error.<CODE>` toast/inline; i18n key-identical en/fr/ar. Tests: jsdom `signingHandler.test.ts` (6) + browser `signing.browser.test.ts` (1, real forge lazy-chunk + Blob download + scrub assert). `node-forge` added to browser optimizeDeps. Gate: type-check 0, oxlint 0/0, jsdom **953**, browser **15/15**. CLAUDE.md updated (OCR + e-signing sections). NOT pushed (manual).
- [2026-06-15] BACKLOG (user request, do AFTER current Sprint 4 wrap): **Arabic support for true PDF text-edit AND DOCX export** — currently unsupported. Scope to investigate: (true-edit) Arabic is shaped/contextual + RTL + usually subset/CID-embedded fonts → `isByteSwapUnsafeFont` gate already forces overlay; needs a redraw path that re-shapes (joining forms) + RTL bidi + an embedded Arabic-capable font (Helvetica fallback can't render Arabic). Likely overlay-only short-term. (DOCX) flowDoc RTL run handling exists (`rtl` flag → `rightToLeft`) but: glyph→Unicode for Arabic subset fonts via ToUnicode, logical-order reorder of visually-ordered pdf.js items (bidi), and joining-form normalization. Listed in CLAUDE.md "Ceiling" (RTL logical reorder, Arabic) — promote to a real sprint with a research fan-out + synthetic Arabic test fixtures (never the private PDFs). (user: "the actual text true pdf edit and docx export does not support arabic at all… work on this after you finish everything")

- [2026-06-15] DONE (Sprint 4 — FIDELITY (b)+(d) + LIVE QA): (b) underline/strike + (d) rotated-image landed TDD (commit 151bd04; jsdom 973, browser 16). Empirical real-doc fidelity (structural metrics only, contents never read): A-CV 4p/180runs/4img/44rules/11underlines/21headings; B-spec 24p/686runs/0img/118rules/0underlines/45headings; C-attest 2p/35runs/4img/9rules/1underline. KEY: B's 118 thin rules → 0 underlines confirms the conservative classifier does NOT false-flag table/separator lines (no false-positive explosion); no evidence-backed gap to chase. **Live QA (Playwright @ localhost) found + fixed a real defect**: the new PKCS#12 e-Sign button collided with the pre-existing drawn-signature `addSignatureBtn` (both labelled 'Sign'; my `toolbar.signTitle` DUPLICATED the existing key and hijacked its tooltip) → renamed cert button to `toolbar.signCert{Label,Title}` ('e-Sign'/'Sign with a digital certificate (PKCS#12)'); drawn-signature keeps `toolbar.sign`/`signTitle` (commit 26335d9). Live verified: 0 console errors, 0 unresolved i18n keys DOM-wide, 3 distinct buttons, both new modals render translated. Commits this leg: ad051a1 (signing wiring), 151bd04 (fidelity b/d), 26335d9 (collision fix). All gate-green. NOT pushed (manual). Full multi-cycle /qa-sweep convergence crawl available on request (focused live QA done).

- [2026-06-15] AGREED: Start the **Arabic sprint** (after Sprint 4 wrap, 6 commits unpushed) — add Arabic support to (1) true PDF text-edit and (2) DOCX export, currently unsupported. Approach = research/establish ground truth first (empirical: what breaks today, file:line), then a scoped plan with a hard-stop go gate before implementation (Large task; Arabic shaping+bidi+CID-font redraw is on the CLAUDE.md "Ceiling" list). (user: "the actual text true pdf edit and docx export does not support arabic at all", "Start the Arabic sprint")

- [2026-06-15] AGREED + VERIFIED (Phase C approach): pdf-lib `drawText` CANNOT render correct RTL Arabic — fontkit shapes only in logical order (verified: reversing the string → isolated glyph 72 not initial-form 9), and drawText places glyphs LTR → correct-joining-but-mirrored. Presentation-form workaround re-shaped by fontkit (mismatch). CORRECT path (chosen by user "do it right"): `font.encodeText(logical)` (pdf-lib already shapes + emits 2-byte subset CIDs, verified `<000100020003000400050006>` for مرحبا) → reverse the CID PAIRS for visual RTL → emit raw `Tj` via `page.pushOperators` (showText/setTextMatrix/setFontAndSize) against Noto Naskh embedded as Type0/CID; the embedded W-array handles advances (width@12=24.5pt verified). Bypasses drawText's LTR placement. Deps added (0 vulns): bidi-js@1.0.3 (MIT), @fontsource/noto-naskh-arabic@5.2.11 (OFL; uses the arabic-subset .woff, fontkit decodes WOFF — verified). Research: `docs/reviews/research-2026-06-15-arabic/03-shaping-deps.md`.

### Arabic Sprint — Formal Plan (2026-06-15, scope = Option 2)
Research: `docs/reviews/research-2026-06-15-arabic/01-docx-arabic-gaps.md`, `02-trueedit-arabic-gaps.md`.
**Phase A — DOCX export Arabic (Moderate, well-understood, START FIRST, TDD):**
- A1: RTL logical-order restoration — pdf.js returns Arabic visual-order tagged `dir:'rtl'`; Word re-applies bidi (w:rtl) → double-reversal. Fix in `flowDoc.ts` reconstructPage: for rtl items, re-reverse the string to logical order so Word renders correctly. Pure helper `toLogicalOrder(str)` + tests.
- A2: RTL line word-ordering — `reconstructColumn` x-sort is always ascending; for an RTL line sort words descending-x. Detect line direction by majority rtl. Tests.
- A3: complex-script attrs in `flowDocWriters.ts` mkTextRun — emit `cs` font + `boldComplexScript`/`italicsComplexScript`/`sizeComplexScript` (docx 9.7.1 supports). Add an Arabic-capable cs font name.
- A4: missing-ToUnicode detection → warn toast (don't silently garble PUA glyph ids).
**Phase B — true-edit refuse guard (Easy, TDD):** detect Arabic-range codepoints in the new text in `contentStreamEditor.ts`/`textEditHandler.ts` → refuse in-place edit, route to overlay (mirror A5 Type3/vertical refusals). Stops the `?????` corruption. `isArabicText()` pure helper + tests.
**Phase C — overlay Arabic rendering (Hard, de-risk first):** bundle an Arabic font (e.g. Noto Naskh Arabic, OFL) + register `@pdf-lib/fontkit`; pre-shape (logical→presentation forms / joining) + bidi reorder BEFORE pdf-lib drawText (drawText does NO GSUB shaping). DEPENDENCY CHOICE TBD — research pass de-risking: shaper lib (harfbuzzjs vs arabic-reshaper vs fontkit.layout), bidi lib (bidi-js), bundle cost, deprecation. CHECKPOINT before integrating C.
**Honest ceiling (documented, NOT attempted):** in-place Arabic true-edit (subset CID fonts lack the glyphs — structurally impossible client-side); perfect mixed-bidi line reorder; full GSUB ligatures beyond presentation-form shaping.
- [2026-06-15] DONE (Arabic sprint, all 3 phases): **Phase A** DOCX export (commit a48d2db — logical-order restoration + complex-script attrs). **Phase B** true-edit refuse guard (Arabic → overlay, no more in-stream '?'). **Phase C** overlay rendering — `arabicOverlay.ts` shapes via `encodeText` + reverses CID pairs + raw `Tj` against embedded Noto Naskh (Type0/CID); wired into `pdfElementRenderer`. Deps: @pdf-lib/fontkit + @fontsource/noto-naskh-arabic (0 vulns; bidi-js was trialled then REMOVED — the single-RTL-run path uses CID-pair reversal directly, so no bidi lib is needed; mixed LTR+RTL line reorder stays a documented ceiling and would re-add bidi-js when built). Tests: +4 jsdom reverseCidHex, +1 real-Chrome e2e (pdf.js recovers Arabic Unicode, no '?', rasterized visible-ink + RTL-right-aligned centroid). Gate: tsc 0, oxlint 0/0, jsdom 990, browser 17. NOT pushed (manual). Visual: e2e rasterization confirms; human eyeball in the live app recommended as final QA.

## Formal Plan

### ▶▶ RESUME HERE (2026-06-15, post-compact #2) — SIGNING WIRING + FIDELITY PASS

**Run mode = autonomous** (3C 30/8 already approved this program — do NOT re-ask). Pause only for
risky/destructive actions or a new dep failing security/deprecation. NO Co-Authored-By. git push is
MANUAL. Local binaries only: `./node_modules/.bin/vitest` / `./node_modules/.bin/oxlint .` (PATH ones are
rtk-proxied → bogus). Browser suite: `./node_modules/.bin/vitest run --config vitest.browser.config.ts`.
NEVER commit/print the private PDFs in `tests/fixtures/private/` (C1/C2 but confidential; gitignored).

**STATE (all committed, NOT pushed):** 6 session commits — `d7879fb` color fidelity (v6 hex-string color
args + Tm/Td/T* tracking; the "color works" claim was FALSE in v6, now fixed), `50ac4d5` roman+super/sub,
`7483397` feature cores+deps (node-forge, tesseract.js; 0 vulns), `813cd6c` page-ops facade removed
(feature ALREADY ships via PageService+thumbnail panel), `133251e` gitignore private fixtures, `185ec08`
OCR fully wired. Gate green: type-check ✓, oxlint 0/0, jsdom **947**, browser **14/14**. Tree clean.
node-forge@1.3.1 + tesseract.js@7 installed.

**FIRST ACTIONS on resume (in order):**
1. `npm run dev` (restart, :5173).
2. **Spawn ONE read-only background agent** (`Explore` or general-purpose, `run_in_background:true`, NO
   worktree needed since read-only): deep gap analysis + fix-DESIGN (file:line + approach, NO code edits)
   for fidelity **(b) underline/strike** (geometric: detect thin filled rects / line segments near text
   baselines via the getOperatorList path-op stream in `exportService` op-walk → FlowRun underline/strike
   flags → docx) and **(d) rotated-image sizing** (decompose image CTM `[a,b,c,d]` → scaleX/scaleY/rotation
   → `FlowImage.rotation` → docx `wp:anchor` rot). It must return a spec ONLY (parent applies, to avoid
   colliding with the signing exportService refactor). Tell it: 100% client-side, pdfjs-dist v6 op-list
   quirks (colors are pre-resolved hex strings; matrices are packed Float32Array args — see d7879fb).
3. **Parent: SIGNING WIRING (serial, owns exportService):**
   a. Refactor `exportService` to expose assembled PDF bytes — extract the `downloadPDF` assembly into a
      reusable `async assemblePdfBytes(): Promise<Uint8Array>` (edits/annotations baked in), and make
      `downloadPDF` call it. Sign THOSE bytes (decision: "sign WITH edits", NOT raw source).
   b. New `src/handlers/signingHandler.ts`: read form (.p12 File→Uint8Array, passphrase, page, rect
      x/y/w/h, reason/location/name), `new PdfSigner().sign(assembledBytes, opts)`, download
      `<base>-signed.pdf`, SCRUB passphrase in finally. Output = download-only (NO auto-resign — rejected
      as security/trust anti-pattern). Optional follow-up: detect already-signed PDF → warn edits
      invalidate sig (NOT required for v1).
   c. UI: `signBtn` toolbar button + `signModal` (file input .p12/.pfx, password, page#, x/y/w/h numeric
      fields w/ sensible defaults e.g. bottom-right of page 1, reason/location/name, privacy note
      "certificate never leaves your browser", error <p>). Register in `uiController` (mirror the OCR
      modal pattern just added: ui fields + getElementById init + enable in the load block), bind in
      `toolBinder` (open) + `modalBinder` (confirm/cancel). App methods `openSignModal/closeSignModal/
      signPdf` on `pdfTurboApp` (mirror `openOcrModal/runOcr`). reportError toasts.
   d. i18n: `toolbar.sign*`, `modal.sign.*`, `toast.sign*` + `sign.error.<CODE>` in en/fr/ar
      (key-identical — locale-sync hook enforces; edit all 3, Arabic best-effort). Agent S's report has
      a full key table.
   e. Tests: jsdom unit (pure form→SignOptions mapping / rect defaults), real-Chrome browser test
      (generate a p12 via forge as in `tests/signing/pdfSigner.integration.test.ts`, sign assembled bytes,
      assert %PDF + a forge lazy-chunk). Full gate. Commit `feat: wire e-signing UI (PKCS#12, sign-with-edits)`.
4. **Apply fidelity (b)+(d)** per the background agent's spec, TDD each, gate, commit
   `feat: DOCX underline/strike + rotated-image fidelity`.
5. **Empirical real-doc fidelity (parent, live browser):** run the export/true-edit pipeline on the 3
   `tests/fixtures/private/*.pdf` (Assist_Spec_Fonctionnelle, AUDENSIEL CV, AttestationDeDroits) — STRUCTURAL
   metrics ONLY (page count, #runs, #images, #headings, DOCX validity, element counts), NEVER print
   contents. Identify image/layout/style gaps; fix highest-ROI with SYNTHETIC committed-test fixtures
   (private docs drive discovery only, never committed tests). Refresh scorecards.
6. **FULL live QA + `/qa-sweep`** on http://localhost:5173/pdfturbo/ (incl. OCR + signing flows). Then
   checkpoint: tell user to push.

---

### ▶ (earlier) RESUME — SPRINT 4: PARALLEL fidelity + 3 features

**Approved run mode = Option 1 (auto + integrate-as-they-land).** Execute autonomously; pause ONLY for
risky/destructive actions or a new dependency that fails the security/deprecation check (Rule 9). 3C gate
30/8 already approved for this program — do NOT re-ask the gate; just proceed.

**FIRST ACTIONS on resume (in order):**
1. `npm run dev` (restart, :5173) for live fidelity QA.
2. Spawn **3 background worktree sub-agents** (Agent tool, `isolation:"worktree"`, `run_in_background:true`,
   `subagent_type:"general-purpose"`). Each builds its feature CORE as NEW files only + a unit test, and
   returns a WIRING SPEC. **Each agent MUST be told: do NOT edit `src/core/uiController.ts`,
   `src/ui/binders/modalBinder.ts`, `src/core/pdfTurboApp.ts`, `locales/*.json`, toolbar files, or any
   existing shared file — only create new files under your feature dir + `tests/`. Use dynamic import for
   heavy deps. 100% client-side, nothing uploaded. Run `npx tsc --noEmit` on your new files. Return:
   (a) list of new files, (b) public API, (c) exact WIRING SPEC for the parent (button id, modal markup,
   handler hookup, i18n keys for en/fr/ar), (d) what needs a browser test.**
   - **Agent S (e-signing):** `src/signing/*` — client-side signature via **zgapdfsigner (MIT)** with a
     user-supplied **.p12/PKCS#12** + passphrase + visible appearance rect. Deprecation/security-check the
     dep BEFORE adding (Rule 9). LTV/TSA out of scope v1.
   - **Agent P (page ops):** reorder/rotate/delete pages — model + history Command classes as new files;
     wiring spec for the thumbnail panel. Every mutation via a `historyManager` Command (undo/redo).
   - **Agent O (OCR):** `src/ocr/*` — **tesseract.js dynamically imported**, lang data lazy-fetched
     (offline caveat documented); produce a selectable/extractable text layer or overlay. Security-check dep.
3. Meanwhile run **fidelity Batch 3** in the main loop, TDD, highest-ROI first:
   **(a) spot-color/Separation black-collapse** — SHARED fix: DOCX export op-walk (`exportService.ts`
   handles only rg/g/k → add `setFillColorN`/`scn` handling or canvas-sample) AND true-edit Path-3
   (`contentStreamEditor.ts` `parseFillColorToRgb` → canvas-pixel-sample fallback so Separation text stops
   redrawing black). **(b) underline/strike** (geometric path-op detection — builds path-op infra tables
   reuse later). **(c) super/subscript** (baseline+size-ratio in `reconstructColumn`). **(d) rotated-image
   sizing** (CTM decompose `[a,b,c,d]`→scaleX/scaleY/rotation; `FlowImage.rotation`→docx). **(e)** roman
   list markers + number-tokenizer exponent. File:line + fix sketches in `01-docx-gaps.md` /
   `02-trueedit-matrix.md`.
4. **Integrate each feature as it returns:** wire into shared files (parent only), add i18n keys to all 3
   locales (key-identical — hook checks), write/extend a real-browser test, run FULL gate
   (`npx tsc --noEmit`, `./node_modules/.bin/oxlint .`, `npm run test`,
   `./node_modules/.bin/vitest run --config vitest.browser.config.ts`). Commit thematically per feature.
5. **Phase B checkpoint** after Batch 3 + integrations: tell user to push; run live `qa-sweep`.
6. **Then Phase C: tables** (ceiling), then encrypt/decrypt (overlaps exportService — NOT parallel),
   then hardening (engine split `contentStreamEditor.ts` ~1499L, a11y/SEO, command tests).

**State:** Sprint 3 batch 2 LANDED, not pushed — commits `69a9024` (TJ kerning), `9842394` (DOCX
hyperlinks/JPEG/nesting/H4-6), `361de7c` (docs). Plus batch 1 `873dd37`/`5a95192`/`7730110`/`19fe3e4`.
Gate green: jsdom **858**, browser **12/12**, type-check clean, oxlint 0/0. Working tree clean except the
3 personal PDFs.

**HARD REMINDERS:** NEVER commit/stage the 3 personal PDFs (CV/attestation = personal data; black-box
only, never print contents); `test-document.pdf` is the safe fixture. git push is MANUAL. NO
Co-Authored-By. Run vitest/oxlint via `./node_modules/.bin/*` (PATH versions are rtk-proxied → bogus
output). `gh` not installed (use GitHub API via curl). Run the true-edit/DOCX/feature browser tests with
`./node_modules/.bin/vitest run --config vitest.browser.config.ts`.

---

### (original resume context, pre-batch-1)

**State — all committed, all green, CI green.** Sprint 2 landed: commits `780193d` (true-edit A-1..A-5),
`d662f98` (DOCX B-1..B-5), `45a8423` (docs), `7dd7fd2` (CI flake fix: retry on `issue1-toolbar-dnd`).
Gate last run: type-check clean, oxlint **0/0**, jsdom **832**, browser **11/11**, real-Chrome manual QA
0 errors. **CI is green** (deploy.yml runs type-check→lint→jsdom→`test:browser`→build→deploy; browser
suite IS integrated). All pushed by user. Working tree: only the 3 untracked PDFs.
**RESTART `npm run dev` (:5173) post-compact.** NEVER commit the CV/attestation (personal data) — use
them BLACK-BOX only (structural metrics, never print contents); `test-document.pdf` is the safe fixture.
git push is manual; commits = thematic; NO Co-Authored-By. Run browser tests with
`./node_modules/.bin/vitest run --config vitest.browser.config.ts` (PATH `vitest`/`npx vitest` =
rtk-proxied global nightly → bogus output). `gh` CLI is NOT installed; use the public GitHub API via
`curl` for CI status (logs need a token we don't have).

**NEXT = Sprint 3 — Fidelity & UX Deep Sweep (user-chosen).** Goal order: **(1) scorecard + fix every
reachable gap + honestly mark the unreachable ceiling, THEN (2) attempt the fundamentally-hard items.**
Full detail below in "## Sprint 3 — Fidelity & UX Deep Sweep". Method = HYBRID: parallel static-research
agents write raw findings to `docs/reviews/research-2026-06-15/` (they CANNOT drive a browser); the
**empirical browser testing (DOCX export, true-edit clicks, UX/intuitiveness) is run live by the main
loop** + TDD fixes + parent full gate. Known live-found UX defect to fold into Track 3:
**text tool** — blank-add isn't draw-to-place (can't drag to size like shapes) AND an added box can't be
deleted/resized/rotated because edit-text mode keeps intercepting → re-adds/displaces. Recommended fix:
**separate "Add Text" (draw-to-place) from "Edit PDF text" (click existing)**, auto-switch to Select after
placing (reverts the ISSUE-5 unification).

---

## Sprint 3 — Fidelity & UX Deep Sweep (ACTIVE)

**Goal (user-ordered):** **Phase 1** = build a per-attribute *fidelity scorecard*, fix every **reachable**
gap, and honestly **mark the unreachable ceiling**. **Phase 2** (after Phase 1 lands) = attempt the
**fundamentally-hard** items knowing ROI/certainty is low. Do NOT chase "100%" as a number — measure,
fix-reachable, document-ceiling.

**Method = HYBRID.** Static analysis fans out to parallel agents (write raw findings to
`docs/reviews/research-2026-06-15/`); empirical browser work is run **live by the main loop** (agents are
headless, cannot drive Chrome). Every fix is TDD; parent runs the full gate (type-check + oxlint 0/0 +
`npm run test` + `./node_modules/.bin/vitest run --config vitest.browser.config.ts`) before any commit.
Corpus: `test-document.pdf` + synthetic per-attribute fixtures in `tests/fixtures/` + (BLACK-BOX only,
never print contents) the personal CV/attestation for structural metrics. Prior raw research to build on:
`docs/reviews/research-2026-06-14/01-true-edit.md` + `02-docx-fidelity.md`.

### Track 1 — DOCX fidelity scorecard
Per-attribute measure → fix-reachable → mark-ceiling. Attributes & current state (post-Sprint-2):
DONE: font family allow-list (B-1), size, bold/italic name-sniff, margins (B-2), para/line spacing (B-3),
L/C/R + justify (B-5), indent (B-5), bullet+ordered lists (flat), headings (size cluster), images
position/size (B-4 floating), redaction-aware extraction (Sprint 1), per-page sections, RTL flags.
REACHABLE GAPS (Phase 1 fix): underline/strike (path-seg detect), hyperlinks (`getAnnotations`→
`ExternalHyperlink`), super/subscript (baseline+size ratio), list nesting (x0 buckets) + wider marker
regex (a)/i./(1)), heading bold/caps signal + H1-H6, color robustness (replace origin-keyed `colorMap`;
handle scn/Separation→black bug B7), JPEG photo re-encode (stop PNG bloat), rotated/skewed image sizing.
CEILING (Phase 2 / mark honest): lattice tables (vector ruling detect), borderless tables (chronic FP),
vector→region rasterization, recursive 3-col/мixed XY-cut + tagged-PDF `getStructTree` fast path,
headers/footers routing, RTL logical reorder + Arabic presentation-form normalization, exact subset-font
face matching (no embedded file = impossible). Editor overlay annotations in DOCX = product decision.

### Track 2 — True-edit fidelity scorecard
Edge-case matrix already enumerated in `01-true-edit.md §3` — re-verify each post-Sprint-2 (live + browser
tests): standard/subset/CID/Type3/embedded × ASCII/accent/€/ligature/kerned-TJ/CID-multibyte; cm-transformed;
Form-XObject (now overlay); nested XObject; rotated page; RTL/Arabic; vertical/WMode (now refuse); invisible
Tr (now refuse); encrypted (overlay); scanned (add-box); tagged (breaks MCID). For each: which path
(1 literal / 2 subset-reuse / 3 redraw / overlay / refuse) and is the result visible + extractable + correct?
REACHABLE GAPS (Phase 1): TJ kerning preservation (re-distribute vs collapse — roadmap A5, NOT yet done),
B7/B8 fill-color scn/Separation + `Tr` color tracking, number-tokenizer hardening (B1). CEILING (Phase 2):
cm scale/rotation in Path-3 redraw (A6), rotated-page location/placement, RTL shaped-glyph encoding +
embedded Arabic fallback font, Type3 true-edit, PDFium-WASM moonshot.

### Track 3 — UX / intuitiveness sweep (live browser; qa-sweep skill)
Drive the real app. **Fold in the live-found text-tool defect** (blank-add not draw-to-place; added box
can't be deleted/resized/rotated because edit-text keeps intercepting → re-add/displace). Recommended fix:
**separate Add Text (draw-to-place, drag like shapes) from Edit PDF text (click existing)**, auto-switch to
Select after placing/editing. Broader sweep: tool discoverability / easy-find / labels, the
add→select→transform→delete loop for EVERY element type, keyboard + focus, mobile/touch nav (44px targets),
a11y of the editing flow (axe-core), empty/error states, modal Esc, i18n completeness on new strings.
Output: prioritized UX findings (SYSTEMIC vs PAGE vs MOBILE) + TDD fixes for the defects.

### Execution order (resume)
0. Restart dev server; confirm gate still green.
1. Fan out parallel research agents (Track 1 gap-detail, Track 2 matrix re-verify, Track 3 static UX/a11y
   read) → raw files in `docs/reviews/research-2026-06-15/`. Cap ≤5 concurrent LLM agents.
2. Build the two scorecards (DOCX, true-edit) from a fixture corpus — main loop runs the empirical
   browser/export measurements; write `docs/reviews/research-2026-06-15/scorecard-*.md`.
3. Live browser UX sweep (Track 3) including the text-tool repro.
4. PHASE 1 fixes (reachable gaps), TDD each, thematic commits, gate green, manual QA.
5. PHASE 2 attempts (hard items), clearly labelled experimental; keep or honestly mark unreachable.
6. Update KNOWN_ISSUES.md / CLAUDE.md / FEATURES.md as each lands.

---

### Headline finding: CLAUDE.md & docs are STALE (P1 correctness-of-docs)
Two agents independently found the docs misdescribe the real config — fix before anything cites them:
- `i18n.ts:71` is `escapeValue: true` (SAFE), not `escapeValue:false` as CLAUDE.md claims.
- `vite.config.ts` is `registerType: 'prompt'`, not `'autoUpdate'` — pushes do NOT silently update open sessions; there's a saved-session restore prompt (live-confirmed).
- God-object / export-triplication / handler-coupling smells are RESOLVED (commands/, binders/, exportPipeline, IAppContext) — CLAUDE.md still describes them as open.
[Verified: agents 3 & 4, file:line]

---

## Workstream A — True PDF text edit: reliability & fidelity (HEADLINE)
Goal: maximize the fraction of clicks that yield a real, correct in-place edit; degrade gracefully and visibly otherwise.

| ID | Item | Sev | Effort | Evidence |
|----|------|-----|--------|----------|
| A1 | **XObject replace silently no-ops** → make it fall back to overlay instead of losing the edit (B4) | P1 | 2h | Verified (control flow) |
| A2 | **4pt collateral blanking** — `blankAllNearby` over-blanks distinct adjacent text (B5) | P1 | 4h | Verified |
| A3 | **Raise match rate**: tune `TRUE_EDIT_TOLERANCE`/multi-candidate scan; add occurrence-hint for multiple show-ops sharing one origin | P1 | 1-2d | Verified |
| A4 | `replaceShowOpHex` only replaces first TJ segment (B3); `cmapHexToUnicodeStr` parity heuristic wrong for ligatures/non-BMP (B2) | P1 | 1-2d | Inferred (code) |
| A5 | **TJ kerning preservation** — same-line neighbors shift after edit | P2 | 1-2d | Verified |
| A6 | `cm`/`Tm` scale + rotation in Path-3 redraw (currently mis-oriented); rotated pages | P2 | 1-2d | Verified |
| A7 | Detect Type3/vertical-WMode/`Tr` invisible-OCR layers → force overlay (don't pretend to edit) (B8) | P2 | 4h | Inferred |
| A8 | fillColor `sc/scn` parse so redraw keeps original color (B7); empty-hex U+0000 injection (B6); number-tokenizer sign drop (B1) | P2/P3 | 1d | Inferred |
| A9 | RTL/Arabic true-edit (std fonts lack glyphs) | P3 | 1-2wk | Verified hard |
| A10 | **Harness**: add fixtures (standard/subset/CID/XObject/rotated/RTL/TJ-kerned) to `tests/browser/` proving each path's behavior | P1 | 1d | — |

UX: merge "Add Text" + "Edit PDF text" buttons into one unified mode (ISSUE-5 follow-up); surface a clear toast when an edit fell back to overlay vs true-edit, so users understand the behavior they're seeing.

## Workstream B — DOCX export: toward near-100% fidelity
| ID | Item | Sev | Effort |
|----|------|-----|--------|
| B0 | **Redaction not applied to DOCX export** — if redaction+DOCX combine, redacted source text leaks (security) | P0 | 4h |
| B1 | Broaden font allow-list beyond 3 generics (biggest body-text wrongness) | P1 | 1d |
| B2 | Emit page margins, paragraph/line spacing | P1 | 1d |
| B3 | Robust color (replace fragile origin-keyed lookup) | P1 | 0.5d |
| B4 | Image positioning (currently dumped centered at page end, ignoring x/y) | P1 | 1d |
| B5 | Underline/strike/super-subscript/justify/indentation | P2 | 2d |
| B6 | Lattice (ruled) table detection via vector grid | P2 | 3-5d |
| B7 | Vector-region rasterization (logos/charts via `constructPath` → image) | P2 | 2d |
| B8 | Hyperlinks; list nesting/restart; recursive XY-cut (>2 col) | P2 | 2-3d |
| B9 | `getStructTree()` tagged-PDF fast path (exact, ~15% of PDFs) | P3 | 3d |
Fundamentally hard (flag, don't over-promise): exact subset-font matching, borderless tables, reading order on untagged complex layouts, vector→editable, RTL reorder.

## Workstream C — Lint zero-tolerance + type safety
- C1: Fix all **76 oxlint warnings** — 38 require-await (drop `async`), 19 no-explicit-any (→`unknown`/real types), 10 no-console (remove/guard), 9 no-shadow (rename). [Verified: counts]. Effort: 0.5-1d.
- C2: Remove ~41 stale `eslint-disable` comments (reference the removed tool). 1h.
- C3: Replace avoidable `any` in correctness paths (`moveCmds as any`, `pdfElementRenderer` ctx, `textSearchHandler`). 0.5d.

## Workstream D — Architecture
- D1 (P1): **pdfjs-document memory leak** — `ReplaceSourcePdfBytesCmd` pins multi-MB pdfjs docs on the history stack; `historyManager._push` evicts via `shift()` with no `dispose()`/`.destroy()`. Add a disposer hook on command eviction. 0.5d.
- D2 (P1): **`core/commands/` has zero unit tests** — undo-correctness core. Add pure-logic tests. 1d.
- D3 (P2): split `contentStreamEditor.ts` (1406) → tokenizer/matrix/fonts/edits (pure file move). 0.5d.
- D4 (P3): remove dead code (`diagnosePage`, `getFormXObjectMatrix`); 5 fake-async fns (overlaps C1).

## Workstream E — Cross-cutting (a11y / i18n / mobile / SEO-PWA)
- E1 (P1): canvas annotations need role/tabindex/aria-label (`elementLayerRenderer.ts`) — keyboard+SR can't enumerate elements. WCAG 2.1.1/4.1.2.
- E2 (P1): toasts not announced — add `role/aria-live` to `#toast` + `toastQueue.ts`. WCAG 4.1.3.
- E3 (P1): hardcoded English update toast `main.ts:16` (key `toast.appUpdateAvailable` already exists) — wire to `t()`.
- E4 (P2): desktop `.btn-icon` min-height (2.5.8); `prefers-reduced-motion`; disablable single-key shortcuts (2.1.4); `rel=noreferrer` on GitHub link; tablet breakpoint (toolbar overflow at one 640px bp); SEO description/OG/Twitter meta; PWA raster icons (currently SVG-only → installability).
- E5 (P3): muted-text contrast; robots/sitemap.
- E6: locale files are **key-identical (313 keys, 0 diff)** — PASS; Arabic values still need native-speaker review (mark DRAFT in FEATURES.md). Find any remaining hardcoded user-visible strings (E3 is the known one).

## Workstream F — Security
- F1 (P0): redaction-in-DOCX leak (= B0).
- F2 (P3): document that raw PDF bytes sit unencrypted in IndexedDB (by-design, privacy note in SECURITY.md/README).
- F3: XSS risk LOW — all `innerHTML` are `= ''` clears, no `insertAdjacentHTML/eval/document.write`, no external loads, CSP present. No action beyond keeping `escapeValue:true`.

## Workstream G — New features roadmap (research-confirmed, MIT/Apache only, 100% client-side)
**Tier 1 (quick, high-value):**
- G1 Merge / Split / Extract / Reorder / Delete / Rotate pages — almost free with @cantoo/pdf-lib + fflate. [Verified] S.
- G2 Encrypt (cantoo `.encrypt()`, nearly free) + Decrypt/remove password (pdf.js decrypts with user password → re-save unencrypted). [Verified] S-M.
- G3 PDF compression/optimize (image downsample + re-embed). [Inferred] M.
- G4 Form flattening; flatten annotations. [Verified] S-M.
**Tier 2:**
- G5 **OCR searchable layer** — `tesseract.js` (Apache-2.0) + pdf.js raster + invisible text layer; lazy-load like the docx chunk. Flagship differentiator. [Verified] M-L.
- G6 Compare two PDFs — `pixelmatch` (MIT) + `diff` + pdf.js. [Verified] M.
- G7 Page numbering / Bates stamping (must hit all 3 export paths). M.
**Tier 3 (moonshots / flagged):**
- G8 **Cryptographic e-signature (PAdES/PKCS#7)** — `zgapdfsigner` (MIT, node-forge core) signs with a P12/PFX entirely in-browser, PAdES via `ETSI.CAdES.detached`. [Verified feasible] L. High value, key UX/security design needed (cert handling).
- G9 PDF/A — only via Ghostscript-WASM = **AGPL + 18MB** → NOT recommended.
- G10 Accessibility tagging — no mature in-browser lib (pdf-lib can't author struct tree) → defer.
Recommended first three: G1, G2, G5.

## Workstream H — Documentation refresh (EVERYTHING)
- H1 CLAUDE.md: fix `escapeValue` (true), `registerType` ('prompt'), resolved architecture smells, true-edit path/bug status, DOCX gap list. (P1 — others cite this.)
- H2 FEATURES.md: mark Arabic DRAFT; correct true-edit fidelity claims; add new-feature roadmap section.
- H3 KNOWN_ISSUES.md: add A1-A9 / B-bugs / D1 / E1-E3 as tracked entries with repro + test-needed.
- H4 README.md / SECURITY.md: IndexedDB privacy note (F2); feature list sync.
- H5 Legal/community pages (CODE_OF_CONDUCT, CONTRIBUTING, THIRD-PARTY-NOTICES): verify new deps (tesseract.js/zgapdfsigner/pixelmatch) licenses get added when those features land.
- H6 locales: add keys for any new UI; keep 3-way parity (hook enforces); commission Arabic native review.

## Workstream I — Test harness expansion (empirical vehicle)
- I1: edge-case PDF fixtures for true-edit (A10) and DOCX fidelity (per-dimension) in `tests/browser/`.
- I2: unit tests for `core/commands/` (D2) and pure utils (hitTest/geometry/binaryUtils).
- I3: an export-assembly jsdom test.

## Suggested execution sequencing (post-approval)
1. **Sprint 0 (safe, no-risk):** H1 docs-truth fixes + C1/C2 lint-zero + D4 dead code + F2 note. (1-1.5d)
2. **Sprint 1 (security + headline bugs):** B0/F1 redaction leak, A1/A2 true-edit bugs, D1 memory leak, E1-E3 a11y P1. (2-3d)
3. **Sprint 2 (fidelity):** A3-A6 true-edit match-rate/kerning/transform; B1-B4 DOCX P1. (1wk)
4. **Sprint 3 (features Tier 1):** G1 pages, G2 encrypt/decrypt. (1wk)
5. **Sprint 4 (flagship):** G5 OCR or G8 e-signature (pick one). (1-2wk)
Each item is TDD: failing test (jsdom or browser harness) first, then fix; full gate (type-check + lint + test + test:browser) before commit.
