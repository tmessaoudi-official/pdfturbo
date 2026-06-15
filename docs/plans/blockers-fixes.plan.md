# Blockers Fix Sprint — Plan (2026-06-15)

Fix the confirmed blockers from `docs/reviews/research-2026-06-15-blockers/CONSOLIDATED.md`.
Scope = **Option 1 (both P0s) + Option 2 (top reachable batch)**, agreed by the user.
Each fix flips its `tests/blockers/*.blockers.test.ts` `it.fails` to a passing `it` (the built-in
finish line). TDD: convert the `it.fails` → normal `it` FIRST (it goes red), then implement until green.

## Decisions Log
- [2026-06-15] AGREED: Do Option 1 (P0s) AND Option 2 (reachable batch). (AskUserQuestion)
- [2026-06-15] AGREED: User compacts BEFORE implementation; this plan is the full durable state. Resume = read THIS file.
- [2026-06-15] RECOMMENDED START ORDER (security-first, then cheap-high-ROI): P0-1 → P0-2 → B-3/B-1 → O1 → MD/TXT → AR-1.
  Rationale: P0-1 is the most severe (data exposure); P0-2 is bounded jsdom; the reachable batch is cheap and momentum-building.
- [2026-06-15] NOTE: research + tests pass already committed (23e1ceb). Unpushed: 23e1ceb (blockers), 48ed109 (a11y), c3f57e9 (OCR). Push is MANUAL.
- [2026-06-15] FINDING (fix #1): CORE-P0-1 was MISLOCATED by the research agent. Empirical browser test proved the raster `fillRect` path is CORRECT at all rotations (3rd source-read false positive this session). The real leak was the flow-export (DOCX/MD/TXT) path — FIXED. Verify-before-fix paid off again.

## State at plan time
- HEAD = 23e1ceb. Tree clean. Gate green: tsc 0 / oxlint 0/0 / jsdom 1012 pass + 11 expected-fail.
- The 11 `it.fails` tests are the work list. Each fix = flip one (or more) to passing.
- SECURITY: never read/print private PDFs (tests/fixtures/private/*, AUDENSIEL_*, AttestationDeDroits_*, Assist_*). Use synthetic / test-document.pdf / tests/fixtures/qa-*.pdf. Structural metrics only.
- Tooling: ALWAYS `./node_modules/.bin/{tsc,oxlint,vitest}`. Browser: `./node_modules/.bin/vitest run --config vitest.browser.config.ts`. oxlint: no `!` (no-non-null-assertion), no `any` (warn), prefix unused with `_`. Test setup swallows console.log → use `fs.writeFileSync` for diag.

---

## Fix list (ordered; each: blocker → file:line → fix → test that flips → env/effort)

### 1. CORE-P0-1 — rotated-page redaction  ✅ DONE (2026-06-15) — RE-SCOPED
**Outcome:** the raster `fillRect` claim was a FALSE POSITIVE (empirically: 0 leaked pixels at all 4
rotations). The real leak was the **flow-export (DOCX/MD/TXT)** path. Fixed: `reconstructPage` gained a
`pageRotation` arg + new pure `geometry.redactionRectToContent` un-rotates rects; `_extractFlowDoc`
passes `totalRot`. Guards: `tests/browser/blockers-redaction.browser.test.ts` (12, RED→GREEN @90/180),
`tests/core/exportCoords.test.ts` (helper). Gate green: tsc 0 / oxlint 0 / jsdom 1016+11 / browser 31.
Residual: intrinsic-`/Rotate` source pages still approximate in flow-export (documented). _Original notes below._

#### (original) CORE-P0-1 — rotated-page redaction pixel leak  [P0, security]
- file:line: `src/export/exportPipeline.ts:225-233` (fillRect) ; rotation at `:207` (`totalRot`), `:210-211` (w_eff/h_eff), SCALE=2 `:216`.
- Fix: before `ctx.fillRect`, transform the redaction rect from unrotated editor space into the rotated viewport space using `totalRot` (rotate the 4 corners about the page center / map via the same viewport the canvas uses). Mirror how pdf.js viewport rotates content. Cover the rotated AABB of the rect.
- Test to ADD (designed, deferred): `tests/browser/blockers-redaction.browser.test.ts` — build a 1-page PDF with text at known coords, set docPage.rotation=90, add a redaction over it, call `rasterizePageWithRedactions` (8 args: srcDoc, docPage, elements, targetPdfDoc, libs, watermark, inkLayer, reportError — see signature at exportPipeline.ts:171), render the output page back to a canvas, pixel-sample the rotated location → assert fill color (today: glyph ink). Also keep a jsdom byte-absence assertion (passes both before/after).
- Effort: M (browser harness is the work; geometry fix is small). Heaviest item.

### 2. CORE-P0-2 — encryption AES-128→256 + permissions + owner≠user  [P0]
- file:line: `src/export/exportService.ts:297-301` (`encrypt({userPassword, ownerPassword})` — no algorithm/permissions); `src/ui/binders/modalBinder.ts:186-194` (owner defaults to user `:189`).
- Fix: (a) set the PDF header to `1.7ext3` (or whatever @cantoo/pdf-lib needs) BEFORE encrypt → V5/R6 AES-256; verify the lib's encrypt API surface. (b) pass an explicit `permissions` object so a plain password lock does NOT strip print/copy/a11y. (c) stop defaulting owner==user in modalBinder (require/allow a distinct owner pw, or document clearly).
- Test that flips: `tests/blockers/core-security.blockers.test.ts` CORE-P0-2 `it.fails`→`it` (assert AESV3/V5). Update the pin. Add a permissions assertion if cleanly decodable from `/P`.
- Effort: S–M. Verify @cantoo/pdf-lib AES-256 path first (CONSOLIDATED CORE-C2 flagged it borderline-reachable).

### 3. True-edit B-3 ligature refusal + B-1 exponent  [reachable, cheap]
- B-3 file:line: `src/utils/contentStreamEditor.ts:1294` (`font.encodeText` redraw), refusals end `:1273`. Fix: add `if (hasNonWinAnsi(newText)) return false;` guard next to the `isArabicText` refusal at :1271 (refuse→overlay instead of painting a wrong glyph). Need a `hasNonWinAnsi(text)` predicate (codepoint > 255 or outside WinAnsi map). NOTE: `replaceTextAt`/`isArabicText` are NOT exported — add the test against an exported seam or export `hasNonWinAnsi`.
- B-1 file:line: `:153,156` (main) + `:193,196` (tokenizeOne) — continuation class `[0-9.]` excludes `e`/`E`. Fix: extend the number continuation to accept an exponent (`e`/`E` followed by optional sign + digits) so `1e-3` is one number token. Careful: don't swallow a real `e` operator (numbers only).
- Tests that flip: `tests/blockers/trueedit.blockers.test.ts` B-1 (value≈0.001 + round-trip) → passing. Add a B-3 test (needs the predicate exported).
- Effort: B-3 ~1 line + predicate; B-1 ~2-line regex in two places. Both jsdom.

### 4. OCR O1 — language parity  [reachable, cheap]
- file:line: `src/ocr/languages.ts:24-33` (8 langs) vs `scripts/prepare-ocr-assets.mjs:41` (`LANGS=['eng','fra','ara']`).
- Fix (pick one): (a) extend the vendor `LANGS` to all 8 advertised codes (more assets ~10MB each → dist size), OR (b) trim `OCR_LANGUAGES` to the 3 vendored (honest UI), OR (c) single source of truth + only advertise what's vendored. Recommend (c)/(b) unless the user wants the +5 languages downloaded.
- Test that flips: `tests/blockers/ocr.blockers.test.ts` O1 `it.fails`→`it`; update the pin (vendored set) accordingly.
- Effort: S. DECISION NEEDED from user: ship 8 languages (bigger) or advertise only 3?

### 5. MD/TXT writers — MD-1/TX-1 ordinals, MD-2 nesting, MD-3 image loss  [reachable]
- file:line: `src/utils/flowDocWriters.ts` — `flowDocToText:115-125`, `flowDocToMarkdown:132-158`. All hardcode `1.`, ignore `listDepth`, never read `page.images`.
- Fix: running ordinal counter per ordered-list instance (reset on non-list para) honoring `listFormat`/`listOrdinalText` (DOCX writer already computes instance boundaries ~`:200-212`); `'  '.repeat(depth)` indent for nesting; emit `![](data:<mime>;base64,<b64>)` (MD) / `[image]` (TXT) for `page.images`.
- Tests that flip: `tests/blockers/docx-md.blockers.test.ts` MD-1, TX-1, MD-2, MD-3 → passing.
- Effort: S–M. Pure jsdom.

### 6. Arabic AR-1 — DOCX reorder via bidi-js  [reachable, correctness]
- file:line: `src/utils/flowDoc.ts:442-463` (`orderLineWords`/`reverseRtlText` majority-vote single-direction). `bidi-js@1.0.3` installed but unused.
- Fix: route the DOCX line reorder through `bidi.getEmbeddingLevels` + `getReorderSegments` so mixed LTR+RTL lines reorder per UAX#9 (Latin/digit substrings stay forward). Overlay raster stays browser-verified (separate, AR-2/AR-3 deferred).
- Test to ADD: jsdom on the reorder helper with a mixed `"PDF ملف"` line → assert correct logical order (today majority-reverse mangles the Latin). (Not currently in tests/blockers — add `arabic.blockers.test.ts`.)
- Effort: M. Pure-ish jsdom (the DOCX helper).

---

## Per-fix gate (every item)
1. Flip the `it.fails`→`it` (or add the new test) → confirm RED for the right reason.
2. Implement the fix.
3. `./node_modules/.bin/tsc --noEmit` · `./node_modules/.bin/oxlint .` · `./node_modules/.bin/vitest run` → green (the flipped test now passes; 0 expected-fail for that item).
4. Browser items: `vitest run --config vitest.browser.config.ts`.
5. Update CONSOLIDATED.md + scorecards + KNOWN_ISSUES for the now-fixed item. Commit per fix (feat:/fix:), no Co-Authored-By. Push manual.

## Open decisions to resolve at resume
- O1: ship all 8 OCR languages (≈+50MB assets) vs advertise only the 3 vendored? (default: advertise 3 / single source of truth)
- P0-2: confirm @cantoo/pdf-lib exposes the AES-256 (1.7ext3/V5) path before promising it; if not, fix permissions + owner≠user and document AES-128 honestly.
