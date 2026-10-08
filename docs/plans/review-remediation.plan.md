# Review remediation Plan

Follow-up of the read-only whole-repo review of 2026-10-07/08 (five lenses: architecture against the DDD + Hexagonal
target, code quality, tests and delivery, security and safety promises, framework sync and docs; 102 findings:
P0 1, P1 13, P2 39, P3 49). The lens reports were transient (`var/claude/review-20261007/`, gitignored); every
finding this plan acts on is restated in its Status row so the plan stands on its own. The architecture migration
has its own plan: `docs/plans/architecture.plan.md`.

## Decisions Log
- [2026-10-08 01:33] AGREED: SEC-1 (P0): qualify the three SECURITY.md rows now (docs only), then fix test-first under the milestone panel; then TEST-1, TEST-2, TEST-3 and QUAL-1 the same way (developer, review session 2026-10-08).
- [2026-10-08 01:33] AGREED: Push cadence: drop the per-green-change push override; adopt global Rule 10's batch-of-10 (milestone ends and stops are push points) (developer, review session 2026-10-08).
- [2026-10-08 01:33] AGREED: Milestone certification: drop the repo's two-consecutive-clean-rounds tier; one three-lens panel per milestone on a frozen commit, as the certification schedule says (developer, review session 2026-10-08).
- [2026-10-08 01:34] AGREED: framework-health step 9 L4 pack in this repo: path-scoped additions to .claude/rules/ only, after the stale-gotcha prune; no domain-* skills, no unscoped core; amend the three-skills line to say why. Relayed to the ~/.claude session (developer, review session 2026-10-08).
- [2026-10-08 01:34] AGREED: Author casing: 'Takieddine MESSAOUDI' is canonical (git config and every commit since 2026-08-18); CLAUDE.md drops the false 'matches 100% of history' claim (developer, review session 2026-10-08).
- [2026-10-08 01:34] AGREED: Re-sign + force-push happens only after CLOUD sessions (no GPG keys there); local commits are signed at creation. Keep the fetch-first rule, scoped to after a cloud session (developer, review session 2026-10-08).
- [2026-10-08 01:34] AGREED: Docs and config drift: all of it in one docs-only pass; P2 code findings fold into the roadmap or become plan rows, P3s are fixed when their file is touched; work starts in this session in the order of the Status block (developer, review session 2026-10-08).
- [2026-10-08 01:56] AGREED: SEC-1 links: kept pages link to their real export pages (fixes the measured jump-to-page-1 of every internal link); a link to a REDACTED page is retargeted to its image page; a link to a DELETED or out-of-range page is removed; a multi-page form field keeps only the widgets of exported pages; nothing from an excluded page is copied (developer, 2026-10-08).
- [2026-10-08 02:22] ASSUMED (review): Milestone 1 panel reviewers (export-fidelity, safety-promises, completeness) run on opus - source override (agent reviewer = as-is, session opus); reviewers return findings and the orchestrator writes var/claude/raw/m1-<lens>.md because the repo agents have no Write tool.
- [2026-10-08 03:11] AGREED: M1-S1 shared resources: for a copied page whose /Resources is shared or inherited, keep only the XObjects, patterns and shadings its content (and the forms it draws) uses; if that content cannot be parsed the export refuses and points to Compress -> flatten to images (fail closed); clean files stay byte-identical (developer, 2026-10-08).
- [2026-10-08 04:39] ASSUMED (review): M1 round 2 panel: the shared-resources prune covers EVERY resource owner the copy reaches (page, form, tiling pattern, appearance stream, Type3 font) and every category (XObject, Pattern, Shading, ExtGState, Font, Properties, ColorSpace), removing an entry only when the owner does not draw it AND a left-out page reaches it - because FPDI templates carry the shared /Resources on their own forms (reviewer read setasign FpdfTplTrait), so a page-only, three-category prune still leaked. Alternatives: refuse every shared-resources export (loses common FPDF files); flatten such pages to images (loses text).
- [2026-10-08 04:39] ASSUMED (review): M1 round 2: references to the source catalog and to page-tree nodes are cut, and every /AcroForm field node off a kept widget's /Parent chain is cut (only when some page is left out) - because a signature /Reference /Data and ResetForm/Hide actions carried the whole document or a removed page's field value. Alternative: cut only the two measured action shapes.
- [2026-10-08 04:39] ASSUMED (review): M1 round 2: tokenizeContentStream throws on a stray top-level delimiter instead of looping forever - because the prune put it on every PDF export and a malformed stream froze the tab; true-edit callers already fail closed on a throw. Alternative: skip the byte (silently changes what true-edit reads).
- [2026-10-08 05:48] ASSUMED (review): M1 round 3: /ColorSpace is NOT pruned (reversing the round-2b entry's category list) - because pdf.js resolves colour-space names outside cs/CS (a shading's /ColorSpace, an Indexed or Separation base, an alias), so pruning recoloured kept pages, while a colour space draws no content; disclosed in SECURITY.md and KNOWN_ISSUES. Alternative: model every pdf.js colour-space lookup.
- [2026-10-08 06:54] ASSUMED (review): M1 round 4: a field's or widget's /DR is pruned like any owner, keeping what the /DA strings it serves name (its own, inherited through /Parent then the AcroForm's, and every descendant's) - because /DR named the FPDF shared dictionary and carried a removed page's forms (R4-S-2), and a viewer only builds appearances from fonts /DA names. Alternatives: drop /DR entirely (breaks appearance regeneration); disclose as uncovered.
- [2026-10-08 06:54] ASSUMED (review): M1 round 4: a single content stream's own /Resources is read the way pdf.js merges it (stream wins, only two direct sub-dictionaries merge; an array /Contents is not merged) and a page entry shadowed by the stream's counts as not drawn - because pruning against page resources alone blanked a kept page (R4-C-2) and keeping by name leaked the shadowed entry. Alternative: refuse any page whose content stream has /Resources.
- [2026-10-08 06:54] ASSUMED (review): M1 round 4: the sign-rect box (assembledPageBox) assembles without the shared-resource prune - because it only reads the crop box, saves nothing, and the prune's refusal turned a pick into a fallback (R4-K-3). Alternative: keep it and disclose the cost.
- [2026-10-08 07:37] ASSUMED (review): M1 round 5: resource 'sharing' is transitive (an entry counts as reaching a removed page when anything below it does) - because an undrawn wrapper only the kept page reached carried the removed page's form (R5-S-1); cost accepted and measured (Publication 17 delete-last median 11 s at load ~24). Alternative: keep shallow and prune each owner only where drawn (needs a drawn-owner graph).
- [2026-10-08 07:37] ASSUMED (review): M1 round 5: a member of an array /Contents is treated as drawing nothing from its own /Resources (pdf.js never reads them), so shared entries there are dropped. Alternative: refuse such pages.
- [2026-10-08 08:09] AGREED: M1 cap: run a sixth panel round on e74b863 with the inventory method - two tables (every pdf.js name-resolution/inheritance site from pdf.worker.mjs; every spec key holding a resources dictionary or owner), each row matched to its code path, every unmatched row a finding.
- [2026-10-08 08:09] AGREED: M1 prune cost: re-measure on an idle machine and profile where the time goes before deciding; docs keep the loaded figure marked as such until then.
- [2026-10-08 08:09] AGREED: M1 push: hold all unpushed commits until milestone 1 is certified (or the developer accepts the risk).
- [2026-10-08 08:51] ASSUMED (review): M1 round 6: the structure tree is cut like the catalog, always (not only when a page is left out) - because a structure destination names an element whose /P chain is the whole tree with every page's marked content, and the export never carries the tree. Alternative: cut only when a page is left out.
- [2026-10-08 08:51] ASSUMED (review): M1 round 6: /PieceInfo, /Thumb, /DPart and /Alternates are dropped from a kept object when they reach a removed page, kept otherwise - because no viewer draws them for that object (R6-S-3/4/6/7). Alternative: always drop them (a sanitizer-like change of every PDF export).
- [2026-10-08 08:51] ASSUMED (review): M1 round 6: a widget's /MK icon is kept with the widget and disclosed - because it is the kept widget's own appearance source (R6-S-5). Alternative: drop /MK entries that reach a removed page (icon lost on appearance rebuild).
- [2026-10-08 08:53] ASSUMED (review): M1 round 6: a field-tree node is foreign by membership in the AcroForm field tree (/Fields and /Kids), not only by carrying /FT - because an intermediate node without /FT still holds /V and /Kids of the removed page (R6-S-2). Alternative: keep the /FT test alone.
- [2026-10-08 08:53] ASSUMED (review): M1 round 6: a widget's regenerated appearance prunes its /AP /Resources against every /DA seen for that appearance (accumulated across widgets sharing it), and an array /Contents member is registered as drawing nothing only when it is neither a single /Contents nor a form, registered before any copy - because pdf.js regenerates from /DR + /AP resources by the /DA font, and the copy order decided the result (R6-C-3/4/5). Alternative: refuse such pages.
- [2026-10-08 08:53] ASSUMED (review): M1 round 6: a resources category outside the standard eight is dropped from a kept owner when it reaches a removed page - because no conforming reader draws through it and keeping it carries the removed page's objects (R6-S-8). Alternative: keep it (spec-invalid key, leak).
- [2026-10-08 09:32] ASSUMED (review): M1 round 6 (6C): the structure-tree cut runs only when a page is left out, superseding the earlier 'always' entry - because with every page kept the tree carries nothing the export lacks, and cutting it changed clean PDF 2.0 exports (a link lost its /SD, a link to an element lost its target). Alternative: cut always, like the catalog.
- [2026-10-08 09:43] AGREED: M1 after round 6: certify with a full three-lens panel round 7 on the frozen commit (developer, 2026-10-08).
- [2026-10-08 09:43] AGREED: M1 cost: ship the prune as is with the cost documented; a separate follow-up step replaces full tokenizing with a name-only scan, with its own gate and panel (developer, 2026-10-08).
- [2026-10-08 09:43] AGREED: M1 push: stays held until M1 is certified (developer, 2026-10-08).
- [2026-10-08 09:43] ASSUMED (review): M1 round 7 reviewers run on opus - source override (as-is = the session model, opus).

## Formal Plan

Two milestones, each certified by ONE three-lens panel (`export-fidelity-reviewer`, `safety-promises-reviewer`,
`completeness-reviewer`) on a frozen commit, then pushed. A P0 fix is never held back by the batch-of-10 push rule:
the milestone boundary is a push point.

**Milestone 1 — SEC-1 fixed (rows 1–2).**
SEC-1 (P0): an excluded page — redacted, deleted, or outside an extracted range — is serialised whole into the export
when a kept page references it (a link `/Dest` or `/A /GoTo`, a multi-page form field's `/Kids` → widget `/P`,
probably `/Popup` / `/IRT`). `copySourcePages` deep-copies everything a kept page reaches, `_assemblePdfDoc` filters
page indices only, and pdf-lib does not garbage-collect. Reaches Download, Extract range, single-page download,
Flatten (link vector) and `assemblePdfBytes` → signed, sanitized and compressed outputs. Measured 2026-10-07 with a
probe of `copySourcePages` (2-page source, page 2 excluded): no reference → clean; GoTo `/Dest` → secret in bytes;
shared field `/Kids` → secret in bytes; control → the scan sees the secret.

**Milestone 2 — correctness P1s, docs batch, architecture steps 0–3 (rows 3–9).**

## SEC-1 inventory — the certification matrix (panel round 6, 2026-10-08)

Round 6 replaced the open-ended hunt with two inventories: Table A, every place pdf.js 6.3.289 resolves a resource
name or picks a resources dictionary (32 rows), and Table B, every PDF 32000-2 key that leads to resources or to
something drawn (68 rows). The full tables are in `var/claude/raw/m1r6-table{A,B}.md` (gitignored); the rows that had
no matching code path, and what now matches them:

| Row | pdf.js / spec site | Code path | Test |
|---|---|---|---|
| A1 | page `/Resources` merged with every ancestor's | `reachableFromPages` walks the `/Parent` chain | inventory `ancestorResources` |
| A6/A7 | XObject `/OC` given as a name → caller's `/Properties` | `collect` `Do` | inventory `/OC is a name` ×2 |
| A17 | tiling pattern overlay, separate `seen` | `collect` `scn` (`inner`) | inventory `pattern and by the page` ×2 orders |
| A26 | regenerated widget appearance: `/DA` font in `/DR` + AP `/Resources` | `noteAppearances` / `appearance` | inventory `widget's appearance` ×3 |
| B3 | array `/Contents` member also a form / a single `/Contents` | pre-registration before any copy | inventory `array member AND …` ×4 |
| B23/31/33/62 | `/Alternates`, `/Thumb`, `/PieceInfo`, `/DPart` | `dropsUndrawn` (`UNDRAWN`) | inventory 4 shapes ×2 + unshared kept |
| B36/40 | structure tree via `/SD` or a `/Dest` element | `isStructure` / `structureTree` cut when a page is left out; `/SD` deleted | inventory `structDest*` ×2 ×2 + link keeps `/D` + every-page-kept ×2 |
| B44/45 | field-tree node without `/FT` holding `/V` | `fieldTreeRefs` in `foreignField` | inventory `ftlessFieldNode` ×2 |
| B65 | non-standard resources category (spec-invalid) | `pruned` drops it when it touches | inventory `unknownCategory` ×2 |
| B14 | widget `/MK` icon | kept with the widget — disclosed | — |

Every other row of both tables was already matched (round 1–5 code and tests; see `.claude/rules/redaction.md`).

## Status
<!-- progress-block v1 -->
| # | Step | Size | State | Evidence | Files |
|---|------|------|-------|----------|-------|
| 1 | Qualify the three SECURITY.md rows SEC-1 refutes (Redaction, Delete page, Extract page range) with an open-issue note and a working workaround (KNOWN_ISSUES holds no open defects by its own definition, so no entry there); record the review rulings and the architecture plan | S | done | ea1f0c3 | SECURITY.md, docs/plans/** |
| 2 | SEC-1 fix: red fixtures first (GoTo /Dest, shared field /Kids) at the copySourcePages seam and through the real export for redaction, delete page and extract range; then cut references to excluded pages (answered in the copier, so nothing is copied and no sweep is needed), byte no-op on clean documents; sabotage; restore the SECURITY.md rows | M | doing | - | src/export/copySourcePages.ts, src/export/exportService.ts, tests/** |
| 3 | TEST-1: replace the raw NUL byte in src/core/undoRedoController.ts:45 with the escape, and forbid raw control bytes in src/ with a source-level test | S | todo | - | src/core/undoRedoController.ts, tests/tools/** |
| 4 | TEST-2: setFormXObjectContent (contentStreamEditor.ts ~1069) swallows every error and its 3 callers report a successful true-edit — surface the failure so the caller falls back honestly | S | todo | - | src/utils/contentStreamEditor.ts, tests/** |
| 5 | TEST-3: the bare catch at exportService.ts ~832 ("no form fields") also hides form.flatten() failures — narrow it so Flatten & download never ships live fields silently | S | todo | - | src/export/exportService.ts, tests/** |
| 6 | QUAL-1: release pdf.js documents (loadingTask.destroy) on close/open, after the undo history is cleared; leave undoable page delete to the commands' dispose() | M | todo | - | src/core/**, src/ui/documentLoader.ts, tests/** |
| 7 | Docs and config drift in one docs-only pass (rulings 2026-10-08: batch-of-10 push, one panel per milestone, author casing MESSAOUDI, re-sign only after cloud sessions; SYNC-1 the three reviewer agents and pdf-qa-sweep say advisor() does not exist here while CLAUDE.md makes it rung 1; SYNC-3 CLAUDE.md names /converge as the panel runner where /certify runs it, and the repo agents have no Write tool for the raw-file contract; SYNC-6 the agents pin model: opus and pdf-qa-sweep asks for a model in autonomous mode, against model policy v2; README/FEATURES/VISION form fill + recent files; CHANGELOG; archive master.plan.md; rules-file caps; undici pin; stale memory notes; container-era wording; settings .bak leftovers) | M | todo | - | CLAUDE.md, .claude/**, README.md, FEATURES.md, VISION.md, CHANGELOG.md, docs/** |
| 8 | Architecture steps 0–3 (see docs/plans/architecture.plan.md) | L | todo | - | src/**, tests/tools/** |
| 9 | Remaining P2 findings as plan rows; P3 findings fixed when their file is touched (list in § Known issues) | M | todo | - | - |
| 10 | SEC-1 cost follow-up (ruled 2026-10-08): replace the prune's full content tokenizing with a name-only scan; measure against the § Fragile figures, own gate and panel | M | todo | - | src/export/copySourcePages.ts, src/utils/contentStreamEditor.ts, tests/** |
<!-- /progress-block -->
### Blocked
### Needs input
- M1 (SEC-1): round 6 (the inventory round, ruled 2026-10-08) is DONE — 15 unmatched rows found, 14 fixed test-first ("SEC-1 round 6" commit), 1 disclosed (`/MK` icon); no reviewer has read the round-6 code, so MAXIMAL's clean-round counter stands at zero. Awaiting the developer's re-ruling on certification (a narrow verification round is recommended) and on the cost (idle machine not available; load-16 profile in § Fragile). Push held until certified; every commit since d44b3a6 is unpushed.
### Needs research
### Fragile
- SEC-1 cost, round 6 (2026-10-08, load ~16, warm, five alternating runs, `copySourcePages` alone): Publication 17
  delete-last median 2559 ms vs 176 ms; census 1393 vs 81; GPT-3 367 vs 126. Profile (one instrumented run,
  Publication 17): `pruned` 80%, `collect` 67%, `tokenizeContentStream` 52%, the copier hook 18%, `dropsUndrawn`
  (transitive `touches`) 5%. An idle machine was not available; single runs swung 0.8–8.6 s. The lever, if one is
  wanted, is a name-only scan instead of the full tokenizer.
- SEC-1 cost (M1-C3, partly fixed): one `@cantoo/pdf-lib` import per copy and a synchronous `/Annots` walk remain;
  when a page is left out, the prune also walks everything the left-out pages reach once and tokenizes the content
  of every owner that shares resources with them. Measured by the round-3 panel at load ~19 on the 916547c..4b175bc
  code: Publication 17 (142 pages), last page deleted, 3706 ms pruned vs 150 ms unpruned; one page downloaded 84 vs
  13 ms; the GPT-3 paper 360 vs 46 ms. Re-measured on the round-4 code at load ~25 (corpus probe, one file per
  process): Publication 17 delete-last 6510 vs 1278 ms, the census report 1291 vs 292 ms, GPT-3 476 vs 1209 ms; on all
  15 corpus files the pruned and unpruned outputs are the same size and every compared kept page's pdf.js operator
  list is identical (the corpus shares nothing with a deleted last page or with the pages a single-page download
  leaves out, so this proves the prune neutral there, not the collector right on real sharing). Those round-4 timings
  were an order artefact (the unpruned copy ran first, cold — R5-K-1). Round 5, warmed up, alternating, three runs,
  load ~24: Publication 17 delete-last median 11061 ms (3281–13838) vs 127 ms; GPT-3 904 vs 108; census 902 vs 111;
  BERT 374 vs 43. Every kept page's content is tokenized whenever its resources share anything (a font) with the
  removed page, and `touches` is transitive since round 5. Bounded; not optimised; idle-machine cost unmeasured.
- `secretsIn` in `tests/export/copySourcePages.test.ts` scans raw streams only (M1-S5): a string leak (`/V`,
  `/Contents`) is invisible to it, which is why every string-shaped case uses `fileHas`. Keep it that way.
### Known issues
The review's findings, so this plan stands without the gitignored lens reports
(`var/claude/review-20261007/`, five files). An arrow names the row that absorbs a finding; the rest are open.
Per the 2026-10-08 ruling a P2 becomes a plan row when it is taken up, and a P3 is fixed when its file is touched.
Each line is the finding's own heading; its evidence (file:line, measurements) stayed in the lens report.
DOC-4 was triaged from P2 to P3 (SendUserFile does exist in local sessions; only its "container is reclaimed"
rationale is stale).

**P1 (13)**
- ARCH-1 — Coordinate frames are untyped; frame meaning lives in comments → row 8 (steps 2–3)
- ARCH-2 — `PDFTurboApp` is composition root, application facade and UI controller in one class, and it lives in `core/`
- ARCH-3 — Binders depend on the concrete `PDFTurboApp` and reach its `_`-private members
- ARCH-4 — Redaction, the product's sharpest invariant, has no bounded context; its policy is spread over 5+ files in 3 directories
- QUAL-1 — Live pdf.js documents (and their workers) are never destroyed when a document is closed, replaced or garbage-collected from the model → row 6
- SYNC-1 — The reviewers are told `advisor()` does not exist; CLAUDE.md says it is the first rung → row 7
- SYNC-2 — Milestone certification: repo MAXIMAL (two clean rounds) vs the newer one-panel ruling → ruled
- SYNC-3 — "`/converge` runs the panel" is dangling since `/converge` became advisor-certified → row 7
- SYNC-4 — Rule 10 push cadence: the repo override (2026-07-27) predates the batch ruling (2026-10-04) → ruled
- TEST-1 — A raw NUL byte makes `src/core/undoRedoController.ts` a BINARY file to git: every diff of the undo/redo coalescing code is invisible to reviewers → row 3
- TEST-2 — `setFormXObjectContent` swallows every error, and its callers then report a successful true-edit → row 4
- TEST-3 — `exportService.ts:832` bare catch labelled "no form fields" also swallows `form.flatten()` failures on real forms → row 5
- TEST-4 — No golden/characterization test pins export output at defaults; the ~15 "byte-identical when unset" claims are guarded by predicates, not bytes

**P2 (39)**
- ARCH-5 — Domain entities are DOM views; element classes import i18n and build HTML
- ARCH-6 — The domain aggregate depends on pdf.js and on the export context
- ARCH-7 — One aggregate, four holders, and a split repository
- ARCH-8 — `ExportService` is one class serving six contexts and doing its own I/O
- ARCH-9 — `contentStreamEditor.ts` (3023 lines) is four layers in one file, and its importers already show the cut lines
- ARCH-10 — `flowDoc.ts` (2580 lines) hosts shared text-script primitives and a redaction rule, so 7 non-flow modules depend on the flow context
- ARCH-11 — CQS breach. An export (a query) mutates the aggregate outside history, using DOM focus as the decision input
- ARCH-12 — pdf.js and pdf-lib have no ports; library calls are spread over 25 and 14 files
- ARCH-13 — A 32-file type-only cycle pivots on `AppDOMRefs` and the app types
- ARCH-14 — `IAppContext` is a 26-member port handed to every pointer handler; the narrow ports elsewhere prove the alternative
- ARCH-19 — No architecture fitness function, though the repo already has the pattern → row 8 (step 0)
- ARCH-21 — The true-edit use case is orchestrated inside a pointer handler
- DOC-1 — Git identity: "matches 100% of history" is false → row 7
- DOC-2 — "Recent SHAs are NOT stable / re-sign + force-push" looks container-era → row 7
- DOC-3 — Form fill, VISION and README understate shipped features → row 7
- DOC-5 — CHANGELOG stopped at 2026-09-24 → row 7
- DOC-6 — `master.plan.md` is fully closed but still in `docs/plans/` and claims to be "the only live plan" → row 7
- DOC-7 — New Gotcha entries went into CLAUDE.md, against its own intake rule → row 7
- DOC-8 — Five stale memory notes contradict the repo → row 7
- DOC-9 — Container-era rationale still drives live policy and comments → row 7
- QUAL-2 — `pdfSanitizer` reads untrusted structure with the throwing `lookupMaybe(key, Type)`, unguarded
- QUAL-6 — `PDFElement.type` is not a discriminant, so the code downcasts 70 times
- QUAL-7 — `MoveResizeCmd` mutates an element through an untyped bag, and is used for everything
- QUAL-12 — 43 functions exceed 100 lines, 25 exceed 150
- QUAL-15 — The blank page is a string sentinel with its A4 default re-typed 21 times
- QUAL-16 — Two matrix types and two composition functions — one of them has already composed backwards once → row 8 (step 2)
- QUAL-17 — The formatting service repeats "mutate → record → rebuild → autosave" 31 times
- QUAL-21 — The `_underscore` private convention is really three conventions, and the app's "private" members are a public API
- SEC-2 — Generated `.p12` uses legacy 3DES at forge's default 2048 iterations, and its passphrase has no minimum length
- SYNC-5 — Mode plumbing: the tree is autonomous only through a global rule; memory names dead sentinels → row 7
- SYNC-6 — Model policy v2 drift in the repo skill and agents → row 7
- TEST-5 — The `brace-expansion: ^5.0.12` override forces a major outside its dependent's range and breaks `minimatch@5.1.9`
- TEST-6 — Gitignored `tests//zz*` probes run in the LOCAL suite and the pre-push hook but never in CI; one runs unconditionally and writes outside its sandbox
- TEST-7 — 6 of 13 `loadPdfDocument` sites take the metadata re-stamp; the site pin checks `viewerCheck` only
- TEST-8 — Locale key identity is enforced only by a Claude PostToolUse hook, not by any test
- TEST-9 — Nine 120 s per-test timeouts in `redaction-vertical.browser.test.ts` with no measurement
- TEST-10 — The export context is hand-stubbed in ~23 files; test-helper duplication is the visible cost of fat ports
- TEST-11 — Testability payoff of hexagonal, quantified: about two thirds of `src` cannot be unit-tested without a DOM, pdf.js or pdf-lib
- TEST-12 — Real-producer fixtures reach only 18 of 383 test files; the 15-file corpus that most rules measurements cite never runs in CI

**P3 (49)**
- ARCH-15 — Export reaches UI and core through re-exports instead of `contracts/`
- ARCH-16 — Ubiquitous language drift
- ARCH-17 — Commands are after-the-fact undo records, not intents
- ARCH-18 — Cross-context leaks outside the main tangle
- ARCH-20 — `docx/` is the best-isolated context, but `docModel.ts` mixes the OOXML adapter with the domain model
- DOC-4 — `SendUserFile` is a container-era tool still prescribed in 5 places → row 7
- DOC-10 — Rules-file caps: 7 over, not 6, and the index list is incomplete → row 7
- DOC-11 — The limits plan's "Needs input" carries an answered item → row 7
- DOC-12 — Repo `settings.json` overlaps the global permission engine → row 7
- DOC-13 — Repo hooks do not follow Rule 13 observability → row 7
- DOC-14 — The expertise index omits two declared overrides → row 7
- DOC-15 — SECURITY "Supported Versions" vs package version → row 7
- QUAL-3 — The `IErrorReporter` contract gives argument 2 two different meanings
- QUAL-4 — A cancelled crop-handle gesture commits the crop
- QUAL-5 — The loadingTask teardown idiom is hand-copied 6× while a helper exists but is module-private
- QUAL-8 — `any` is concentrated at the pdf-lib boundary, and its lint rule is a warning
- QUAL-9 — Two `as unknown as` casts are lies rather than boundary assertions
- QUAL-10 — 287 `getElementById(…) as HTML*` casts erase `| null`
- QUAL-11 — tsconfig verdicts
- QUAL-13 — Three dispatchers are long if/switch chains that want a table
- QUAL-14 — Long parameter lists and boolean flags
- QUAL-18 — Colour conversion exists in 4–5 versions with different rules
- QUAL-19 — Rotation normalisation is inlined 7× with no helper
- QUAL-20 — Three idioms for reading pdf-lib objects
- QUAL-22 — `PDFElement` mixes the domain record with DOM construction
- QUAL-23 — `shapeType` is switched on in two places
- QUAL-24 — `PDFRenderer` keeps a second, legacy document pointer
- QUAL-25 — Two locals shadow browser globals
- QUAL-26 — Over-export and test-only surface; real dead code is tiny
- QUAL-27 — Magic numbers
- QUAL-28 — 11 permanent kill switches, asymmetric gating, no sunset
- QUAL-29 — Full element-layer rebuild for single-element property changes, with a forced layout per element
- QUAL-30 — Three quadratic loops in export/reconstruction
- SEC-3 — The signer finds its `/Contents` slot and `/ByteRange` token by FIRST occurrence in the whole file
- SEC-4 — Stale safety-path comment contradicts the fixed ByteRange semantics
- SEC-5 — Pasted remote images are kept, and only the meta CSP stops the request
- SEC-6 — Meta-CSP limits, and the four legal pages have no CSP
- SEC-7 — `new Blob([bytes.buffer])` ignores `byteOffset`/`byteLength` at five sites (latent over-disclosure)
- SEC-8 — "Edit text → delete" leaves the deleted string in the stored source bytes
- SEC-9 — DOCX unzip has no decompressed-size cap (zip-bomb DoS, local tab only)
- SEC-10 — The `undici` override is missing from CLAUDE.md's supply-chain register
- SEC-11 — (informational) — A plain PDF export carries source page `/AA` and annotation scripts unchanged
- SYNC-7 — The pdf-lenses sentence "Project scope only" blocks exactly this kind of audit
- SYNC-8 — Rule 5 duplication of global text in repo skills and agents
- SYNC-9 — The global force-push deny suggests `--force-with-lease`, which this repo forbids
- SYNC-10 — Plan-template and lifecycle drift
- TEST-13 — Direct model mutations outside commands: `setWatermark`, `setBates`, `CleanupService`
- TEST-14 — CI hygiene: no job timeout; `cancel-in-progress: true` on the Pages concurrency group; audit not in pre-push
- TEST-15 — Untested UI wiring and manual-only sabotage
