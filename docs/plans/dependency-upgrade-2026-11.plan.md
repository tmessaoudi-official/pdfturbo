# Dependency upgrade 2026-11 Plan

Take every dependency to its latest release, including the two the 2026-11-10 upgrade held back:
`pdfjs-dist` 6.3.289 → 6.5.438 and `i18next` 26.7.2 → 27.1.1. Three commits in risk order, each with a full
deploy gate, so the riskiest one can be reverted alone.

## Decisions Log
- [2026-11-14 11:37] AGREED: Upgrade every dependency now, including pdfjs-dist 6.5.438 and i18next 27.1.1 — the developer's pick of option 4, which lifts the 2026-11-10 hold on pdfjs-dist (its own task) and the two-week deferral of i18next 27.
- [2026-11-14 11:37] AGREED: Size Large, three commits in risk order: patches, then i18next 27, then pdfjs-dist 6.5 — each with a full deploy gate, so commit 3 can be reverted alone.
- [2026-11-14 11:37] AGREED: Phase 3C tier for this plan: advisor() (developer pick); rounds 1-2, clean at round 2.
- [2026-11-14 11:38] AGREED: Plan gate: Go on the three-commit plan (developer).
- [2026-11-14 11:38] AGREED: P1: fontExtraProperties: true on every pdf.js document (withPdfjsAssets), the retained memory measured in step 6 and brought back to the developer if it passes ~20 MB on the largest fixture.
- [2026-11-14 11:38] AGREED: P5: follow pdf.js on the array-/Contents DCT-marker-last page (it no longer hangs in 6.5), proven by an oracle case with forms present; the single-stream refusal stays (pdf.js 6.5 still hangs, killed at 45 s).
- [2026-11-14 11:38] AGREED: Push: after the gate and the milestone panel, one push of all commits (13 phone-pad + the upgrade); the phone-pad plan row 8 records round 5's correctness lens as OPEN, not done.

## Inventory (measured 2026-11-14)

`npm outdated` (on 1db7502): docx 9.15.3 → 9.15.4, jsdom 31.0.0 → 31.0.1, playwright 1.65.0 → 1.65.1,
vite 8.3.7 → 8.3.8 (patches); i18next 26.7.2 → 27.1.1 (major); pdfjs-dist 6.3.289 → 6.5.438 (held by `~`).
`npm run audit:gate`: ok, 0 exempted. Already latest: `bidi-js` 1.1.0 and `prosemirror-tables` 1.8.5 (exact pins),
`i18next-browser-languagedetector` 8.3.0, `tesseract.js` 7.0.0, the `overrides` (`^` ranges, refreshed by the install),
GitHub Actions checkout v7 / setup-node v7 / upload-artifact v7 / upload-pages-artifact v5 / deploy-pages v5,
Node `engines` >=26 and `.nvmrc` 26. OUT of scope: the tessdata 4.0.0 traineddata (SHA-pinned, its own task).

## What pdf.js 6.4/6.5 changes for us (probes in a throwaway worktree, evidence in `var/claude/deps-upgrade/`)

Untouched source on 6.5.438: jsdom 8 red / 4341 pass (`jsdom-65-untouched.log`), Chrome 3 red / 756 pass
(`browser-65-untouched.log`; 3 OCR reds there were the worktree missing `public/tesseract/`, green after
`npm run ocr:assets`). The 11:

| # | Change in pdf.js | Red here | Fix |
|---|---|---|---|
| P1 | 6.4 #22057: the font `name` is an "extra" property, sent to the main thread only with `fontExtraProperties: true` (`pdf.worker.mjs:25149, 25984`) | `docx-font-names.browser.test.ts` ×2 (`expected 'g_d0_f1' to be 'AokinMincho'`) | the flag — both cases green with it (probe). Cost: pdf.js then keeps every font's data and glyph paths on the main thread (`pdf.mjs:14696, 13065`) |
| P2 | `StreamsSequenceStream.readBlock` writes `0x0a` after every member of an ARRAY `/Contents`; a single stream gets none (`pdf.worker.mjs:3951-3954, 59418-59442`) | `inlineImagePdfjs` ×4, `prunePdfjsDifferential` ×1 | `copySourcePages.ts` `contentOf`: `'\n'` after each member when `/Contents` is an array; the tests' own joins likewise; re-measured oracle premises; differential pins 715/2285 → 663/2337 (drawing re-read) — probe: 0 disagreements on 3000 seeds |
| P3 | `findASCII85DecodeInlineStreamEnd` ends at the FIRST `~` (6.3: `~`, whitespace, then `>` or `EI`) | none — no test reaches it (the generator only writes `z~>`) | `contentStreamEditor.ts` A85 case; oracle cases red FIRST, both directions; a `~` piece in the differential generator |
| P4 | 6.5 #22375: a failed xref section's `_tableState`/`streamState` is deleted before the next (`XRef`) | `pdfLoadGuard` ×2, `ws8AuditShapes` P5_X5, `pdf-load-guard.browser` ×1 | test premises only: the guard compares pdf.js with pdf-lib at run time (no copy in `src/`). Probe: both shapes now `SIGNED` → `loaded`; `objectZeroInUseBeforeTable` / `prevIndirectUnreadable` still `''` → `PdfPageMismatchError` |
| P5 | the array-`/Contents` DCT-marker-last page no longer hangs pdf.js (~23 ms); the single-stream one still does (killed at 45 s) | `a DCT marker as the last byte of the page` (array half, once P2 lands) | single stream: keep the refusal. Array: see Decisions |

Read and unchanged for the prune: `EvaluatorPreprocessor` (0 hunks), `ObjectLoader` (0), the `Do`/`Tf`/`gs`/`scn`/`sh`/
`BDC` handling and error stops in `PartialEvaluator`; `Page` hunks are annotation-save popups and refactors; worker
rendering (#21860) stays OFF for us (`RendererWorker.isAvailable` needs `rendererSrc`/`rendererPorts`, `pdf.mjs:15526`;
`src/` sets neither). Changed and covered only by the suites: text-content spaces (`glyph.isSpace` replaces char code
0x20), vertical glyph widths, `differences`/`toUnicode` as maps, Type3 alpha reset (#22284), text layer no longer
re-laid-out on update (#22045). Vendored assets: `cmaps` 169, `iccs` 2, `standard_fonts` 16 unchanged; `wasm/` adds two
QuickJS licence files only (not shipped).

## Formal Plan

**Commit 1 — patches (S).** `npm install` docx@^9.15.4 jsdom@^31.0.1 playwright@^1.65.1 vite@^8.3.8 (+
`@vitest/*` unchanged); full deploy gate (Node 26.13.1); docs: `toolchain.md` upgrade line. Accept: gate 9/9 rc=0.

**Commit 2 — i18next 27.1.1 (M).** Read the v26→v27 migration guide in full first. Our config already sets
`fallbackLng: 'en'` (`i18n.ts:78`); 0 empty values in 3×667 keys (`returnEmptyString`); `/` no longer escaped in
interpolated values (`escapeValue: true`, `i18n.ts:91`); language-code validation vs the detector's codes
(`load: 'languageOnly'`). Test first where behaviour changes; full gate; `toolchain.md` § "`pdfjs-dist` is held"
paragraph on i18next 27 rewritten. Accept: gate green, EN/FR/AR UI unchanged (sweep + a screenshot per locale).

**Commit 3 — pdfjs-dist ~6.5.438 (L).** In order, every step red first:
1. `package.json` `~6.5.438`; confirm the 11 reds reproduce in the repo (not only the worktree).
2. P3: new oracle cases (pdf.js asked) — `~` then a draw before `>`/`EI`, both the over-keep and the under-keep
   direction; red on the 6.3 mirror; then the A85 case; `~` piece in the generator.
3. P2: `contentOf` newline per array member, the comment at `copySourcePages.ts:1111-1112` rewritten (R2C-1's
   reason is gone in 6.5); `joined()` in `inlineImagePdfjs` and the differential's join; the R2C-1 premises and the
   TJ-across-two-streams stop re-measured; differential pins re-measured incl. `drawing`.
4. P5 per the ruling; an oracle case WITH forms present for the array half.
5. P4: the three shapes move to the controls with their fixture comments re-measured on 6.5; the browser case too.
6. P1 per the ruling; the memory measurement recorded.
7. Every `6.3.289` citation in `src/` and `.claude/rules/` (~25) re-checked against 6.5: unchanged function → version
   and line updated; changed function → the claim re-measured.
8. Docs: `toolchain.md` hold entry → resolved; `redaction.md` "the mirror follows pdf.js 6.3.289" → 6.5.438;
   `KNOWN_ISSUES.md` if a bound moves.
9. Full deploy gate incl. `qa:sweep --allow-destructive --require-sw` on `vite preview`; sabotage: drop the newline →
   the P2 cases red; restore the 6.3 A85 rule → the P3 cases red.

**Then:** 6C (tier asked), the milestone three-lens panel on the frozen commit 3, ONE push, `/ci-watch`.
Rollback: `git revert` of commit 3 alone restores `~6.3.289` (commits 1–2 stand).

## Status
<!-- progress-block v1 -->
| # | Step | Size | State | Evidence | Files |
|---|------|------|-------|----------|-------|
| 1 | Patches: docx, jsdom, playwright, vite + full gate | S | done | docx 9.15.4, jsdom 31.0.1, playwright 1.65.1, vite 8.3.8 (`npm ls`); full deploy gate 9/9 rc=0 on Node 26.13.1 (`var/claude/deps-upgrade/gate-1.log`: jsdom 4349, Chrome 762, coverage 9, QA sweep --allow-destructive --require-sw 165 checks / 123 pass / 0 fail / 42 skip) | package.json, package-lock.json, .claude/rules/toolchain.md |
| 2 | i18next 27.1.1 (migration guide read first) + full gate | M | todo | - | package.json, package-lock.json, src/utils/i18n.ts, tests/**, .claude/rules/toolchain.md |
| 3 | pdfjs-dist ~6.5.438: P1–P5 test-first, citations re-checked, docs, full gate, sabotage | L | todo | - | package.json, package-lock.json, src/export/copySourcePages.ts, src/utils/contentStreamEditor.ts, src/utils/pdfjsParams.ts, tests/**, .claude/rules/{toolchain,redaction,export,pdfjs}.md |
| 4 | 6C + milestone three-lens panel on the frozen commit, one push, /ci-watch | M | todo | - | |
<!-- /progress-block -->
### Blocked
### Needs input
- P1, P5 and the push: rulings at the plan gate (2026-11-14).
