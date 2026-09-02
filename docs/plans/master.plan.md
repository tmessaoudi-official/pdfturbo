# PDFturbo master plan — the single source of truth

> **Status**: LIVE — this is the only live plan. Written 2026-09-01 against baseline
> `08a9af2` (= `origin/master`, clean tree). It consolidates and supersedes the four plans now in
> `docs/archive/plans/` (`redaction-audit`, `qa-hardening-followups`, `eh-e-borderless-tables`,
> `crop-margins`) — **until Step 0 runs, those four files are still in `docs/plans/` beside this
> one; treat them as READ-ONLY history, never as instructions.** Every open item they carried was
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

## Verified current state (2026-08-31, at `08a9af2`)

| Check | Result |
|---|---|
| type-check / lint | ✓ / ✓ (4 known pre-existing `no-shadow` warnings) |
| jsdom suite | 215 files, **2464 passed + 2 expected-fail** |
| real-Chrome suite | 83 files, **280 passed + 1 expected-fail** |
| `redaction-orphan-leak` flaky test | 3/3 green isolated AND green inside the full run (flake only ever seen under full-suite load) |
| All redaction-audit guard files | exist with exact claimed runtime counts (27/12/6/8/17/10/8) |
| `.gitignore` `tests/**/zz*` | present; zero probe files tracked |
| Annotation strip | reads page frame BEFORE `buildPageOverlays` at both call sites (`exportPipeline.ts:412-415`, `exportService.ts:1182-1187`) |
| `walkPageOps` | `annotationDepth` gating live (images collected in annotations; rules/vRules/colorMap suppressed); `/BBox` clip NOT modelled (→ WS4-F) |
| KNOWN_ISSUES.md | C22 present, C12 corrected, Arabic pending count = 12 (correct figure) |
| Certification counter | **0/2 clean** under MAXIMAL — the pushed milestone is uncertified, recorded with developer authorization (→ WS7) |

No product defect was found by the verification pass — only the nine doc-drifts in WS0.

## Fragile surfaces — handle with care (each has bitten before)

- **Coordinate frames are this repo's recurring bug family** (4 recorded instances). Anything
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
| WS1 — uncertified dimensions + flake | **DONE** 2026-09-02 | 1a/1b/1c closed with sabotage-proven guards. 1d did NOT reproduce in 27 runs and the timeout hypothesis is refuted by measurement — see the Decisions Log and CLAUDE.md § the orphan-leak flake. |
| WS2 — C22 flow layout | not started | |
| WS3 — Arabic ×12 | **awaiting the developer** | Review table extracted to `var/claude/arabic-review/pending-12.md` (gitignored) and sent. All 12 keys resolve in all three locales. |
| WS4 — bound PoCs | not started | |
| WS5 — adversarial audit | not started | |
| WS6 — feature backlog | not started | |
| WS7 — certification | not started | Range `dfe34ae..HEAD` still resolves. |

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

## WS3 — Arabic ×12 native review (user-gated; interleave anywhere)

1. Extract a review table from `locales/*.json` for the 12 pending keys (the enumeration of record
   is `KNOWN_ISSUES.md:69-74`): `toolbar.exportXlsxTitle`, `badge.signRect`, the six
   `toolbar.cropMargin*` keys, `toast.cropMarginsTooLarge`, and the three re-worded values
   (`toolbar.cropTitle`, `toast.modeHint.crop`, `toast.redactionPlaced`). Columns:
   key | en | fr | current ar | (blank) proposed ar.
2. OPTIONALLY append the two UNRECONCILED marker sets (`formatting.*` Slice-2 keys,
   `modal.signers.*`) so the developer can finally confirm or correct them in the same pass.
3. Present via `AskUserQuestion` / a review file; apply the answers; new values drop their
   `[Unverified]` status dated with the review.
4. Update ALL count surfaces in ONE commit (the three-places-drift trap is a recorded repo lesson):
   `KNOWN_ISSUES.md:68-74`; `CLAUDE.md` § i18n (the AMENDED 2026-08-05 paragraph), § "The
   hide-vs-remove audit" (the pending-count sentences), § "XLSX table export" (the "12 values
   pending as of 2026-08-05" sentence); then the discriminating sweep:
   `grep -n "pending\|Unverified\|UNRECONCILED" CLAUDE.md KNOWN_ISSUES.md` — every remaining hit
   verified true.

## WS4 — Disclosed-bounds PoCs ("try to overcome the odds")

Six bounds are currently DISCLOSED in `SECURITY.md` with recorded reasons. Developer ruling
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
   `src/utils/contentStreamEditor.ts`, `src/docx/**` (the in-place save), `src/core/storage.ts` +
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
  (`src/utils/borderlessTable.ts`, `_resolveTableGrid` at `exportService.ts:515`) — this is a
  wiring + threshold change, not new detection work.
- **Aspect-ratio-aware crop apply-to-all** (`KNOWN_ISSUES.md` § Deferred). Extend
  `PageService._commitCrops`/apply-to-all so a drawn crop maps to other page sizes preserving the
  RATIO and relative position instead of clamping one absolute rect. Undo stays one `MacroCmd`.
- **#54b — open-via-picker + recent files** (`src/utils/fileSystemAccess.ts`).
  `showOpenFilePicker` where available (progressive enhancement, mirror `canUseFsSave`), recent
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
   rounds → ask the developer via `AskUserQuestion` (never silently proceed).
5. The completion report states per dimension what was certified BY EXECUTION and what was not,
   naming each uncertified dimension — `UNCERTIFIED-BY-EXECUTION` in those words where it applies.

## Inputs needed from the developer (the only ones)

1. **WS3**: the Arabic review answers for the 12 (+ optional 2 UNRECONCILED sets) values.
2. **WS4**: promote/refute rulings on any PoC whose evidence is ambiguous.
3. **WS7**: the cap-5 escalation decision, if reached.

Everything else is executor-autonomous under this repo's git-autonomy and no-interrupts rules.

## Decisions Log

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
- [2026-09-02 08:20] RECORDED: WS1-1d found NO reproduction in 27 executions (18 isolated at load
  ~16, 9 in-suite across 3 full browser runs at load 16.7–19.6) and REFUTED the timeout hypothesis
  by measurement — the test is faster in-suite (2.7–3.7s) than isolated (4.1–13.2s) because pdf.js's
  worker is warm by then, against a 30s budget whose suite-wide maximum is 10.1s. No retry and no
  timeout bump were added. The only change is diagnosability, and it is disclosed as
  UNCERTIFIED-BY-EXECUTION: no current fixture in that file can reach either error hook.
- [2026-09-02 08:20] AGREED: fix the dropped-cause error hooks at ALL THREE sites across both files
  that use the pattern, not only in the flaky one — and note that `IErrorReporter`'s second argument
  means params for `warn` and a cause for `error`, which the first version of the fix got wrong.
