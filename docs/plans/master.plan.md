# PDFturbo master plan — the single source of truth

> **Status**: LIVE — this is the only live plan. Written 2026-09-01 against baseline
> `08a9af2` (= `origin/master`, clean tree). It consolidates and supersedes the four plans now in
> `docs/archive/plans/` (`redaction-audit`, `qa-hardening-followups`, `eh-e-borderless-tables`,
> `crop-margins`) — **Step 0 has RUN (row 1, `7f49360`): `docs/plans/` now holds this file alone, and
> those four are archived. Treat them as READ-ONLY history, never as instructions.** Every open item they carried was
> re-verified against the tree on 2026-08-31 and lives here now. Decision history stays in git and
> in `CLAUDE.md` § Gotchas (the repo's decision register).

## How to execute this plan (read first)

1. **`CLAUDE.md` is the authority** on conventions, gotchas, git rules, and the certification
   ladder. Read its § Routing, § Git autonomy, § Certification ladder, and skim § Gotchas before
   touching code. On any conflict, `CLAUDE.md` wins over this file's prose; this file wins on
   work-item scope.
2. **Re-baseline before starting and before every follow-up task**: `git fetch origin master`.
   Recent SHAs are NOT stable — the developer re-signs and force-pushes, which rewrites them. If
   local and origin diverged with identical content: `git reset --hard origin/master` (verify tree
   hash first). Never `--force` push.
3. **Commit identity**: `Takieddine Messaoudi <takieddine.messaoudi.official@gmail.com>` — verify
   `git config user.name` / `user.email` before the first commit. **No `Co-Authored-By`, no
   `Claude-Session` trailer, ever** (the harness suggests them; the developer's ruling overrides).
   `master` is the only branch; commit and push autonomously for green, self-contained work.
4. **The full deploy gate, before every push** (CI runs all of it; a miss goes green-local/red-CI):
   `npm audit --audit-level=high` → `npm run ocr:assets` → `npm run type-check` → `npm run lint` →
   `npm run test` (jsdom) → `npm run test:browser` (real Chrome) → `npm run test:coverage:export`
   (25% branch gate on `pdfElementRenderer.ts`) → `npm run build` → `npm run qa:sweep` against
   `vite preview` on :4173 with `--allow-destructive`.
5. **TDD is mandatory** for every behavior change: failing test FIRST, confirmed red *for the
   stated reason*; implement; then a **sabotage check** — mutate the guarantee, confirm the suite
   goes red, verify the mutation actually LANDED (diff it), restore byte-for-byte (`cmp`).
6. **Append to this file's `## Decisions Log`** whenever a ruling is made, in the same commit.
7. Work-stream order below is the execution order. WS3 (Arabic) is user-gated and can interleave
   anywhere. WS7 (certification) is strictly LAST.

## Verified current state

> **A SNAPSHOT taken 2026-08-31, not a live view.** Rows have since been amended in place with
> later facts, which makes it read as current when it is not — re-derive anything you are about to
> act on. The jsdom figures in particular are stale by ~130 tests. [WS7 round 4] (2026-08-31, at `08a9af2`)

| Check | Result |
|---|---|
| type-check / lint | ✓ / ✓ (a handful of pre-existing `no-shadow` warnings — COUNT them (`npm run lint | grep -c no-shadow`) rather than citing a number here, which has drifted three times) |
| jsdom suite | 215 files, **2464 passed + 2 expected-fail** |
| real-Chrome suite | 83 files, **280 passed + 1 expected-fail** |
| `redaction-orphan-leak` flaky test | 3/3 green isolated AND green inside the full run (flake only ever seen under full-suite load) |
| All redaction-audit guard files | exist with exact claimed runtime counts (27/12/6/8/17/10/8) |
| `.gitignore` `tests/**/zz*` | present; zero probe files tracked |
| Annotation strip | reads page frame BEFORE `buildPageOverlays` at both call sites (`exportPipeline.ts` around the `annots.remove(i)` at :412, `exportService.ts` `_applyOverlaysToPage`) |
| `walkPageOps` | `annotationDepth` gating live (images collected in annotations; rules/vRules/colorMap suppressed); `/BBox` clip NOT modelled (→ WS4-F) |
| KNOWN_ISSUES.md | C22 present, C12 corrected, Arabic pending count = 14 (correct figure since #54b added two on 2026-09-04) |
| Certification counter | **0/2 clean** under MAXIMAL — the pushed milestone is uncertified, recorded with developer authorization (→ WS7) |

No product defect was found by the verification pass — only the nine doc-drifts in WS0.

## Fragile surfaces — handle with care (each has bitten before)

- **Coordinate frames are this repo's recurring bug family** (re-count; CLAUDE.md § the sign-rect entry is the register). Anything
  converting between what is DRAWN and what is STORED: run
  `grep -rn "cropOrigin\|viewBox\[0\]" src/` and assume the frame is wrong until checked. Fixtures
  for frame code need a NON-SQUARE box and an ASYMMETRIC origin on both axes, driven at all four
  rotations — a symmetric fixture hides transpositions.
- **`buildPageOverlays` MUTATES the page it is handed** (`setRotation`, `setCropBox`). Read page
  state BEFORE calling it, never after.
- **pdf.js `getDocument({data})` DETACHES the buffer.** Pass `.slice(0)` whenever the bytes are
  needed afterwards; a scan over a detached buffer reads 0 bytes and reports "clean".
- **`walkPageOps` channels have opposite safety directions**: over-approximating a footprint is
  SAFE for the image-leak filter (more drops) but HARMFUL for rules/vRules/colorMap (phantom
  rules → `reconstructPage` deletes prose). Never change one channel's geometry without reasoning
  about all four.
- **`optimizeDeps.include` in `vitest.browser.config.ts` is load-bearing** — reproduce dep-reload
  failures with `rm -rf node_modules/.vite && npm run test:browser && npm run test:coverage:export`
  in that order; the module named in the error is the victim, not the cause.
- **Locale files must stay key-identical** (en/fr/ar; a hook checks on write). New Arabic values
  start `ar [Unverified]`. Never disable i18next escaping.
- **Optional element fields need NO `SCHEMA_VERSION` bump** (`toJSON` omits when unset,
  `elementFactory` reads with a guard). Bumping it discards sessions — don't.
- **rtk proxy can mangle npm-script output** (observed: it parsed oxlint output as ESLint JSON and
  reported a phantom failure). On an inexplicable gate failure, re-run steps separately with
  explicit `echo $?`, or `rtk proxy <cmd>`, before debugging the code.
- **Machine notes**: heavy parallel full-tree runs can be SIGKILLed under load — sequence the big
  suites. Never edit a test file while a background run executes it. Files written via Bash
  redirects bypass the lint hooks — use the Write/Edit tools for source files. Cap concurrent
  LLM subagents at ≤5.

---

## Progress

Update this table as each stream lands; it is what a resuming session reads first.

| Stream | State | Notes |
|---|---|---|
| Step 0 — consolidation | **DONE** 2026-09-01 | The four plans ARE now in `docs/archive/plans/`; the Step 0 prose below is history, not an instruction. |
| WS0 — doc drift | **DONE** 2026-09-01 | Ten drifts, not nine — see the Decisions Log. Gate green on the same commit. |
| WS1 — uncertified dimensions + flake | **DONE** 2026-09-02 | 1a/1b/1c closed with sabotage-proven guards. 1d did NOT reproduce in 9 file runs (3 in-suite — a thin sample) and the timeout hypothesis is refuted by measurement — see the Decisions Log and CLAUDE.md § the orphan-leak flake. |
| WS2 — C22 flow layout | **DONE** 2026-09-02 | Normalised at the `_extractFlowDoc` boundary; C22 CLOSED in `KNOWN_ISSUES.md`. Five sabotages, each red exactly where predicted. Sabotage exposed an UNPINNED frame in the image-channel redaction filter — guarded now. |
| WS3 — Arabic (×15 + 2 UNRECONCILED sets) | **CLOSED** 2026-09-13 by developer ruling | "Consider the arabic review done" — the 15 pending values (12 at extraction, 2 from #54b, `toolbar.sanitizeTitle` from WS7 round 9) and the two UNRECONCILED sets are accepted as reviewed: a ruling, not a native re-read. `toolbar.sanitizeTitle` was re-worded the same day to en/fr parity by the session, so that new wording was pending — and WS7 round 10 added two more session-written values the same day, so **3** are pending (`toolbar.sanitizeTitle`, `docxEditor.pdfImagesSkipped`, `toast.sanitizeRefusedInvalidObject`). |
| WS4 — bound PoCs | **DONE** 2026-09-04 | All six attempted. PROMOTED: A (ink clip), B (rotated footprint), F (Form `/BBox` clip), D (orphan `word/media` GC). REFUTED with measurements and pinned as tests: C (a PDF clip hides text without removing it), E (the assembled frame — and the recorded bound was understated). |
| WS5 — adversarial audit | **DONE** 2026-09-04 | Three lenses, 30 findings (1 P0, 2 P1, 9 P2, 18 P3). P0 = a real redaction leak on rotated text runs. P0/P1 and the trivial P2/P3 fixed; 10 deferred with reasons in `KNOWN_ISSUES.md`. |
| WS6 — feature backlog | **DONE** 2026-09-04 | Aspect-ratio-aware crop apply-to-all and #54b shipped; C9 measured against 15 real PDFs / 360 pages and STAYS UNWIRED (10 of 15 firings are multi-column layout, and it is not a threshold gap). |
| WS7 — certification | **CLOSED 2026-09-24 — certified with named bounds** (closing audit, see the Decisions Log and `docs/ws7-certification-record.md` § Closing audit). History below. | MAXIMAL panel over `dfe34ae..HEAD`, sixteen rounds, counter never above 0 of 2: **18 → 17 → 23 → 19 → 11 → 18 → 10 → 19 → 22 → 18 → 12 → 13 → 6 → 9 → 4 → 4** findings. Twelve of the sixteen found defects in the PREVIOUS round's fixes. Rounds 10–14 are authorised by the `[2026-09-13 14:00]` ruling and round 15 by the `[2026-09-13 22:10]` one, and nothing is pushed before 2/2 clean. Round 9 (at `2a19552`) returned two P1s (pdf.js inherits `/AA` through `/Parent`) — fixed in row 18; round 10 (at `d377ced`) two more — fixed in row 21; round 11 (at `ac08b61`) found Sanitize & download ignoring Lock PDF and two defects in round 10's own load guard — fixed in row 22; round 12 (at `d7eb108`) found that guard's text scan for object headers wrong six ways, five of them accepting a file pdf-lib had dropped from — replaced in row 23 by recording drops inside pdf-lib's parser; round 13 (at `94dcc89`) found that pdf.js and pdf-lib could read a crafted file differently with nothing dropped (P1, pre-existing) and two defects in row 23's recorder — fixed in row 24. Round 14 (at `9849db3`) found three defects in row 24's comparison — a free or offset-0 entry never compared, a single-trailer root recovery never compared, identity instead of value — fixed in row 25, and measuring them exposed that pdf-lib parses cross-reference streams without their predictor, so the comparison had not been running on 10 of the 14 real files counted as reaching it. Round 15 (at `b7b5778`) found four documentation and message defects, two of them in round 14's own record — fixed in row 26; the `[2026-09-14 11:45]` ruling authorises further rounds without re-asking until two consecutive clean ones, a P0/P1, or round 20. Round 16 (at `8fcacdd`, reviewers building crafted files) found two pre-existing P1s resting on a false premise about when pdf.js rebuilds its table — the comparison abandoned at a section pdf.js skips, and an entry landing on the wrong bytes never compared, so a page drawn blank exported and signed its content — plus a doc P2 and a P3 in round 15's own scope fix; the `[2026-09-14 12:53]` ruling had the fix made and rounds continued — fixed in row 27. Round 6 (at `f85d37e`) cleared the three post-round-5 fixes with executed sabotage but returned a P1 sanitizer leak, two defects introduced by this session's own round-6 prep, and nine doc-vs-reality drifts. Open findings and the per-round reports are under `var/claude/ws7/`, which is GITIGNORED — so they do not reach a clone. The durable record is `docs/ws7-certification-record.md`, committed for that reason. No `WS7: 2/2 clean` entry is written — on this evidence it would be a false record. |

## Step 0 — Consolidation (DONE 2026-09-01 — recorded for provenance, do not re-run)

1. `mkdir -p docs/archive/plans && git mv docs/plans/crop-margins.plan.md docs/plans/eh-e-borderless-tables.plan.md docs/plans/qa-hardening-followups.plan.md docs/plans/redaction-audit.plan.md docs/archive/plans/`
2. Add one line to `CLAUDE.md` § "Plans live in the repo": superseded plans move to
   `docs/archive/plans/` (and `docs/archive/specs/` if specs ever exist); `docs/plans/` holds only
   live plans — explicitly SUPERSEDING the global framework's delete-at-Phase-8 lifecycle for this
   repo, so the section carries exactly one lifecycle rule.
3. Commit `docs: archive superseded plans; master.plan.md is the sole live plan` + push.
   (Docs-only; verified: nothing outside `docs/plans/` references the four basenames, so no link
   dangles.)

## WS0 — Doc-drift reconciliation (no behavior change; one commit)

Nine verified drifts. Fix each exactly as stated; then sweep for residue.

1. `src/ui/binders/toolBinder.ts:60` — comment names `marginsToContentCrop`, which does not exist.
   The real function is `marginsToRect` (`src/utils/geometry.ts:210`).
2. `tests/blockers/layout-flatten.blockers.test.ts:7` — header comment says
   "Covers C10 … and C21. C12 and C19 need a real PDF". Reality: THIS file covers **C12** (:22)
   and **C10** (:67); `tests/browser/ceilings.browser.test.ts` covers **C21** (:21) and **C19**
   (:60). C21 and C12 are swapped — fix the comment to match the files.
3. `tests/blockers/README.md:21` and `:76` — both say "C1–C21"; the register and this README's own
   table (row at :59) go to **C22**.
4. `tests/utils/signRectPageSpace.test.ts:7` — claims "the signer validates against pdf-lib's
   `getSize()`, i.e. the MEDIA box". False: `pdfSigner.ts:151` validates against `getMediaBox()`,
   and `pdfSigner.ts:149` + `incrementalSigner.ts:219` carry comments explicitly REJECTING
   `getSize()`. Reword to the truth.
5. `src/utils/geometry.ts:150-159` (`displayRectToUserSpaceRect` docstring) — "the same content
   space the e-signer validates against" is stale for the same reason (the signer validates
   absolute MediaBox space). Reword; keep the correct "origin is implicitly (0,0) — CROP-relative,
   use `displayRectToPageUserSpaceRect` for absolute" guidance that is already there.
6. `SECURITY.md:80-83` — "'Export page as image' is not driven directly" is imprecise:
   `tests/export/imageExportOptions.test.ts` DOES drive `downloadPageAsImage` six times with
   pdf.js stubbed at the module seam (option→viewport/toBlob/save-name wiring only). What is
   uncertified is the ANNOTATION-STRIP dimension. Reword precisely. (WS1-1a then closes the gap
   itself — coordinate the two edits: WS0 states the truth today, WS1 updates it again.)
7. `CHANGELOG.md` — frozen at `[1.0.0] — 2026-06-26`. Add ONE consolidated entry summarizing the
   shipped work since (crop + margins + handles, XLSX export, EH-E/C13, Bates, sanitizer, signing
   hardening, the redaction leak fixes, a11y rounds). Keep it honest and dated; no per-commit
   archaeology required.
8. `VISION.md` — "_Last updated: 2026-06-26._" Refresh the date and prune anything already shipped.
9. Residue sweep — `git grep -n "marginsToContentCrop"`, `git grep -n "getSize()" tests/ src/`
   (validate each remaining hit is true), `git grep -n "C1–C21\|C1-C21"`. All must come back clean
   or verified-true.

Acceptance: greps clean; jsdom suite green; zero behavior change (`git diff` touches only comments,
docs, and test prose).

## WS1 — Close the uncertified-by-execution dimensions + the flaky test

These are the dimensions the pushed milestone NAMES as uncertified. Each gets a real test proven
non-vacuous by sabotage.

- **1a `downloadPageAsImage` annotation-strip, end-to-end.** New browser test mirroring
  `tests/browser/redaction-annotation-frames.browser.test.ts` (which drives the thumbnail sibling):
  real pdf.js pixels, a source annotation under a redaction, all four rotations + a crop case, an
  over-reach CONTROL (an annotation clear of every redaction must survive). To capture the output:
  `delete window.showSaveFilePicker` so the anchor-download fallback runs (the recorded automation
  workaround), or intercept at `_saveOrDownload`. Assert NO leaked pixel anywhere in the produced
  image, not a sampled point.
- **1b `onSignRectPicked` wiring.** `src/core/pdfTurboApp.ts:809` is production-uncovered — the
  only existing test (`tests/handlers/drawingHandlerSignRect.test.ts`) stubs it with `vi.fn()`.
  Build the minimal harness that instantiates enough of `PDFTurboApp` (or extracts the method's
  body behind a testable seam — prefer the seam if the app boot is heavy) to drive: drawn display
  rect on a page with an INSET CropBox → assert the sign-modal prefill fields carry ABSOLUTE
  user-space values (offset by the origin). Callers: `drawingHandler.ts:273`,
  `keyboardBinder.ts:34`.
- **1c `_pageGeomForSign` `rotation: 0` pin.** `pdfTurboApp.ts:853-862` — the deliberate
  `getViewport({ scale: 1, rotation: 0 })` has zero test references. Pin it (assert the viewport
  call arguments, or drive at a rotation where the wrong call changes the result).
- **1d Flaky `redaction-orphan-leak.browser.test.ts` — root-cause, no retries.** It NEVER
  reproduces isolated (3/3 green 2026-08-31 and green in that day's full run; the one observed
  failure was inside a full-suite run on 2026-08-29). Reproduce under load: loop the FULL browser
  suite, or run the file in a loop under CPU stress. Known hazards already mitigated in the file
  (read its header): buffer detach (`.slice(0)` + `byteLength===0` throw), zlib EOL trim. Capture
  the actual failure output before hypothesizing. A retry loop or timeout bump without evidence is
  a banned bandaid.

Acceptance per item: new guard red on the reverted/sabotaged fix, green on current code, mutation
verified landed, restore `cmp`-verified. Then update `SECURITY.md`'s driven-vs-shared wording (see
WS0-6) to the new truth.

## WS2 — C22: flow LAYOUT on non-zero CropBox-origin pages

> **DONE 2026-09-02 — the prose below is the plan as written, i.e. history, not an instruction.**
> C22 is CLOSED in `KNOWN_ISSUES.md`, and the pin named below was replaced by
> `tests/browser/cropbox-origin-layout.browser.test.ts` (see the Decisions Log for the rename).

Registered as C22 in `KNOWN_ISSUES.md:61`; pinned by
`tests/browser/blockers-cropbox-layout.browser.test.ts` (the `it.fails` at :70 is the pin).
The redaction FILTER is already origin-correct; the LAYOUT is not — words, images and margins are
mixed absolute/crop-relative (probe: a word at y=300 on a 300-high crop).

- Normalize in `ExportService._extractFlowDoc` (`src/export/exportService.ts`) so every consumer
  sees ONE frame: words, `rules`, `vRules`, links, images, margins **and the position-derived
  `colorMap` keys** move in lockstep. A partial normalization silently breaks colour/underline/link
  matching — that is the recorded reason this was deferred, and it is the acceptance bar.
- Flip the C22 `it.fails` pin to a plain `it` in the same change; extend it to cover the
  image-anchor and margin cases the blockers README (:59) records as NOT asserted.
- Byte-identical output for zero-origin pages (the entire existing flow/DOCX suite is the guard).
- Update `KNOWN_ISSUES.md` (close or narrow C22) + `tests/blockers/README.md` row.

## WS3 — Arabic ×15 native review — CLOSED 2026-09-13 by developer ruling (see the Decisions Log)

1. Extract a review table from `locales/*.json` for the 12 keys pending at extraction time (14 after #54b, 15 after WS7 round 9 added `toolbar.sanitizeTitle`) (the enumeration of record
   is `KNOWN_ISSUES.md § "Arabic locale strings"`): `toolbar.exportXlsxTitle`, `badge.signRect`, the six
   `toolbar.cropMargin*` keys, `toast.cropMarginsTooLarge`, and the three re-worded values
   (`toolbar.cropTitle`, `toast.modeHint.crop`, `toast.redactionPlaced`). Columns:
   key | en | fr | current ar | (blank) proposed ar.
2. OPTIONALLY append the two UNRECONCILED marker sets (`formatting.*` Slice-2 keys,
   `modal.signers.*`) so the developer can finally confirm or correct them in the same pass.
3. Present via `AskUserQuestion` / a review file; apply the answers; new values drop their
   `[Unverified]` status dated with the review.
4. Update ALL count surfaces in ONE commit (the three-places-drift trap is a recorded repo lesson):
   `KNOWN_ISSUES.md § "Arabic locale strings"`; `CLAUDE.md` § i18n (the AMENDED 2026-08-05 paragraph), § "The
   hide-vs-remove audit" (the pending-count sentences), § "XLSX table export" (the "12 values
   pending as of 2026-08-05" sentence); then the discriminating sweep:
   `grep -n "pending\|Unverified\|UNRECONCILED" CLAUDE.md KNOWN_ISSUES.md` — every remaining hit
   verified true.

## WS4 — Disclosed-bounds PoCs ("try to overcome the odds")

Six bounds were scheduled here as "currently DISCLOSED in `SECURITY.md` with recorded reasons".
That premise is only PARTLY true and was corrected by measurement: C **is** disclosed there
("Dropping is blunt by design"), F was **not** disclosed anywhere — it deletes prose in the flow
exports rather than leaking content, so it is an export-fidelity bound whose home is `CLAUDE.md`
§ Gotchas. **D and E must each have their disclosure location checked, not assumed** (`git grep`
the bound in `SECURITY.md` before writing that it was updated). Developer ruling
(2026-08-31): keep all disclosed **but attempt a PoC for each**. Rules of engagement: one isolated
git worktree per PoC (`Agent` tool `isolation: "worktree"` or manual `git worktree add`); a PoC is
PROMOTED to a real fix only if it meets its success criteria with sabotage-verified guards;
otherwise record the refutation evidence in this file's Decisions Log and keep the disclosure.
`SECURITY.md` is updated either way. Success criteria per PoC:

- **A — Ink above the burn.** Handwriting under a redaction stays visible on every path (ink is
  composited above the burn). PoC: drop (or clip) ink strokes whose bbox intersects a redaction,
  on all export paths, with a control (ink clear of redactions survives untouched, stroke-exact).
  Success: leak case red-before/green-after at all 4 rotations + crop; control green; no change to
  ink rendering elsewhere.
- **B — Rotated-element true footprint.** The element∩redaction test uses the stored AABB. PoC:
  4-corner transform of the rotated element's rect (the `imagePlacementRedacted` pattern,
  `exportService.ts:146`). Direction guard: for a LEAK filter the footprint may only GROW or stay
  equal vs the AABB where rotation ≠ 0 — never shrink (under-dropping is the unsafe direction).
- **C — Blank-page blunt whole-drop.** A partially-covered element is dropped whole (including one
  deliberately stacked ABOVE a redaction). PoC: clip the element's rendering to the un-redacted
  region instead. Success bar is HIGH: any partial-render approach must provably never emit covered
  content in any channel (text is not clippable in the vector path — likely refuted; record why).
- **D — DOCX part GC.** Deleting an image leaves `word/media/imageN.*` as an unreferenced part.
  PoC: full cross-part reference scan (document.xml, headers, footers, ALL `.rels`, unmodelled
  parts) → delete only at refcount 0 → round-trip guard (save→reopen byte-compare of every
  surviving part; Word-openable). The recorded risk is destroying referenced images — the scan's
  completeness IS the deliverable.
- **E — Signer vs assembled crop-origin.** On a redaction-bearing page the assembly substitutes a
  fresh raster page at origin (0,0), so the absolute sign prefill is off by the crop origin for
  that page. PoC: make the prefill (or the signer) branch-aware WITHOUT coupling UI to export
  internals — e.g. resolve the effective origin at sign time from the same predicate the assembly
  uses (`hasRedaction`), behind one named shared function. If the coupling cannot be kept to one
  seam, refute and keep disclosed.
- **F — Form `/BBox` clip in `walkPageOps`** (`src/export/opStreamWalker.ts` — currently zero
  `BBox` reads). Guardrail (the channel asymmetry above): model the clip for the
  rules/vRules/colorMap channels ONLY (where over-approximation deletes prose); leave the
  image-leak footprint UNCLIPPED (over-approximation is its safe direction). If no real-file case
  demonstrates harm, pinning the over-approximation with a test + reason is an acceptable outcome.

## WS5 — Adversarial audit of the existing code (user-added stream)

Scope is "what already exists", UNQUALIFIED — not only where bugs were found before.

1. Load `/pdf-lenses` FIRST (mandatory before any review skill in this repo).
2. Run the three reviewer agents from `.claude/agents/` — `export-fidelity-reviewer`,
   `safety-promises-reviewer`, `completeness-reviewer` — **spawned UNNAMED** (a named agent's
   report vanishes; recorded trap), fresh context, over the high-risk cluster: `src/export/**`,
   `src/utils/contentStreamEditor.ts`, `src/docx/**` (the in-place save), `src/infra/storage.ts` +
   session persistence, `src/handlers/**`.
3. A second sampling pass OUTSIDE that cluster: `src/ui/binders/**`, i18n plumbing, PWA/SW +
   caching config, OCR pipeline, signing UI. Plus one fresh `qa:sweep` run and a skim of its
   unreached-controls list.
4. Any reviewer performing mutation testing gets its OWN worktree (recorded: parallel sabotage on
   one checkout makes every number unattributable). ≤5 concurrent agents.
5. Triage findings P0–P3. Fix P0/P1 with TDD in this stream; P2/P3 land here only if trivial,
   otherwise they get a row in `KNOWN_ISSUES.md` § Deferred with a reason.

## WS6 — Feature backlog

- **C9 — borderless tables → DOCX wiring.** Gated on real-file evidence (the synthetic corpus is
  not enough; harm asymmetry: a false positive silently mangles prose, because `reconstructPage`
  REMOVES in-region words). Executor collects **~10–15 real-world public PDFs** (invoices, bank
  statements, articles, forms, reports) into `var/corpus/` (gitignored); run
  `inferBorderlessGrid`'s gate against every page; wire C9 (in `_extractFlowDoc`, behind a
  STRICTER threshold than the CSV path) **only at zero false positives**; otherwise record the
  measured failure shapes in `KNOWN_ISSUES.md` C9 and stop. Engine is shared
  (`src/utils/borderlessTable.ts`, `_resolveTableGrid` at `exportService.ts:531`) — this is a
  wiring + threshold change, not new detection work.
- **Aspect-ratio-aware crop apply-to-all** (`KNOWN_ISSUES.md` § Deferred). Extend
  `PageService._commitCrops`/apply-to-all so a drawn crop maps to other page sizes preserving the
  RATIO and relative position instead of clamping one absolute rect. Undo stays one `MacroCmd`.
- **#54b — open-via-picker + recent files** (`src/utils/fileSystemAccess.ts`).
  `showOpenFilePicker` where available (progressive enhancement, mirroring the save side — its `canUseFsSave` probe was deleted by limits row 11), recent
  handles in IndexedDB with permission re-request on use; plain `<input type=file>` fallback
  untouched. No new deps.

## WS7 — Certification (strictly LAST)

1. Land everything above; freeze (commit, push); no edits from panel spawn to report read —
   **freeze means freeze**.
2. Run the 3-lens panel ONCE over **`dfe34ae..<frozen HEAD>`** — this range deliberately covers
   BOTH the already-pushed 0/2-uncertified milestone (`08a9af2`) and all new WS work, so one
   certification retires the recorded 0/2 debt (one panel per milestone is the repo's economize
   rule; do NOT run a separate panel over the old milestone first). If `dfe34ae` ever dangles after
   a re-sign, re-derive it: `git log --format=%H -1 --grep='hide-vs-remove pins'`.
3. Lenses: the three `.claude/agents/` reviewers, spawned UNNAMED, each reading diff/code/tests
   itself; sabotage-performing lenses in isolated worktrees.
4. MAXIMAL tier: **two consecutive fully-clean rounds**; any finding resets the counter; cap 5
   rounds → ask the developer via `AskUserQuestion` (never silently proceed). Cap 5 was passed; the
   `[2026-09-13 14:00]` ruling authorises rounds 10–14 and holds every push until 2/2 clean.
5. The completion report states per dimension what was certified BY EXECUTION and what was not,
   naming each uncertified dimension — `UNCERTIFIED-BY-EXECUTION` in those words where it applies.

## Inputs needed from the developer (the only ones)

1. ~~**WS3**: the Arabic review answers for the 12 (+ optional 2 UNRECONCILED sets) values.~~ Closed by ruling 2026-09-13.
2. **WS4**: promote/refute rulings on any PoC whose evidence is ambiguous.
3. **WS7**: the cap-5 escalation decision, if reached.

Everything else is executor-autonomous under this repo's git-autonomy and no-interrupts rules.

## Decisions Log
- [2026-09-04 20:31] AGREED: the crop kill switch's EDITOR half is gated too — `_renderCropFrame` now
  takes `isEnabled('crop')`, matching both export paths. Round 5 recorded this as deferred pending a
  product call; that was wrong. `main.ts` already removes the crop button and `#cropControls` when the
  flag is off, and `exportPipeline.ts:299-303` says in as many words that a switch killing the button
  rather than the feature is the opposite of what a kill switch is for — the seam had already decided,
  and the frame was simply the one surface that had missed the gate. Recorded because HEAD overturned a
  logged deferral with no entry, which is this plan's own rule 6.
- [2026-09-04 20:31] RECORDED: round 6 = 18 findings across the three lenses. The P1 is a real safety
  defect — `pdfSanitizer` resolved `/A` through `ctx.lookup` but compared `/S` raw, so a JavaScript
  action written as `/S 12 0 R` survived a sanitize that reported itself CLEAN. Two more were mine
  from this session: npm cache artifacts swept into `f85d37e` by `git add -A`, and an `xfdfMapping`
  docstring claiming the rotated-page ceiling was closed when no un-rotation exists anywhere in that
  module. Both are now fixed; the rotation ceiling stays open and C20/#57b were right all along.
- [2026-09-04 20:31] RECORDED: a reviewer's measured number is not a measurement. It reported the
  `word/media`-only sabotage as 21 of 25; running it here gave 22. Two shapes of the same mutation
  need not fail the same count — cite the one you ran.

- [2026-08-31 18:10] AGREED: all four work streams in scope PLUS a whole-codebase audit stream
  (WS5); doc-drift fixes and consolidation unconditional.
- [2026-08-31 18:10] AGREED: superseded plans are ARCHIVED under `docs/archive/plans/`, not
  deleted; `docs/plans/` holds only live plans.
- [2026-08-31 18:10] AGREED: Arabic ×12 handled as prep-table → developer review → apply.
- [2026-08-31 18:20] AGREED: all six disclosed bounds stay disclosed by default, but each gets a
  PoC attempt ("try to overcome the odds") — promote only on sabotage-verified success.
- [2026-08-31 18:20] AGREED: C9 corpus is collected by the executor (real-world public PDFs);
  wire only at zero false positives.
- [2026-09-01 00:05] AGREED: this session writes ONLY this file; Step 0 (archive move, CLAUDE.md
  line, commit) and everything after is executed by the follow-up session.
- [2026-09-02 00:08] AGREED: Step 0 and WS0 are both docs-only, so they land as two commits but
  share ONE deploy-gate run and ONE push — deviating from Step 0's "commit + push" wording, which
  would have bought a second full real-Chrome suite for zero code change.
- [2026-09-02 00:08] RECORDED: WS0 is **ten** drifts, not nine. The tenth was found by running the
  item-9 residue sweep before the edits rather than after: `CLAUDE.md` names `marginsToContentCrop`
  as the function AND cites a guard file `tests/utils/marginsToContentCrop.test.ts` that does not
  exist (it is `marginsToRect.test.ts`, and it has 8 cases, not the 7 claimed). The plan expected
  those hits to be "verified-true"; both were false.
- [2026-09-02 00:08] RECORDED: two corrections to this plan's own recipe. Step 0 must
  `git add docs/plans/master.plan.md` — it is untracked, and the recipe moves the four old plans
  without adding the new one, so "the sole live plan" would land with no plan in the repo. And
  item 9's `git grep "C1–C21"` pattern is vacuous for `tests/blockers/README.md:76`, where the
  range is backticked as `` `C1`–`C21` ``; sweep `git grep -n C21` and validate each hit instead.
- [2026-09-02 00:30] RECORDED: `git push` here exceeds a 3-minute Bash timeout because
  `.githooks/pre-push` re-runs type-check + lint + the 170s jsdom suite. Two pushes were killed
  mid-hook with nothing transferred (an exit code is NOT evidence — require the `To github.com:…`
  line plus `git rev-list --count origin/master..master` → 0). The WS0 push therefore used the
  hook's documented `--no-verify` bypass, justified by the full deploy gate having been run to
  green on that exact commit with a clean tree minutes earlier — a strict superset of what the
  hook runs. Future streams: run the push detached and leave the session idle until it reports.
- [2026-09-02 08:04] AGREED: drive `onSignRectPicked` via `Object.create(PDFTurboApp.prototype)`
  rather than extracting the seam this plan offered as the fallback. A two-line probe showed
  `src/core/pdfTurboApp.ts` imports cleanly under jsdom, so the untouched production code can be
  driven as-is with own-property stubs shadowing `setMode`/`_reopenSignModal` — reshaping shipping
  code for testability is the worse trade when that is true. (`ui` is a prototype getter, so it
  needs `Object.defineProperty`, not assignment.)
- [2026-09-02 08:04] AGREED: pin WS1-1c as a CONTRACT, not as a call. `_pageGeomForSign` reads only
  `vp.viewBox`, which pdf.js stores verbatim regardless of rotation, so the plan's offered
  "assert the viewport call arguments" would be a guard that fails on a harmless edit and passes on
  a harmful one. The assertion is instead that the returned box is the UNROTATED content box
  carrying its origin, at `/Rotate 90` where both wrong answers are distinguishable; the
  call-argument assertion is kept beside it and labelled in the test as intent documentation.
- [2026-09-02 08:20] RECORDED: WS1-1d found NO reproduction in 9 runs of the FILE (6 isolated at
  load ~16, 3 in-suite at load 16.7–19.6; 27 `it`-block executions, which is NOT the comparable
  unit — the original observation was one file run). Three in-suite samples are thin: 3 clean runs
  are the expected outcome 73% of the time even at a 1-in-10 rate, so the finding is "not
  reproduced", never "fixed". It REFUTED the timeout hypothesis
  by measurement — the test is faster in-suite (2.7–3.7s) than isolated (4.1–13.2s) because pdf.js's
  worker is warm by then, against a 30s budget whose suite-wide maximum is 10.1s. No retry and no
  timeout bump were added. The only change is diagnosability, and it is disclosed as
  UNCERTIFIED-BY-EXECUTION: no current fixture in that file can reach either error hook.
- [2026-09-02 08:20] AGREED: fix the dropped-cause error hooks at ALL THREE sites across both files
  that use the pattern, not only in the flaky one — and note that `IErrorReporter`'s second argument
  means params for `warn` and a cause for `error`, which the first version of the fix got wrong.
- [2026-09-02 10:30] AGREED: normalise C22 at the `_extractFlowDoc` BOUNDARY (one translation by the
  CropBox origin, everything downstream on a single origin-(0,0) frame) rather than teaching each
  consumer about the origin. Measured first: on `/CropBox [50 50 350 350]` pdf.js reports item
  (100,300), rule (100,296), colour key "100,300" and image ctm e/f (120,200) — every channel
  absolute AND mutually consistent, which is exactly why colour/underline/link work today and why a
  partial normalisation would silently break them.
- [2026-09-02 10:30] AGREED: buy the lockstep STRUCTURALLY — `walkPageOps` takes an optional origin
  seeding its BASE transform, so `rules`, `vRules`, image CTMs and the `colorMap` keys move together
  by construction and a partial normalisation of those four is unexpressible. `composeCtm(m, …)`
  applies `m` last (read, not assumed), so the translation stays outermost.
- [2026-09-02 10:30] RECORDED: the origin must be used at BOTH sites that establish the walker's
  frame — `beginAnnotation` RESETS the ctm rather than composing, so seeding only the initial value
  would leave annotation-borne images in absolute space (a mixed frame, in the leak direction).
  Found by reading the code during 3C, not by a red test; pinned in the walker's jsdom suite.
- [2026-09-02 10:30] RECORDED: sabotage S5 (mapping the redactions into `vp.viewBox` while the items
  are crop-relative) left `redaction-crop-origin.browser.test.ts` GREEN at 27/27. Its image row's
  target is wider than the origin error, so it pins that the filter exists, not the frame it runs
  in. A discriminating leak case (a 20pt image against a 50pt origin) was added to the new guard
  before proceeding — a leak guard whose target is bigger than the error cannot see the error.
- [2026-09-02 10:30] AGREED: the fixed pin loses the `blockers-` prefix
  (`blockers-cropbox-layout` → `cropbox-origin-layout`). That prefix means "an `it.fails` stating
  behaviour we do NOT have"; a green plain-`it` file under it would be a doc-vs-reality drift of
  exactly the kind WS0 spent a stream correcting. `tests/blockers/README.md` row updated to match.
- [2026-09-02 13:20] AGREED: WS4 runs one **detached** `git worktree` per PoC with `node_modules`
  symlinked entry-by-entry and its OWN `node_modules/.vite`. Probed before committing to it (a
  browser file green in the worktree): a shared `.vite` re-optimizes on every switch between trees,
  which is the documented mid-suite reload trap. Detached because `master` is the only branch.
- [2026-09-02 13:40] AGREED: PoC **A (ink above the burn) is PROMOTED**. The clip lives in
  `renderInkForExport` on the ink CANVAS (`destination-out`), not at the call site dropping whole
  strokes: ink is rasterised before it is stamped, so clipping there is stroke-exact and the plan's
  "drop (or clip)" floor is beaten. The new `redactions` parameter is optional → a page with no
  redaction bakes a byte-identical PNG, pinned as a string compare.
- [2026-09-02 13:40] RECORDED: sabotage S4 (clip rects bypassing the shared `toCanvas`) left the
  helper cases GREEN on the first fixture — a 200×200 page with the redaction CENTRED on it, where
  the right and wrong AABBs are the same rect. Only the asymmetric end-to-end cases went red. The
  fixture is now non-square and off-centre and S4 fails 6. **A centred fixture cannot detect a
  rotation** — the rotational form of this repo's "a square fixture cannot detect a dimension swap".
- [2026-09-02 13:40] RECORDED: sabotage S1 (reverting only the CALL SITE) fails exactly the 4
  end-to-end cases and nothing else, so the wiring is pinned and not merely the pure helper — the
  gap that left the sign-rect prefill uncertified until 2026-09-02.
- [2026-09-02 14:24] AGREED: PoC **B (rotated footprint) is PROMOTED**, and it is a LIVE LEAK rather
  than the bluntness bound the plan described. A redaction element can itself be rotated; the burn
  and the editor honour that, every filter did not, so content under the protruding parts was
  painted over and left fully extractable in the flow and table exports. Measured on shipping code.
- [2026-09-02 14:24] AGREED: the footprint is the UNION of the stored box and the rotated AABB, never
  the rotated AABB alone — at 90° a 120x20 box becomes 20x120, i.e. NARROWER, and a leak filter's
  tested footprint may only grow. Union also makes the change additive: every existing drop survives.
- [2026-09-02 14:24] RECORDED: normalising inside `redactionRectToContent` (which all five conversion
  sites reach) did NOT fix the table path — four sites rebuilt a stripped `{x,y,width,height}` literal
  and dropped `rotation` before the call. **A one-seam normalisation is only structural if callers
  pass the object through**; those sites now pass `el`.
- [2026-09-02 14:24] RECORDED: the WS4-A ink clip shipped the same defect 40 minutes earlier — it
  mapped the STORED rect, so a rotated redaction under-clipped the ink. Fixed in the same change and
  pinned. When a fix introduces a new consumer of a shape, that consumer joins the class the next fix
  must sweep.
- [2026-09-02 14:24] RECORDED: **UNCERTIFIED-BY-EXECUTION** — the OCR burn (`ocrHandler.ts`) takes the
  footprint but no test drives it; sabotage re-stripping `rotation` there leaves the suite green.
  Pinning it needs the OCR engine. The rasterizer/annotation-strip site was in the same position and
  IS now pinned.
- [2026-09-02 14:24] RECORDED: bound B was listed in this plan as "currently DISCLOSED in
  SECURITY.md" and was NOT in SECURITY.md at all — only in CLAUDE.md's hide-vs-remove bounds
  paragraph. Disclosed there now, as closed.
- [2026-09-02 14:54] RECORDED: the struct-tree (tagged-PDF) path is NOT a second leak —
  `reconstructPage` hands `structTreeToFlow` the already-mapped `contentRedactions`, so tagged files
  inherit the WS4-B and C22 fixes without a second call site to keep in step. Checked because that is
  exactly where a sibling path would hide.
- [2026-09-02 14:54] AGREED: A's plan criterion said "all 4 rotations + crop" and the first round ran
  only the rotations. The crop case was added and passes — as reasoned, but now measured; "reasoning
  says it passes" is the sentence this repo's Gotchas exist to distrust.
- [2026-09-02 14:54] AGREED: `SECURITY.md` said the rotated-redaction over-approximation removes
  "slightly more". For a 20x260 bar at 90 degrees the tested box is 260x260 — thirteen times the
  burn's area. A security document must not understate its own imprecision; reworded.
- [2026-09-03 10:53] AGREED: WS3 (Arabic x12) stays IN SCOPE as work but sits OUTSIDE the goal's done-when. It is
  the only step no executor can close — it waits on the developer's review answers — so a stop
  condition containing it would block on the developer rather than on the work. Recorded via
  /goal-brief so the brief's done-when is reachable autonomously.
- [2026-09-03 10:53] AGREED: "done" means WS7 returns TWO CONSECUTIVE FULLY-CLEAN rounds over dfe34ae..HEAD. It
  does NOT additionally require flipping every status-block row from `done` to `certified` with a
  `test:<date>` record — that is collector bookkeeping the plan never asked for, and the panel is
  the certification of record under MAXIMAL.
- [2026-09-03 10:53] AGREED: the goal stops at PUSHED TO master WITH THE FULL DEPLOY GATE GREEN, not at a verified
  live deploy. GitHub Pages deploys from that push automatically; a red CI afterwards is a finding to
  fix, not a separate goal step.

- [2026-09-04 10:34] AGREED: WS4-F is PROMOTED, not refuted. `walkPageOps` now models the Form
  XObject `/BBox` clip for the rules/vRules/colorMap channels and leaves the image channel
  UNCLIPPED (over-approximation is the safe direction for a leak filter, the mirror of WS4-B's
  "may only grow"). Harm was demonstrated end-to-end before the fix: a rule drawn 300pt outside a
  100x60 `/BBox` gave `vRules` 3 entries and reduced the reconstructed paragraph flow to the EMPTY
  STRING — the prose deleted, not merely displaced. The fixture is SYNTHETIC; no real-world file
  exhibiting it was found, so the field frequency is unmeasured and the plan's "real-file case"
  wording is not satisfied. Recorded as a promoted fix on a demonstrated mechanism.
- [2026-09-04 10:34] AGREED: the WS4-F bound was NOT disclosed in `SECURITY.md`, contrary to this
  plan's "six bounds currently DISCLOSED in SECURITY.md" — `git grep BBox SECURITY.md` returns
  nothing. It does not belong there: it deletes PROSE in the DOCX/MD/TXT exports rather than
  leaking content, so it is an export-fidelity bound and `CLAUDE.md` § Gotchas is its home. Same
  plan-vs-reality drift WS4-B recorded for its own bound; the remaining PoCs (C, E, D) must have
  their disclosure location checked rather than assumed.
- [2026-09-04 11:24] AGREED: WS4-C is REFUTED and the disclosure stays. Clipping a partly-covered
  element instead of dropping it whole was measured: a PDF clip suppresses the glyphs on screen
  (darkness 47.7 -> under 10) and leaves the string fully extractable, because a clip is a rendering
  instruction and not a deletion. WS4-A's ink clip works only because ink is rasterised to a canvas.
  The model-level alternative (omit covered glyphs) is refused because it requires a second
  implementation of `renderText`'s layout — three drawing paths, four alignments, list markers,
  Tc/Tz widths — and a leak filter that depends on two implementations agreeing under-drops.
  `SECURITY.md` records the outcome; the refutation is pinned as a test, not just prose.
- [2026-09-04 11:24] AGREED: bound C IS disclosed in `SECURITY.md` ("Dropping is blunt by design"),
  unlike bound F. The per-PoC disclosure check is therefore worth keeping for D and E rather than
  generalising either way from F.
- [2026-09-04 11:38] AGREED: WS4-E is REFUTED and the bound stays — but the DISCLOSURE was wrong
  and is corrected. Measured from the real assembly: a redaction-bearing page becomes a fresh raster
  page at origin (0,0) sized to the crop box, 300x240 at /Rotate 0 and 240x300 at /Rotate 90 (the
  rotation is baked into the pixels). So the recorded "off by the crop origin" holds only at
  rotation 0; at 90/270 the mappings differ in shape and no translation reconciles them.
- [2026-09-04 11:38] AGREED: the coupling cannot be kept to one seam. The correct frame is trivial
  for redacted-and-uncropped, but for a cropped page the assembled dimensions come from the
  rasteriser's own `convertToViewportPoint` + `Math.round` at SCALE 2, so the sign path would have
  to replicate its pixel rounding. A fix that skipped that would be right for one combination and
  wrong for the other — worse than one uniform bound. Pinned as a frame measurement, not a fix.
- [2026-09-04 11:38] AGREED: bound E is NOT in `SECURITY.md` and does not belong there — it
  misplaces a signature visibly, it does not leak or fail to remove content. Its home is
  `CLAUDE.md` § "The drag-placed signature rect was crop-relative", amended in place. Two of the
  four bounds checked so far (F, E) were not where the plan's preamble said they were.
- [2026-09-04 12:07] AGREED: WS4-D is PROMOTED. `src/docx/opcGc.ts` collects `word/media/*` parts
  that no live relationship reaches, and drops the dead relationships with them. The scan walks
  EVERY `_rels/*.rels` in the package (headers, footers, footnotes, comments and unmodelled parts —
  the ones the editor passes through verbatim), treats a relationship as live if its Id appears
  anywhere in the owning part's text, keeps everything it cannot read with confidence, and is
  restricted to `word/media/**`. `SECURITY.md` now records the bound as closed.
- [2026-09-04 12:07] AGREED: the GC also collects a picture orphaned by ANOTHER program before the
  file was opened — the same rule applied evenly, so a save can shrink a file the user did not
  knowingly change. Disclosed in `SECURITY.md` rather than special-cased, because suppressing it
  would mean tracking which orphans "we" created, which the package does not record.
- [2026-09-04 12:46] AGREED: #54b (WS6) is DONE. Open goes through `showOpenFilePicker` where it
  exists, handles are remembered in a new IndexedDB `recent` store, and the File menu lists them
  with permission re-requested at click time. `'cancelled'` and `'unavailable'` stay distinct so a
  dismissed picker never opens the fallback input. Two new i18n keys carry `ar [Unverified]`,
  taking the pending Arabic count to 14 — a count that read 11 in one place and 12 in two others
  and is now reconciled.
- [2026-09-04 12:52] AGREED: aspect-ratio-aware crop apply-to-all (WS6) is DONE. A drawn crop maps
  onto each page as a proportion of that page's own box: SHAPE preserved by a uniform scale (per-axis
  scaling would stretch it across differing aspect ratios), POSITION by the crop's centre rather than
  its corner. Exactly the identity when the boxes match, short-circuited because the float round-trip
  is not. Undo stays one `MacroCmd`; the margins path was already per-page and is untouched.
- [2026-09-04 13:40] AGREED: the C9 corpus is 15 public PDFs (360 pages) fetched from canonical
  government/arXiv URLs into gitignored `var/corpus/`, rebuildable with `scripts/c9-corpus-fetch.sh`.
  Shapes covered: forms, articles (1- and 2-column), reports. **NOT covered: real invoices and bank
  statements** — genuine ones are private documents and no public sample was obtained, so that half
  of the plan's named shapes is a disclosed gap rather than a satisfied requirement.
- [2026-09-04 13:40] AGREED: C9 STAYS UNWIRED. The gate fired on 15 of 360 pages; 5 are genuine data
  tables and 10 are multi-column LAYOUT (9 pages of Pub-17's alphabetical index, one paper's table of
  contents). That is not zero false positives, so per the plan the measured shapes are recorded in
  `KNOWN_ISSUES.md` C9 and the wiring is not attempted.
- [2026-09-04 13:40] AGREED: the failure is NOT a threshold-tuning gap and must not be answered with
  one. The index pages score median 3 words/cell — the identical value as the 1099-MISC and W-4
  grids that are true positives — so no threshold on that statistic separates them and tightening it
  would refuse the real forms. A future attempt needs a different discriminator. The 2-column
  articles fired zero times, so the existing rules do work on the shape they were built for.
- [2026-09-04 14:26] AGREED: WS5 ran the three `.claude/agents/` lenses UNNAMED over the high-risk
  cluster plus a sampling pass and a fresh `qa:sweep`. 30 findings: 1 P0, 2 P1, 9 P2, 18 P3. Reports
  kept at `var/claude/ws5/` (gitignored). The P0, both P1s and every trivial P2/P3 are FIXED under
  TDD here; the 10 remaining are in `KNOWN_ISSUES.md` § Deferred, each with the reason it was not
  landed rather than a bare todo.
- [2026-09-04 14:26] AGREED: the P0 is a real redaction leak. `isItemRedacted` extended a run +x by
  |width| from transform[4], but pdf.js reports `width` as the advance ALONG THE TEXT DIRECTION and
  carries the direction in `transform` (pdf.worker.mjs:35814-35819 — for horizontal text height is 0,
  for vertical width is 0). Any run drawn with a rotated Tm was tested in a box DISJOINT from its
  glyphs and never dropped, through DOCX/MD/TXT/CSV/XLSX, at every page rotation including 0. Now
  built from the transform's four corners; byte-identical for ordinary horizontal text.
- [2026-09-04 14:26] AGREED: the P1 is that `sanitizePdf` deleted REFERENCES while pdf-lib has no
  reachability GC, so the detached XMP stream and JavaScript action were re-serialised — in
  plaintext, since the save is `useObjectStreams: false`. Three user-facing docs said they were
  "stripped". A reachability sweep from the trailer roots now discards unreachable objects; deleting
  the specific detached refs instead was rejected because a shared object would be destroyed.
- [2026-09-04 14:26] AGREED: two of the audit's findings were against work landed EARLIER THE SAME
  DAY — the `opcGc` unreadable-`.rels` path failed toward DELETING against its own stated invariant,
  and CLAUDE.md still carried "not fixed on purpose" for a leak WS4-D had just closed. Both fixed.
  A same-session audit catches what a same-session author cannot.
- [2026-09-04 14:50] RECORDED: WS7 round 1 = **18 findings** across the three lenses, so the
  two-clean counter stays at 0. The most serious was a REGRESSION introduced by WS5's own P0 fix:
  taking `max(|width|,|height|)` as a run's advance inflated every short horizontal run to a full em
  and silently deleted text clear of the burn. The cause was reading `pdf.worker.mjs:35814-35819`
  without the `if (!font.vertical)` above it — the branches are inverted from what the fix assumed,
  and `height` is the FONT SIZE for horizontal text, never 0. Measured, not argued.
- [2026-09-04 14:50] AGREED: the vertical-writing claim is WITHDRAWN, not restated. pdf.js swaps the
  roles for a vertical font and advances downward, and no vertical font exists in this repo to
  measure the sign with. The test that claimed to cover it used a rotated Tm with `width: 0` — not a
  vertical-writing item — and passed for an unrelated reason. Recorded as an
  UNCERTIFIED-BY-EXECUTION bound in `CLAUDE.md`.
- [2026-09-04 14:50] AGREED: round 1's other fixes — XFDF x now carries the CropBox origin (the y-only
  fix had left the `/Rect` in a MIXED frame), `opcGc` accepts single-quoted XML attribute values (a
  legal document could lose a live header image), and the sanitizer's GC roots include
  `trailerInfo.Encrypt` (latent: no caller encrypts today, but `PDFWriter` writes it to the trailer).
- [2026-09-04 15:21] RECORDED: WS7 round 2 = **17 findings** (2 + 4 + 11), counter still 0 of 2. Most were
  round-1 fixes applied to ONE member of a class: the `opcGc` single-quote fix reached the owner scan
  but not the `.rels` parser or the Content-Types scan (a legal single-quoted `.rels` DELETED a live
  image); the XFDF origin reached `rect` but not the arrow endpoints or ink points; and the
  sanitizer's reachability sweep was not carried to `compressLossless`, whose own docstring says it
  mirrors the sanitizer. Every one of those is the "sibling shares the promise but not the filter"
  shape this repo names as its most-repeated defect.
- [2026-09-04 15:21] AGREED: the sweep now lives in ONE place (`src/utils/pdfObjectGc.ts`) used by both the
  sanitizer and the compressor, rather than being copied. Copying is how the two diverged; a third
  repetition in one session was not acceptable.
- [2026-09-04 15:21] AGREED: the vertical-writing redaction bound is disclosed in `SECURITY.md` and
  `KNOWN_ISSUES.md`, not only in `CLAUDE.md`. The panel graded "recorded in CLAUDE.md but not in
  SECURITY.md" as the defect for bound B and was right to apply it here — it is a possible leak of
  redacted text, so it belongs where users read.
- [2026-09-04 15:21] RECORDED: round 2 also caught the round-1 fix commit re-introducing the future-stamp
  defect it had just fixed (stamps of 14:51 in a commit authored 14:50), a `58 = 1 + 56` arithmetic
  contradiction inside the paragraph warning against wrong counts, a malformed retraction that still
  asserted the bound it declared closed, and the `Encrypt` GC root shipped with NO test. All fixed;
  the root now has a direct guard in `tests/utils/pdfObjectGc.test.ts`.
- [2026-09-04 16:10] AGREED (developer): the DOCX orphan-media GC is REWRITTEN on the platform `DOMParser`
  this repo already uses for OPC (`opcEdit`/`opcParts`), not patched shape-by-shape and not reverted.
  Three consecutive certification rounds each found a NEW legal-XML shape that made it delete a live
  image — single-quoted attributes, the rewrite pass, percent-encoded targets, XML entities,
  namespace-prefixed elements — so a regex scan over arbitrary OPC cannot be made correct one round
  at a time. Parsing retires the whole class by construction; percent-decoding of `Target` still
  needs doing explicitly.
- [2026-09-04 16:10] AGREED (developer): continue to rounds 4 and 5 of the MAXIMAL panel rather than stopping
  or lowering the two-clean-round bar. If round 5 is still not clean, STOP and hand over the open
  findings rather than certifying.
- [2026-09-04 16:10] RECORDED: WS7 round 3 = **23 findings** (5 + 6 + 12), counter still 0 of 2, and the trend
  is the wrong way (18 → 17 → 23) because most new findings come from the fix commits themselves.
  The sharpest: round 2's compress fix was applied to `compress.ts::compressLossless`, which
  `git grep` shows has ONLY TEST CALLERS — the production Compress button routes to a private
  `_compressLossless` in `exportService.ts:433` that never calls the sweep. The fix and its three
  guards both exercised code the app does not run, while `pdfObjectGc.ts`'s own docstring claimed the
  divergence was eliminated. **Verify which function the product calls before believing a fix.**
- [2026-09-04 16:10] RECORDED: the redaction footprint spans baseline→baseline+size, so it misses the
  DESCENDER — a redaction covering only below the baseline leaves the run extractable, which makes
  `SECURITY.md`'s "horizontal text, including text set at an angle, IS covered" an overclaim by that
  much. To fix or to narrow, not to leave standing.
- [2026-09-04 16:28] RECORDED: the `opcGc` rewrite is done and the five shapes that defeated the regex scan
  are now guards — single-quoted removal, percent-encoded Target, XML entity, namespace-prefixed
  `<pr:Relationship>`, single-quoted `TargetMode`. Non-vacuity proven by running the NEW guards
  against the OLD implementation from `c604699`: 5 of 22 fail, exactly the five the panel found.
- [2026-09-04 16:28] AGREED: the compress sweep moved INTO `stripDocMetadata`, beside the strip, rather than
  into either caller. Both the public `compressLossless` and the private `_compressLossless` the
  Compress button actually calls already invoke it, so that placement is the only one that cannot be
  half-applied. The new guard drives `stripDocMetadata` directly for the same reason.
- [2026-09-04 16:28] RECORDED: one round-3 finding is REFUTED. The crop editor/export divergence is
  PRE-EXISTING, not introduced by this range — `isEnabled('crop')` entered `exportPipeline` in
  `d945127`, `_renderCropFrame` in `61ac44c`, and `pageRenderPipeline.ts` is untouched in
  `dfe34ae..HEAD`. Recorded as a deferred product call rather than fixed as a regression.
- [2026-09-04 18:05] RECORDED: WS7 round 4 = **19 findings** (4 + 12 + 3), counter still 0 of 2. The percent-
  decode from round 3 was itself a regression: it returned ONLY the decoded form, so on an
  OPC-conformant package whose ZIP entry is also percent-encoded the live image was DELETED where the
  regex version had kept it. Resolution and COMPARISON are now separate concerns — `resolveRelTarget`
  returns the path as written, and one `canonicalPart` key (percent-decoded + ASCII case-folded)
  matches both sides, which retires the encoding AND case classes together.
- [2026-09-04 18:05] AGREED: the owner-side liveness test is PARSED too. The rewrite retired entity references
  on the `.rels` side and left the half that actually decides liveness matching raw text, so
  `r:embed="rId&#55;"` made a live image look orphaned. Both lenses found it independently.
- [2026-09-04 18:05] RECORDED: my round-3 REFUTATION was wrong. I called the crop editor/export divergence
  pre-existing on the strength of `d945127` existing, without checking it was in range —
  `git merge-base --is-ancestor d945127 dfe34ae` says it is NOT an ancestor, so the divergence was
  introduced here. Withdrawn in `KNOWN_ISSUES.md`. **Checking that a commit exists is not checking
  that it is out of range.**
- [2026-09-04 18:05] RECORDED: the `opcGc` sabotage figures in `CLAUDE.md` had been measured against the regex
  implementation the rewrite deleted and were presented as current — unproven rather than false,
  which by this repo's own standard is worse than saying nothing. Re-measured against shipping code:
  owner test disabled → 12 of 25, media-only restriction dropped → 22 of 25.
- [2026-09-04 18:05] RECORDED: the FULL browser suite ran green for round 4 — 88 files / 326 tests, in
  foreground chunks, with one 30s timeout at load 26.5 re-run and passing. The export lens could not
  complete it (killed at 40 min under load) and said the counter should not advance without it.
- [2026-09-04 18:48] RECORDED: WS7 round 5 = **11 findings** (3 + 2 + 6). The panel did NOT converge:
  18 → 17 → 23 → 19 → 11 findings over five rounds, counter never above 0 of 2. Per the developer's
  ruling at the round-3 fork, **certification STOPS here and the open findings are handed over
  rather than certified.** No `WS7: 2/2 clean at <sha>` entry is written, because on this evidence
  it would be a false record.
- [2026-09-04 18:48] RECORDED: round 5's own headline was mine again — `desc = 0.25 * size` used
  `hypot(a,b)`, which pdf.js builds as `fontSize * textHScale`, so under `Tz < 100` the descender
  band NARROWED (halving at Tz 50) and re-opened the leak for condensed text. Third wrong value in
  three rounds for one expression: `extent2` (advance, wrong for vertical), `size` (h-scaled, wrong
  for condensed), and now `col2` — the em along the descender direction in both cases. Fixed and
  guarded; found by two lenses independently.
- [2026-09-04 18:48] RECORDED: the parsed owner-side check from round 4 was O(elements x images) — 205ms per
  DOM walk on a 2402-element body, ~4s of blocked main thread per save on a 4-page document with 20
  images. Now one attribute-value Set per owner. A correctness fix that makes the product unusable
  is not a fix, and I did not measure it when I made the trade.
- [2026-09-04 19:06] RECORDED: the cost above grows SUPERLINEARLY, so the 4s figure is a floor rather
  than the worst case. A stray benchmark left running from the round-5 lens finally reported one data
  point at 10022 elements / 10 images: 119992ms, i.e. ~12s per walk where the 302/1202/2402-element
  series (37/79/205ms) extrapolates to under 1s. [Unverified as a clean figure: it ran concurrently
  with the deploy gate's 398s jsdom suite on an 8-core box this repo already documents as
  load-sensitive, so read it as an order of magnitude, not a measurement.] The lens's own run is the
  corroborating half and needs no such caveat: it never completed a single pass over a
  2000-paragraph document in 170s. The fix is landed either way; this only says the severity was
  understated, which is the direction that matters.
- [2026-09-04 18:48] AGREED: the vertical-writing bound is disclosed as TWO-DIRECTIONAL in `SECURITY.md` and
  `KNOWN_ISSUES.md`. The tested box sits a full run-length on the wrong side of the origin, so a
  redaction ABOVE a vertical run silently REMOVES it — data loss, not just a leak, and previously
  disclosed as only the leak half.
- [2026-09-04 18:48] RECORDED: the fixes in this final commit are POST-PANEL and UNCERTIFIED — no round has
  reviewed them. They are here because leaving a measured leak (Tz) and a measured ~4s-per-save
  regression in place to preserve a process boundary would be the wrong trade, but they carry no
  certification and the next session should treat them as unreviewed.

- [2026-09-04 21:55] SUPERSEDES the [10:34] WS4-F ruling: the Form `/BBox` clip covers `rules` and
  `vRules` ONLY. WS7 round 7 REVERTED it for `colorMap`, because colour is matched to a word BY
  POSITION and the words come from `getTextContent`, which no `/BBox` clips — so a clipped colour key
  left the run exporting BLACK. Clip what INVENTS geometry; never clip an attribute of a word that
  exports regardless. Three places in this plan still describe the old three-channel rule (`:266`,
  `:489`, and the `:52` inventory row); they are HISTORY of the WS4-F design, and this entry is the
  live rule. Recorded because a resuming session reading the plan alone would re-add the reverted clip.
- [2026-09-04 21:58] RECORDED: WS7 round 8 returned 19 findings; the five CODE defects (all in
  `pdfSanitizer.ts`, all introduced by round 7, including a P0 that FROZE the tab on a cyclic action
  `/Next`) are fixed in `a99ccea`. The 13 documentation findings and the one scope decision
  (`/SubmitForm` and `/Launch` survive sanitize — not JavaScript, so no claim is false, but undisclosed)
  are enumerated in `docs/ws7-certification-record.md` § "Round 8", which is TRACKED — the per-round
  reports under `var/claude/ws7/` are gitignored and reach no clone.
- [2026-09-04 21:58] RECORDED: the two-consecutive-clean counter is still **0 of 2** after eight
  rounds, four of which found defects in the previous round's fixes. Round 9 was NOT run: the `/goal`
  stop condition was cleared mid-round-8, so the ladder is PAUSED, not failed. `a99ccea` is itself
  post-panel and uncertified — no round has reviewed it.
- [2026-09-05 00:10] AGREED (developer, "fix the issues/fragilities and security issues and stop at
  that"): the round-8 scope decision is RULED for the CLASS — sanitize strips the non-JavaScript egress
  actions `/SubmitForm`, `/Launch`, `/GoToR`, `/GoToE`, `/ImportData` (spliced at every chain position
  like scripts, `/URI` and `/GoTo` untouched) AND `/FileAttachment` annotations whole, with their
  `/Popup`, deleting `/FS` on the dict so a `/Popup` `/Parent` or reply-note `/IRT` cannot keep the
  file reachable for the sweep. Landed in `3fc0863` with 15 cases, sabotage-verified five ways.
  In-document media actions (`/Rendition` without `/JS`, `/Sound`, `/Movie`, `/GoTo3DView`,
  `/RichMediaExecute`) are deliberately kept. Out of scope by the same instruction: the KNOWN_ISSUES
  P2/P3 deferrals and the non-security doc drifts.
- [2026-09-05 00:10] RECORDED: `a99ccea` (cyclic-`/Next` freeze + splice class) and `3fc0863` are
  both post-panel — certified by EXECUTION (tests, sabotage, the full deploy gate before push) and
  NOT by the WS7 ladder, which stays paused at 0 of 2. `origin/master` was `8ae525c` until this push,
  i.e. production carried the tab-freeze for the interval; the push is what closes it.
- [2026-09-05 01:05] RECORDED: `advisor()` was UNAVAILABLE at the 6C gate for `3fc0863`, so per the
  availability chain ONE unnamed safety-promises reviewer replaced it (not a WS7 round). It returned
  five findings including a P0 — `/AF` is a second path from a paperclip dict to its file and only
  `/FS` was cut, so with any surviving reference the file was re-serialised while the flag said
  removed. Fixed in `128219d` (both keys cut; `/AF` on every annotation, field and bookmark; paperclips
  collected across all pages; self-cyclic `/Next` arrays memoised; the kept-media sentence now has a
  test). Row 17's evidence moves to `128219d`. Still post-panel, still certified by execution only.
- [2026-09-05 07:40] RECORDED: WS7 round 9 ran at `2a19552` with all three lenses (unnamed, isolated
  worktrees) and returned **22 findings** — 4 export, 8 safety, 10 completeness — two of them P1: pdf.js
  reads `/AA` by INHERITANCE through `/Parent`, so a script on the `/Pages` root or on a widget's parent
  field that `/Fields` never lists RAN after sanitize (measured with `page.getJSActions()` and
  `getFieldObjects()`) while the report said clean. Fixed in `6f08fc7`, post-panel like its predecessors —
  certified by execution only until round 10 reviews it. A third P1 was a regression from `3fc0863` (a
  paperclip's own scripts survived when a reply note kept the dict alive). Fixed in row 18 by a backstop
  pass over EVERY dictionary in the file (`/AA`, `/AF`, `/Metadata`, `/PieceInfo`, `/OnInstantiate`, the
  action splice on annotation-shaped dicts) and by cutting `/EF` on the Filespec itself, so a reference
  something else still holds (a kept `/Rendition` clip) cannot keep the bytes. Thirteen red tests (eleven sanitizer, two opcGc), twelve
  sabotage mutations; two older sabotage figures dropped to 0 for a stated reason (the guarantee moved
  one object down and one pass later) and are re-recorded in CLAUDE.md. The counter stays 0 of 2; round
  10 is next.
- [2026-09-05 07:40] RECORDED (within the [00:10] ruling's "metadata", flagged for the developer rather
  than asked): `/PieceInfo` private application data is now stripped too — the safety lens graded it a
  disclosure candidate; Illustrator/InDesign embed the full source document with author paths there, and
  it is one line inside the same backstop pass. It is reported as its own `pieceInfo` flag. If the
  developer would rather keep `/PieceInfo`, it is one line to drop and one test to delete.
- [2026-09-05 07:40] RECORDED: the record's `[2026-09-05]` correction of the opcGc round list ("rounds
  4, 6 and 7") was itself WRONG against the round-6/7 reports (only round 4 was a demonstrated
  live-image deletion; round 9 added a synthetic `.RELS` one); and the plan's `[21:55]` entry cites
  `:52` among the stale colour-clip passages while the record cited `:70` — both lines are TRUE
  statements about a different mechanism; only `:266` and `:489` carry the stale three-channel rule,
  and they stay as declared history.
- [2026-09-13 14:00] AGREED (developer, "Consider the arabic review done !"): WS3 is CLOSED. The 15
  pending Arabic values and the two UNRECONCILED marker sets (`formatting.*` Slice 2, `modal.signers.*`)
  are accepted as reviewed — by ruling, not by a second native read, and every count surface says so.
  `toolbar.sanitizeTitle` under-claimed (en/fr cover scripts, external actions and attached files; ar
  said metadata and JavaScript only), so the session re-worded it to parity the same day; that new
  wording was not natively read and is the ONE value pending. The review table under
  `var/claude/arabic-review/` is left as it is.
- [2026-09-13 14:00] AGREED (developer, "start the rest ! be thorough ! nothings ships without being
  tested and certified !!"): this is the answer to the cap-5 escalation — WS7 continues under the same
  MAXIMAL rules, rounds 10–14 authorised, and reaching round 14 without two consecutive clean rounds
  goes back to the developer. "Nothing ships" is read as NOTHING IS PUSHED to `master` (a push
  auto-deploys) until the counter reads 2/2 clean: rounds review LOCAL frozen commits, as round 9
  already did at the then-unpushed `2a19552`, and every fix still gets TDD, sabotage and the full deploy
  gate before it is counted. Out of scope by the `[2026-09-05 00:10]` ruling unless a lens finds one
  live: the KNOWN_ISSUES P2/P3 deferrals. `/PieceInfo` stripping stays flagged, unruled.
- [2026-09-13 14:10] AGREED (developer, "can you make sure to upgrade all deps/versions to the latest
  ??"): every dependency and CI action moves to its latest release BEFORE round 10 freezes, so a
  single round reviews the upgrade with everything else. Landed in `caf4350` (versions) and `d00cd26`
  (the test-harness and fixture consequences). CI stays on Node 24, the Active LTS that `.nvmrc` and
  `deploy.yml` pin — a runtime-line choice left to the developer rather than read into "latest".
- [2026-09-13 14:55] RECORDED: the upgrade broke nothing in `src/` and four things around it, each
  measured before it was changed (`CLAUDE.md` § "The 2026-09-13 upgrade to latest"). (1) The local gate
  had been run on the shell's Node v27 nightly; Node 25+'s own `localStorage` global shadowed jsdom's
  under vitest 4 — 3 red on Node 26/27, green on 24, green on 26 after vitest 5. (2) `@cantoo/pdf-lib`
  2.11.0 imports JSON without an import attribute: 37 suites dead at import; fixed by inlining it in
  the jsdom config, with pre-bundling measured and refused (`createRequire is not a function` from
  fflate's Node entry). (3) Ten truncated PNG fixtures, exposed by fflate's strict inflate. (4) One
  `test:coverage:export` run died at load ~22 with "iframe did not become ready within 60000ms" and
  no optimize/reload line; it passed alone and again in the cold-cache CI order, so it is recorded as
  the harness's load-dependent start-up failure, not fixed.
- [2026-09-13 17:46] RECORDED: WS7 round 11 at `ac08b61` = **12 findings** (2 export + 2 safety + 8
  completeness), counter stays 0 of 2. Code: Sanitize & download never applied Lock PDF (P2,
  pre-existing), and round 10's own load guard re-scanned the file once per dangling reference (P2) and
  refused a legal file whose page text reads `9 0 obj` (P3). All fixed with failing tests first and five
  sabotages. The safety lens's probe of an unparseable object inside an object stream was vacuous (a
  classic-xref fixture cannot place an object in one) and is recorded as NOT EXECUTED, not clean. Record:
  `docs/ws7-certification-record.md` § Round 11.
- [2026-09-13 19:18] RECORDED: WS7 round 12 at `d7eb108` = **13 findings** (5 export + 1 safety + 7
  completeness), counter stays 0 of 2. Code: the load guard's text scan for object headers was wrong six
  ways, five of them accepting a file pdf-lib had dropped from (P1 by the export lens: a stream with no
  `endstream` ended the scan), and round 11's own stream skip and boundary rule caused three. Replaced by
  recording drops at pdf-lib's two drop points, which also closes the dropped-newest-revision bound.
  Compress joined the Lock PDF class test. Record:
  `docs/ws7-certification-record.md` § Round 12.
- [2026-09-13 21:00] RECORDED: WS7 round 13 at `94dcc89` = **6 findings** (2 export + 1 safety + 3
  completeness), counter stays 0 of 2. Code: a pdf.js / pdf-lib parse differential (P1, safety,
  pre-existing) — a file whose cross-reference table names an earlier copy of an object, or whose startxref
  trailer names another /Root than the last trailer pdf-lib keeps, showed one page and exported or signed another with nothing dropped; a drop
  reachable only through a kept damaged object was never walked (P2, export); a drop superseded by the same
  interned value still refused (P3, export). The P1 was implemented rather than disclosed, as a narrow
  comparison against the cross-reference sections pdf-lib itself parses, gated on zero refusals over the
  20-file real corpus (14 of 15 `var/corpus` files reach it — corrected in round 14: 10 of those 14 were
  cross-reference streams parsed without their predictor, so only 4 really compared). Record: `docs/ws7-certification-record.md`
  § Round 13.
- [2026-09-13 22:10] AGREED: after WS7 round 14 (9 findings — export F1 P1 free/offset-0 entry for a
  reachable object skipped, F2 P1 single-trailer /Root never compared, F3 P2 identity instead of value
  comparison; 6 completeness P3 doc claims), the developer authorised fixing all 9 (failing test first,
  sabotage, full Node-24 gate, local commit, no push) and ONE further review round (15), then asking
  again whatever round 15 returns. Nothing is pushed until two consecutive clean rounds.
- [2026-09-14 00:00] AGREED: stop for tonight with the round-14 fixes uncommitted — the Node 24 gate was green through
  jsdom, but the browser step went red twice on a machine at load 18–24 with swap full (9–16 of 90 files ran,
  a different set failing each time, the first three passing 18/18 in isolation); resume by re-running the
  browser step onward on a quiet machine before any commit.
- [2026-09-14 09:54] RECORDED: WS7 round 14 at `9849db3` = **9 findings** (3 export + 0 safety + 6
  completeness), counter stays 0 of 2. Code: row 24's comparison skipped a reachable object the chain marks
  free or places at offset 0 (P1, export — pdf.js draws blank, pdf-lib exports), never compared a /Root that
  pdf-lib's root recovery swapped on a single-trailer file (P1, export), and compared copies by identity,
  refusing byte-identical duplicates (P2, export); six doc claims (P3, completeness), among them that editing
  refuses (it falls back to an overlay) and a linearized skip the code does not have. All fixed with failing
  tests first. Found in passing while measuring the fixes on real files: pdf-lib parses a cross-reference
  stream without its /Predictor, so 10 of the 14 files round 13 counted as reaching the comparison had
  compared noise; the recorder now decodes those entries as pdf.js does, and all 15 are read through the
  chain with every in-use entry landing. Also found in passing: a corpus run filtered to one test measured its
  first file before the recorder was installed and read it as unread; `describeParse` now throws instead. The browser step, blocked overnight by machine load, passed on the same tree at load 0.5 on 2026-09-14 and
  every later gate step with it; fix commit `0122d96`. Record: `docs/ws7-certification-record.md` § Round 14.
- [2026-09-14 11:45] AGREED: WS7 round 15 at `b7b5778` = **4 findings** (0 export + 0 safety + 4 completeness: P2 the
  certification record's header still says thirteen rounds; P3 SECURITY/KNOWN_ISSUES overstate which exports refuse;
  P3 "3 of 70" cites a filtered run; P3 a load-guard refusal reaches the user only as a generic "try again" toast),
  counter stays 0 of 2. The developer ruled: fix all 4 (failing test first, sabotage, full Node-24 gate), then run
  rounds autonomously — reviewers required to build crafted probe files — until two consecutive clean rounds, then
  push; ask only if a round returns a P0/P1 or the total reaches round 20.
- [2026-09-14 12:29] RECORDED: the four round-15 findings are fixed in `0932e80`: `isPdfLoadRefusal` (walks the
  `cause` chain, so the signer's `PDF_PARSE_FAILED` wrapper is seen through) routes a load-guard refusal to
  `toast.pdfLoadRefused` in the seven exportService save catches, the OCR run and the three sign-modal catches;
  the record header, the export scope in SECURITY/KNOWN_ISSUES and the filtered-run denominator are corrected.
  Red first for the stated reason (17 of 50), sabotage 5/5 landed and restored, full Node-24 gate green. Round 16
  next. Record: `docs/ws7-certification-record.md` § Round 15.
- [2026-09-14 12:53] AGREED: WS7 round 16 at `8fcacdd` returned a P1 (export lens: `readXrefChain` abandons the whole
  comparison at the first /Prev or /XRefStm offset pdf-lib did not parse, while pdf.js skips only that section and
  keeps its table, so a file shows one page and exports or signs another) plus a P2 and a P3 doc disagreement.
  The developer ruled: fix it — mirror pdf.js by skipping an unreadable section, failing test first, sabotage,
  full Node-24 gate — fix the doc findings in the same pass, then continue autonomous rounds on the same stop
  rules (ask on a P0/P1 or at round 20).
- [2026-09-14 13:00] RECORDED: round 16 closed at 4 findings (export P1 + P2, safety P1, completeness P3). The safety P1
  (a content-stream entry with a wrong nonzero offset draws BLANK in pdf.js while the export and signature carry the
  content; `'unreadable'` is skipped by the comparison and four documents say pdf.js rebuilds) falls under the
  12:53 ruling, whose recommended option named "any safety findings in the same pass". Counter stays 0 of 2.
- [2026-09-14 14:08] RECORDED: the four round-16 findings are fixed in `c3221ed`: `readXrefChain` skips a section
  pdf.js cannot read (keeping a rejected stream's rows, `/XRefStm` only from a table), an entry that does not land
  on its object counts as `'unreadable'` and refuses, and `loadMeetsUnreadable` mirrors pdf.js's opening walks
  (`checkFirstPage` / `checkLastPage` with the `/Count` skip and the `getAllPageDicts` fallback). 13 of 20 new cases
  red first; sabotage 10 of 11 red (S8 equivalent); corpus unchanged at 15 of 15 and 12,059 of 12,059; Node-24 gate
  ALL GREEN; the browser file pins the two new refusal shapes. Docs corrected for both P1s, the P2 and the P3.
  Counter stays 0 of 2; round 17 next on the same stop rules.
- [2026-09-14 15:31] AGREED: WS7 round 17 at `63d877e` (reviewed as `29c2d8d`, amended to an identical tree) = **4 findings** (safety P1: a `/Count` lie in an ordinary
  page tree shows one page and exports/signs another; export + completeness P1: pdf.js keeps `_tableState` after a
  table it cannot finish, so every later TABLE in the queue fails while `readXrefChain` adds its rows; completeness
  P2: nine surfaces state "skips only that section" as fact; completeness P3: an indirect `/Prev` is not followed).
  The developer ends the open-ended round loop ("that's enough rounds"): fix all four, then ONE finite
  branch-by-branch audit of pdf.js's cross-reference and page-walk code against the guard, fix what it lists, run
  the full Node-24 gate with sabotage, and push. No further rounds. This replaces the two-consecutive-clean-rounds
  criterion for WS7.
- [2026-09-14 16:15] RECORDED: the developer, mid-fix: "Let's stop at a clean correct version!" Read as: land the
  four round-17 fixes tested, gated and pushed, then ask before starting the one audit. Correction to the 12:53 entry
  above: "costs that section only" held only when no table followed one pdf.js could not finish (round 17).
- [2026-09-24 00:30] RECORDED (session-decided, developer asleep — NOT a ruling; review on waking): round-17
  fixes landed as `e19880b` + `3e98c7c` after the full Node-24 gate at settled load (jsdom 2836, browser 354,
  coverage 44.07%, build, QA sweep 151/114/0). The developer said "do what you can… take the best recommended
  one and note it". Taken: START the one finite pdf.js cross-reference/page-walk audit that the 15:31 entry
  said to ask about first. Output: a branch-by-branch table in `docs/ws7-certification-record.md`; fixes only
  for branches it proves divergent, each test-first with sabotage. Not taken on the developer's behalf: the
  three **Needs input** items, which stay open with a recommendation attached.
- [2026-09-24 00:40] RECORDED (session): the audit was STOPPED before any result — its two subagents raised
  permission prompts while the developer was asleep ("You are prompting for permissions!"). Nothing from it was
  kept or acted on. Resume it in an attended session; the two prompts (xref half, page-walk half) are in this
  session's transcript. CI for `3e98c7c` was not watched to completion — check the Actions run first.
- [2026-09-24 09:58] AGREED: the developer ruled the three **Needs input** items and the next action. (1) Keep the
  in-document media actions (`/Rendition` without script, `/Sound`, `/Movie`, `/GoTo3DView`, `/RichMediaExecute`):
  they play only on a user click and stay inside the document. (2) Keep stripping `/PieceInfo` (source document and
  author paths). (3) Move CI to Node 26 NOW (against the session's stay-on-24 recommendation): `.nvmrc`, `engines` and
  `deploy.yml` together, and the local gate runs on 26 from here on. (4) Run the one finite pdf.js cross-reference /
  page-walk audit attended, fix only proven divergences test-first with sabotage, full gate, push.
- [2026-09-24 11:05] AGREED: the closing audit (15 rows, `docs/ws7-certification-record.md`) found 11 measured
  divergences under one cause — the guard models pdf.js's reader on pdf-lib's parse. The developer chose DISCLOSE AND
  CLOSE: fix the one false refusal (P3a) and the wrong rebuild disclosure (X6), record the 10 missed refusals as ONE
  named bound in `SECURITY.md` / `KNOWN_ISSUES.md`, full gate on Node 26, push. WS7 closes certified with named
  bounds. Replacing the mirror by running pdf.js itself is the recorded path forward, not scheduled.
- [2026-09-24 11:05] RECORDED: pushed as `3e98c7c..f0846c1` (Node 26 move `a2bc53e`, P3a fix + disclosures `fed1f15`, docs
  `f0846c1`) after the full deploy gate on Node 26 at load 11-32 (audit 0, type-check, lint, jsdom 2839, browser 354/354,
  export coverage 44.07%, build, QA sweep 151/114/0). CI run 35978224281 — the first on Node 26 (setup-node 26.10.0) —
  watched to completion: build and deploy green. WS7 is closed, certified with named bounds.
- [2026-09-24 11:25] AGREED: the master plan stays LIVE with a WS8 `todo` row — replace the load guard's pdf.js mirror by
  running pdf.js itself and comparing what it resolves per page with pdf-lib's copy, which closes the class the closing
  audit disclosed. Unscheduled until the developer says go; needs a perf measurement on the 15-file corpus first.
- [2026-09-24 18:45] RECORDED: the WS8 cost probe landed (f21485c) — findings and the go / no-go question are under Status § Needs input.
- [2026-09-24 18:55] AGREED: build WS8 and REPLACE the load guard's pdf.js mirror with the per-page pdf.js comparison the probe measured (fresh-document copy, text fingerprint, annotations excluded); Large — a full plan and an explicit go come before any code.

## Status
<!-- progress-block v1 -->
| # | Step | Size | State | Evidence | Files |
|---|------|------|-------|----------|-------|
| 1 | Step 0 — consolidation: archive 4 superseded plans | S | done | 7f49360 | docs/plans/**, docs/archive/plans/** |
| 2 | WS0 — doc-drift reconciliation (ten drifts) | M | done | 46962b0 | CLAUDE.md, SECURITY.md, VISION.md, src/utils/geometry.ts |
| 3 | WS1 — close uncertified dimensions + orphan-leak flake | M | done | 94600f2 | tests/browser/**  |
| 4 | WS2 — C22 flow layout on non-zero CropBox origin | L | done | c03fd5e | src/export/**, src/utils/flowDoc.ts |
| 5 | WS3 — Arabic native review: closed by ruling, sanitizeTitle re-worded to parity (3 pending since WS7 round 10) | S | done | 6a39a82 | locales/** |
| 6 | WS4-A — ink composited above the burn | M | done | 347fa63 | src/export/**, tests/browser/redaction-ink-clip.browser.test.ts |
| 7 | WS4-B — rotated element/redaction true footprint | M | done | 4054713 | src/export/**, src/utils/geometry.ts, src/handlers/ocrHandler.ts |
| 8 | WS4-F — Form /BBox clip in walkPageOps | M | done | c0883b2 | src/export/opStreamWalker.ts, tests/browser/form-bbox-clip.browser.test.ts |
| 9 | WS4-C — blank-page blunt whole-drop (refuted, pinned) | M | done | bedc208 | tests/browser/hide-vs-remove.browser.test.ts |
| 10 | WS4-E — signer vs assembled crop-origin (refuted, bound corrected) | M | done | 16b3101 | tests/browser/sign-assembled-frame.browser.test.ts |
| 11 | WS4-D — DOCX part GC on image delete | L | done | 1c41dd5 | src/docx/opcGc.ts, src/docx/docxProseMirror.ts |
| 12 | WS6 — aspect-ratio-aware crop apply-to-all | M | done | b99db82 | src/core/pageService.ts, src/utils/geometry.ts |
| 13 | WS6 — #54b open-via-picker + recent files | M | done | cee4ad0 | src/utils/fileSystemAccess.ts, src/infra/recentFiles.ts, src/ui/recentFilesMenu.ts |
| 14 | WS6 — C9 measured against a real corpus; stays unwired | L | done | 574a9f5 | tests/tools/c9Corpus.test.ts, scripts/c9-corpus-fetch.sh |
| 15 | WS5 — adversarial audit: 30 findings, P0/P1 fixed | L | done | 9894939 | src/utils/flowDoc.ts, src/utils/pdfSanitizer.ts, KNOWN_ISSUES.md |
| 16 | WS7 — certification: 17 rounds + closing audit (11 divergences: P3a fixed, 10 disclosed as one bound, ruled 2026-09-24) | L | done | fed1f15 | src/utils/pdfLoadGuard.ts SECURITY.md KNOWN_ISSUES.md |
| 17 | Sanitize — non-JS egress class + paperclip attachments (ruled 2026-09-05) | M | done | 128219d | src/utils/pdfSanitizer.ts, tests/utils/pdfSanitizer.test.ts, SECURITY.md |
| 18 | WS7 round 9 — 22 findings fixed: inherited /AA backstop, Filespec severed, XMP+/AF on any object, opcGc .RELS | M | done | 6f08fc7 | src/utils/pdfSanitizer.ts, src/docx/opcGc.ts, tests/utils/pdfSanitizer.test.ts, tests/docx/opcGc.test.ts, docs/ws7-certification-record.md |
| 19 | Upgrade every dependency and CI action to latest (ruled 2026-09-13) | M | done | caf4350 | package.json, package-lock.json, .github/workflows/deploy.yml |
| 20 | Upgrade consequences: pdf-lib 2.11.0 inlined in jsdom, nine broken PNG fixtures replaced | S | done | d00cd26 | vitest.config.ts, tests/** |
| 21 | WS7 round 10 — 18 findings + a parser drop fixed: tolerant PNG embed, guarded pdf-lib load, sanitizer refuses unparseable objects, Lock PDF encrypts strings | M | done | 9e03376 | src/utils/pdfLoadGuard.ts src/utils/pngEmbed.ts src/utils/pdfSanitizer.ts src/export/exportService.ts |
| 22 | WS7 round 11 — 12 findings fixed: sanitize honours Lock PDF, load guard single-pass anchored header scan | M | done | 0ee442c | src/utils/pdfLoadGuard.ts src/export/exportService.ts |
| 23 | WS7 round 12 — 13 findings fixed: load guard records pdf-lib drops in its parser, compress in the Lock PDF class | M | done | 02dd373 | src/utils/pdfLoadGuard.ts tests/utils/pdfLoadGuard.test.ts tests/utils/_invalidObjectFixture.ts tests/browser/pdf-load-guard.browser.test.ts tests/export/exportPasswordSave.test.ts tests/browser/compress.browser.test.ts |
| 24 | WS7 round 13 — 6 findings fixed: load guard refuses a pdf.js/pdf-lib parse differential, supersede by assignment order, damaged objects refuse standing drops | M | done | 42756ed | src/utils/pdfLoadGuard.ts tests/utils/pdfLoadGuard.test.ts tests/utils/_invalidObjectFixture.ts tests/utils/pdfLoadGuardCorpus.test.ts tests/browser/pdf-load-guard.browser.test.ts |
| 25 | WS7 round 14 — 9 findings fixed: free/offset-0 entries and a recovered root refuse, copies compared by bytes, cross-reference stream predictors decoded as pdf.js does | M | done | 0122d96 | src/utils/pdfLoadGuard.ts tests/utils/pdfLoadGuard.test.ts tests/utils/_invalidObjectFixture.ts tests/utils/pdfLoadGuardCorpus.test.ts tests/browser/pdf-load-guard.browser.test.ts tests/handlers/textEditHandler.test.ts |
| 26 | WS7 round 15 — 4 findings fixed: a load-guard refusal shows its own message, export scope and round count corrected in the docs | S | done | 0932e80 | src/utils/pdfLoadGuard.ts src/export/exportService.ts src/core/pdfTurboApp.ts src/handlers/signingHandler.ts locales/en.json locales/fr.json locales/ar.json tests/utils/pdfLoadRefusal.test.ts tests/export/exportSaveRouting.test.ts tests/handlers/signingContext.test.ts tests/core/ocrRefusalToast.test.ts |
| 27 | WS7 round 16 — 4 findings fixed: comparison continues past a section pdf.js skips, an entry it cannot read refuses, opening walks mirrored | M | done | c3221ed | src/utils/pdfLoadGuard.ts tests/utils/pdfLoadGuard.test.ts tests/utils/_invalidObjectFixture.ts tests/browser/pdf-load-guard.browser.test.ts |
| 28 | WS7 round 17 — 4 findings fixed: /Count page-order mismatch refuses, tables after one pdf.js cannot finish read no rows, indirect /Prev followed, linearized start | M | done | e19880b | src/utils/pdfLoadGuard.ts tests/utils/pdfLoadGuard.test.ts |
| 29 | CI and local gate move to Node 26 (ruled 2026-09-24) | S | done | a2bc53e | .nvmrc package.json package-lock.json .github/workflows/deploy.yml tests/infra/prePushHook.test.ts |
| 30 | WS8 — replace the load-guard mirror: run pdf.js and compare per page with pdf-lib's copy (done; rows in docs/archive/plans/ws8-viewer-check.plan.md) | L | done | 17d31d4 | src/utils/pdfLoadGuard.ts, tests/tools/ws8Cost.test.ts |
<!-- /progress-block -->
### Blocked
### Needs input
### Needs research
### Fragile
### Known issues
