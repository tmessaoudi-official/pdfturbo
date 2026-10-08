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

## Status
<!-- progress-block v1 -->
| # | Step | Size | State | Evidence | Files |
|---|------|------|-------|----------|-------|
| 1 | Qualify the three SECURITY.md rows SEC-1 refutes (Redaction, Delete page, Extract page range) with an open-issue note and a working workaround (KNOWN_ISSUES holds no open defects by its own definition, so no entry there); record the review rulings and the architecture plan | S | done | ea1f0c3 | SECURITY.md, docs/plans/** |
| 2 | SEC-1 fix: red fixtures first (GoTo /Dest, shared field /Kids) at the copySourcePages seam and through the real export for redaction, delete page and extract range; then cut references to excluded pages, sweep, byte no-op on clean documents; sabotage; restore the SECURITY.md rows | M | doing | - | src/export/copySourcePages.ts, src/export/exportService.ts, tests/** |
| 3 | TEST-1: replace the raw NUL byte in src/core/undoRedoController.ts:45 with the escape, and forbid raw control bytes in src/ with a source-level test | S | todo | - | src/core/undoRedoController.ts, tests/tools/** |
| 4 | TEST-2: setFormXObjectContent (contentStreamEditor.ts ~1069) swallows every error and its 3 callers report a successful true-edit — surface the failure so the caller falls back honestly | S | todo | - | src/utils/contentStreamEditor.ts, tests/** |
| 5 | TEST-3: the bare catch at exportService.ts ~832 ("no form fields") also hides form.flatten() failures — narrow it so Flatten & download never ships live fields silently | S | todo | - | src/export/exportService.ts, tests/** |
| 6 | QUAL-1: release pdf.js documents (loadingTask.destroy) on close/open, after the undo history is cleared; leave undoable page delete to the commands' dispose() | M | todo | - | src/core/**, src/ui/documentLoader.ts, tests/** |
| 7 | Docs and config drift in one docs-only pass (rulings 2026-10-08: batch-of-10 push, one panel per milestone, author casing MESSAOUDI, re-sign only after cloud sessions; SYNC-1 the three reviewer agents and pdf-qa-sweep say advisor() does not exist here while CLAUDE.md makes it rung 1; SYNC-3 CLAUDE.md names /converge as the panel runner where /certify runs it, and the repo agents have no Write tool for the raw-file contract; SYNC-6 the agents pin model: opus and pdf-qa-sweep asks for a model in autonomous mode, against model policy v2; README/FEATURES/VISION form fill + recent files; CHANGELOG; archive master.plan.md; rules-file caps; undici pin; stale memory notes; container-era wording; settings .bak leftovers) | M | todo | - | CLAUDE.md, .claude/**, README.md, FEATURES.md, VISION.md, CHANGELOG.md, docs/** |
| 8 | Architecture steps 0–3 (see docs/plans/architecture.plan.md) | L | todo | - | src/**, tests/tools/** |
| 9 | Remaining P2 findings as plan rows; P3 findings fixed when their file is touched (list in § Known issues) | M | todo | - | - |
<!-- /progress-block -->
### Blocked
### Needs input
### Needs research
### Fragile
- SEC-1 cost (M1-C3, partly fixed): one `@cantoo/pdf-lib` import per copy and a synchronous `/Annots` walk remain;
  when a page is left out, the prune also walks everything the left-out pages reach once and tokenizes the content
  of every owner that shares resources with them. Measured by the round-3 panel at load ~19 on the 916547c..4b175bc
  code: Publication 17 (142 pages), last page deleted, 3706 ms pruned vs 150 ms unpruned; one page downloaded 84 vs
  13 ms; the GPT-3 paper 360 vs 46 ms. Bounded, and nothing is read where nothing is shared; not optimised.
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
