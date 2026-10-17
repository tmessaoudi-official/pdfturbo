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
- [2026-10-08 10:30] AGREED: M1 after round 7: bound the hunt - fix the spec-valid leaks and regressions by class (shape-based structure/field cut when a page is left out, direct entries of a shared dictionary are the removed page's, fail-closed decoding, tolerant /Resources, removed-page notes known before Flatten, field-parent /V), fix the rendering edges, disclose leaks that need a broken file and other display-state carriers as one named class, then ONE focused review round on the fixes and the two classes, then certify (developer, 2026-10-08).
- [2026-10-08 10:59] ASSUMED (review): M1 round 7 fix: the structure cut is membership OR shape (typed, or an /S name whose /P chain reaches the tree or a typed node), the field cut looks down /Kids too - because a cut gated on what its walk found fails open (R7-S-1/2/4). Alternative: patch each walk.
- [2026-10-08 10:59] ASSUMED (review): M1 round 7 fix: a direct value inside an object a removed page reaches (by reference) is that page's - undrawn direct resource entries, unknown categories and direct UNDRAWN keys are dropped, and a reached /Resources counts as shared - because a direct value has no reference for touches() to test (R7-S-10). Alternative: drop only undrawn entries that reference something.
- [2026-10-08 10:59] ASSUMED (review): M1 round 7 fix: an annotation whose /P is a page left out is cut unless a kept page lists it, and _assemblePdfDoc passes each page's /Annots as listed before any in-place flatten (annotsBefore) - because Flatten removes them from /Annots first (R7-S-8/12). Alternative: flatten only kept pages (would change what a redacted page's raster shows).
- [2026-10-08 10:59] ASSUMED (review): M1 round 7 fix: /V and /DV on a kept-chain field that no kept widget inherits are dropped from the copy; /Metadata, /AF and /PtData join UNDRAWN (R7-S-3/5).
- [2026-10-08 10:59] ASSUMED (review): M1 round 7 fix: a /Predictor content stream is unreadable (refuse where it must be read) rather than decoded here - because pdf-lib ignores the predictor and the ruled behaviour is refuse-if-unreadable (R7-C-1). Alternative: implement PNG/TIFF predictors.
- [2026-10-08 10:59] ASSUMED (review): M1 round 7: S-7 (array member marked /Form), S-11 (display-state carriers) and C-7 (a deleted page's link loses its visible appearance) are disclosed, not fixed, under the bound-the-hunt ruling.
- [2026-10-08 10:59] ASSUMED (review): M1 round 8 is the three lenses, each scoped to the round-7 fixes and the two classes (fail-open cuts, direct values), not an open hunt - the ruled 'one focused round'. Alternative: one reviewer.
- [2026-10-08 12:05] AGREED: M1 after round 8: fix all 14 round-8 code defects test-first (regressions first) and the 8 doc items, then certify M1 as fixed with its residue disclosed - no further panel round, which waives MAXIMAL's two consecutive clean rounds for M1 - then the full deploy gate and the push; the allowlist redesign becomes a plan row (developer, 2026-10-08).
- [2026-10-08 12:36] ASSUMED (review): M1 round 8 fix: a /Resources or /DR that is not a dictionary but reaches what a removed page reaches refuses the export (page, form, field); a pruned category that is not a dictionary is dropped where it is the removed page's - the ruled 'refuse instead of leaking' (R8-S-9/10/11). Alternative: replace with an empty dictionary (faithful to pdf.js for a page, not for a form, which inherits).
- [2026-10-08 12:36] ASSUMED (review): M1 round 8 fix: the /Resources a removed page draws from that are written DIRECTLY (its own, or inherited from a /Pages node) count as reached, so their direct entries are the removed page's (R8-S-1). Alternative: copy every inherited direct dictionary onto each kept page before pruning.
- [2026-10-08 12:36] ASSUMED (review): M1 round 8 fix: the prune reads an owner's content only when an entry is the removed page's (lazy), so a reached dictionary with nothing to prune never refuses (R8-C-4); the isShared reach term is kept, not deleted, and its doc claim corrected (R8-K-3, advisor 3C). Alternative: delete the term.
- [2026-10-08 12:36] ASSUMED (review): M1 round 8 fix: every kept page is pruned before any page is copied (R8-C-2); a pattern drawn by a form with own resources or an appearance is read during the copy and stays disclosed. Alternative: a full dry-run before the copy (doubles the cost).
- [2026-10-08 12:36] ASSUMED (review): M1 round 8 fix: a structure element written inline is cut by overriding the copier's dictionary path (cut marker, then rewritePageRefs as for a reference); kept annotations and the kept field chain are exempt from the structure cut; leftOutAnnot needs no /Subtype and counts a /P page outside the tree; /RV joins /V and /DV; every /Parent ancestor of a field or widget is a field-tree node; a kept chain field's inline /Kids are dropped unless their /P is a kept page (R8-C-3, R8-S-2..8). Alternative: per-shape patches.
- [2026-10-08 13:07] ASSUMED (review): M1 round 8 (6C): the every-object walk that finds a field node only a kid's /Parent names runs lazily, only for a copied dictionary carrying a field key (Tables 220/222) and no /Subtype that is no field otherwise - because it cost 350 ms and more per single-page copy on a 71 000-object file with no fields; the walk down /Fields stays eager and separate. Alternative: walk every object unconditionally.
- [2026-10-08 14:16] ASSUMED (review): TEST-1: the raw-control-byte guard covers tests/ as well as src/ - because two fixtures (urlScheme, contentStreamEditor) carried raw \x01-\x04 bytes, invisible in an editor; spelled as escapes. Alternative: src/ only, as the finding named.
- [2026-10-08 15:17] ASSUMED (review): TEST-2 scope: every one of the 7 form-write sites reports the write (the row said 3 callers; addDecorationAt, Path 2 and Path 3 call it too), and the handler's delete branch now warns toast.trueEditFailed on false (existing key, no locale change) instead of a bare return under a now-false unreachability proof — because a second source of false makes the silent no-op a dropped user action. Alternatives: overlay fallback for delete (rejected: hides text still in the file); leave the bare return (rejected: silent).
- [2026-10-08 15:17] ASSUMED (review): TEST-2: setPageContent left as it is (it does not swallow; a failure already propagates) and the Path-3 font left in the form's /Resources on a failed write is disclosed, not cleaned — because the advisor flagged widening as a different row and the residue is unused and harmless. Alternatives: make writeBack symmetric; roll the font back.
- [2026-10-08 15:41] ASSUMED (review): TEST-3: the catch is removed for BOTH paths — a plain download with typed values on a form pdf-lib cannot flatten now fails instead of shipping the values unbaked on live fields. Regression shape: a user with one malformed widget used to get a PDF (values in /V, stale appearance), now gets toast.pdfExportFailed and no file. Because both were silent loss and the review's class is 'never silently'. Alternatives: keep the catch on the default path; warn and continue with a new key.
- [2026-10-08 15:41] ASSUMED (review): TEST-3: the refusal reuses the generic toast.pdfExportFailed, although failureKey's own rule gives a deterministic refusal its own message (a retry cannot succeed) — because a new key costs three locale lines and the Arabic-pending count in two docs, and the ruling said same pattern as TEST-2. Alternative: a dedicated toast.formFlattenFailed through failureKey.
- [2026-10-08 15:51] ASSUMED (review): Push the 12 commits (TEST-1..TEST-3) now, behind the full deploy gate, without waiting for the M2 panel — because Rule 10's batch of 10 fires first, both rows passed advisor 6C with nothing open, and the M1 'hold until certified' ruling was made with a panel round mid-flight and open findings. Alternative: hold every push until the M2 three-lens panel is clean.
- [2026-10-08 16:10] ASSUMED (review): The push of TEST-1..TEST-3 waits for one clean full test:browser run: two runs at load 32 and 47 aborted on iframe-not-ready / module-fetch noise (no assertion failed). A load-gated rerun (load1 < 12) is detached; no QUAL-1 edit lands in the tree until the push is verified. Alternative: push on the other green steps and let CI's browser run decide.
- [2026-10-08 17:41] ASSUMED (review): QUAL-1 releases in resetDocumentModel() (all three loader paths) rather than a new documentLoader helper; the release runs before historyManager.clear() in closeDocument and the open path, which row 6 words as 'after' — no await separates them, so they run in one tick and the order cannot matter. Alternatives: a _resetDocument() wrapper that clears first.
- [2026-10-08 17:41] ASSUMED (review): QUAL-1 scope widened to the readers that can still hold a released document: PDFRenderer (stale = model set and no source holds the doc), PageRenderPipeline (superseded run; reset advances the epoch) and FindBarController.search (the model changed). Each drops the failure only then and rethrows otherwise, with a control test. Alternatives: release without guards (unhandled rejections on every close mid-render), or a blanket catch (a swallow).
- [2026-10-08 17:41] ASSUMED (review): QUAL-1 leaves single-getPage user actions (crop geometry, signature placement, true edit) unguarded and lets OCR/export in flight at a close fail through their own catches; disclosed in KNOWN_ISSUES. Alternatives: guard every reader (14 sites).
- [2026-10-08 17:41] ASSUMED (review): QUAL-1 defers releasing a source garbage-collected from a live model (DeletePageCmd's snapshot can still restore it; needs ownership counting) to row 9 as a P2; disclosed in KNOWN_ISSUES and ui.md. Alternatives: release on GC and break undo of a page delete.
- [2026-10-08 17:59] ASSUMED (review): M2 panel: export-fidelity-reviewer runs on opus - source override (as-is = the session model)
- [2026-10-08 17:59] ASSUMED (review): M2 panel: safety-promises-reviewer runs on opus - source override (as-is = the session model)
- [2026-10-08 17:59] ASSUMED (review): M2 panel: completeness-reviewer runs on opus - source override (as-is = the session model)
- [2026-10-08 18:28] ASSUMED (review): M2 panel round 1 — all 10 findings taken: P1 pipeline drop now keyed on the model the run read (not the epoch), plus the pre-existing renderer queue hang it exposed; P2 GC'd sources released at close via DocumentModel.heldDocuments (documents only, not bytes); P3s: decoration misses now warn (new key toast.trueEditDecorationSkipped, Arabic [Unverified]), KNOWN_ISSUES QUAL-1 corrected (PDF exports finish on a closed document; search graded Inferred), two-halves certification stated, TEST-3 reach and the combed-field shape documented, plan Files columns fixed. Alternatives: defer the P3s to row 7/9.
- [2026-10-08 18:28] ASSUMED (review): SEC-3 (Download page ignores typed form values, pre-existing, outside the M2 range) is disclosed in KNOWN_ISSUES and tracked for row 9 rather than fixed in M2. Alternatives: fix it now and widen M2's range (one more panel round on export code).
- [2026-10-08 18:28] ASSUMED (review): QUAL-1 end-to-end witness is a throwaway Playwright drive (var/claude/probe-t3/close-drive.mjs, gitignored): fixed tree 0 errors and 2 workers flat over 8 close-mid-work cycles; pre-QUAL-1 commit 0 errors and workers 3 to 10. Not committed as a test: it needs a dev server and takes ~2 min. Alternatives: a committed qa-sweep scenario for File > Close.
- [2026-10-08 18:55] ASSUMED (review): M2 panel round 2 — all findings taken except SEC-3's fix (still deferred): queued render settles its own caller (P1); export snapshot of elements and pages at start (safety P1, pre-existing redaction leak on a close mid-export — fixed, not deferred, because it ships a secret); one toast per commit with a second new key for the substituted case; AddPagesCmd redo restores the source and the same pages (reproduced; pre-existing undo-integrity bug fixed now rather than in row 9); SEC-3 widened to the page image and moved to SECURITY.md as an open issue; Arabic pending register 17; drive re-run on the frozen commit with its tree recorded. Alternatives: defer the pre-existing export leak and AddPagesCmd redo to row 9 and push M2 sooner.
- [2026-10-08 19:03] AGREED: GitHub Actions minutes are exhausted (developer, 2026-10-08): pushes to master carry [skip ci] in the pushed head commit so no run starts; the full deploy gate runs locally before every push; when minutes are back, one gh workflow run deploy.yml --ref master deploys everything. The live site stays on a0157d2 until then.
- [2026-10-17 00:43] AGREED: DOC-9: the repo settings.json deny list stays empty; CLAUDE.md restates the reason (the global firewall and permission engine carry the deny floor; a repo deny would duplicate it) instead of the dead no-terminal premise (developer, 2026-10-17).
- [2026-10-17 00:43] AGREED: SYNC-5: CLAUDE.md stops asserting this tree's mode; it defers to the global resolver as shown by the SessionStart banner and /next, which is true under either /gates-bypass setting (developer, 2026-10-17).
- [2026-10-17 00:43] AGREED: Row 7 runs as five themed docs-only commits (A certification sync, B git autonomy, C hygiene, D product docs, E memory outside the repo); per-gate certification is advisor() only, STANDARD carve-out (developer, 2026-10-17).
- [2026-10-17 00:54] ASSUMED (review): Push count: CLAUDE.md § Git autonomy defers to global Rule 10's batch count instead of hard-coding the ruling's 10 — basis: the 2026-10-08 ruling says 'adopt global Rule 10's batch' and the global count moved 10 -> 30 the same day; advisor() agreed (confident pick). Alternative: write 10 as a repo count.
- [2026-10-17 01:13] ASSUMED (review): Row 7 closed with four repo commits (120158a A, 3a7f7f6 B, c3fc1c7 C, 60901d0 D) plus memory-note edits outside the repo (E); left open on purpose: DOC-13 (P3, hooks untouched — fixed when touched), DOC-14 (global tool), DOC-15 (no release cut); the three settings .bak files were already absent. Evidence cell names the last commit.
- [2026-10-17 01:19] AGREED: Push: the 12 commits after row 7 (M2/QUAL-1 + row 7) stay local for the Rule 10 batch or the next milestone, instead of a push at this stop; the M2 fixes stay undeployed until then (developer, 2026-10-17).
- [2026-10-17 05:04] ASSUMED (review): Row 8 close: the commits pushed at the milestone end carry [skip ci] in the pushed head — basis: the 2026-10-08 19:03 AGREED ruling (Actions minutes exhausted) still applies; no CI run since 2026-10-08, the billing API is not readable with this token's scope, and the quota resets at the billing month start. Alternative: push without the tag (a run that fails on billing).
- [2026-10-17 05:05] ASSUMED (review): Row 8 milestone panel: export-fidelity-reviewer runs on opus - source: default (no model override, no reviewer-model file)
- [2026-10-17 05:05] ASSUMED (review): Row 8 milestone panel: safety-promises-reviewer runs on opus - source: default (no model override, no reviewer-model file)
- [2026-10-17 05:05] ASSUMED (review): Row 8 milestone panel: completeness-reviewer runs on opus - source: default (no model override, no reviewer-model file)
- [2026-10-17 09:46] ASSUMED (review): Row 9: open P2s (and P1s) that an architecture-plan step already names get an arrow to that step, not a duplicate row (ARCH-2/3/4/5/6/7/8/9/11/12/14, QUAL-21's app._ half, TEST-10); TEST-11 is informational, no row - basis: advisor() agreed at 3C. Alternative: a row per finding.
- [2026-10-17 09:46] ASSUMED (review): Row 9: TEST-4 (P1, unowned) promoted to row 12 although row 9 names P2s - an unowned P1 is the worse omission; ARCH-21 is a row (28), not an arrow to arch step 5, which narrows ports and does not name it - basis: advisor() agreed at 3C. Alternative: leave TEST-4 unowned; arrow ARCH-21 to step 5.
- [2026-10-17 09:47] ASSUMED (review): Row 9: SEC-2 (row 14) and TEST-12 (row 21) are marked ask-first and listed under Needs input - basis: the p12 cipher, the passphrase minimum and CI cost are the developer's (pdf-ask-human mandatory cases); advisor() agreed at 3C. Alternative: pick defaults.
- [2026-10-17 09:55] ASSUMED (review): M2 close reviewer: completeness-reviewer runs on opus - source: default (no model override, no reviewer-model file); STANDARD tier under the CLAUDE.md no-src/ carve-out (9ba51fa..HEAD touches docs/plans/** only)
- [2026-10-17 10:10] ASSUMED (review): M2 is not closed: its panel round 3 (a7cae67, 2026-10-08) left findings that were never recorded (raw files m2r3-safety 19:25 and m2r3-completeness 19:28, after the plan's last round entry at 18:55; the correctness lens never reported) - recorded as M2R3-1..4, rows 29-30, M2 closes after them and a clean round-4 panel. Basis: the row-9 close reviewer's K-1, verified at HEAD (exportService.ts _extractFlowDoc/exportXfdf walk the live page list; :714 reads elements live); advisor() agreed. Alternative: fix row 29 inside row 9.
- [2026-10-17 10:10] ASSUMED (review): Row 9 close-review fixes: the M2 Download-page finding is renamed SEC-3b (the lens report's SEC-3 is the signer finding; SECURITY.md follows); row 13 is not ask-first (it aligns Download page with the behaviour SECURITY.md already states as intended); the architecture-plan shim item is owned by arch step 12; KNOWN_ISSUES' snapshot grade names the two driven paths - basis: reviewer K-3..K-7, advisor() agreed. Alternative: leave the IDs shared.
- [2026-10-17 11:02] AGREED: Row 9 close review at its 5-round cap: fix R5-1 (the box-rotation undo graded not measured in SECURITY.md and redaction.md) and close on one advisor() call, no 6th reviewer round; then row 29 now (developer, 2026-10-17).
- [2026-10-17 11:34] ASSUMED (review): Row 29: the export freezes the page list, each page (crop copied) and each element (prototype kept) in ONE synchronous snapshot (_snapshotNow) at all six export entries, instead of only copying the arrays — it closes M2R3-1/2 and the in-place undo family (RotatePageCmd, SetPageCropCmd, MoveResizeCmd, RotateElementCmd, TransformAnnotationsCmd) together. Alternatives: pages+elements arrays only (leaves the in-place family open); a deep clone (needless — every command replaces nested values).
- [2026-10-17 11:34] ASSUMED (review): Row 29: the in-place undo hazard is closed BY CONSTRUCTION and pinned at the rasteriser boundary (jsdom: it receives the start-of-export rotation and geometry); whether the pre-fix timing ever misplaced a burn in pixels was not driven — graded Inferred from the await at exportPipeline.ts stripRedactedAnnotations sitting between the page-rotation read and the bake. Alternative: a browser pixel drive (costlier, measures a hazard the fix removes).
- [2026-10-17 11:34] ASSUMED (review): Row 29: the ink layer and the form values stay read live — neither decides what a redaction removes (the ink clip and the field filter use the snapshot's redactions). Row 30 (M2R3-3) lands before the M2 round-4 panel, per the plan's own order.
- [2026-10-17 11:51] ASSUMED (review): M2 round-4 reviewers run on opus - source: default (no reviewer-model file, no agent override); three-lens panel on frozen d8db555, one agent per lens (export-fidelity, safety-promises, completeness).
- [2026-10-17 15:42] AGREED: M2 round 4 (d8db555; 3 lenses, 5 findings: R4-1 P1 source PDFs not snapshotted, R4-2 P2 OCR reads live elements after render, R4-3..5 P3) — fix all 5 red-first, full gate, freeze, round 5 (developer answer)
- [2026-10-17 16:04] ASSUMED (review): M2 round-4 fixes: the OCR copy is local to ocrHandler (no new import, ratchet untouched); the table export for a page deleted during the dialog keeps toast.noTableFound (no new locale key, Arabic pending count unchanged) as a stated bound; R4-5 reuses toast.extractNoPages. Basis: advisor() at 3C agreed. Alternatives: a shared copier in shared-kernel (baseline edit), a new toast key.
- [2026-10-17 16:04] ASSUMED (review): M2 round-5 reviewers run on opus - source: reviewer-model default (autonomous-era pick carried; the developer chose round 5 in spec mode with this panel named in the option)
- [2026-10-17 16:34] AGREED: M2 round 5 (f2f2279) at the 5-round cap: correctness clean; safety+completeness R5-1 P2 (OCR searchable layer commits over a newer true-edit state) + R5-2..6 P3 docs — fix all 6 (R5-1 red-first, base-bytes check), full gate, close M2 on ONE advisor() call, no 6th round, then push (developer answer)
- [2026-10-17 16:48] ASSUMED (review): R5-1: a discarded edit (base no longer the source's bytes) is silent, joining the mid-parse supersession; callers' success toasts are gated on the result. Basis: the cap ruling says the commit refuses; no new locale key. Alternative: toast.trueEditFailed (wrong message for the OCR layer).
- [2026-10-17 16:48] AGREED: M2 closed: round 4 (d8db555) fixed in 7fa8fa4, round 5 (f2f2279, cap) fixed in 294f25d per the developer's ruling, closed on one advisor() call (code clean; bookkeeping in the close commit); row 29 done

## Formal Plan

Two milestones, each certified by ONE three-lens panel (`export-fidelity-reviewer`, `safety-promises-reviewer`,
`completeness-reviewer`) on a frozen commit, then pushed. A P0 fix is never held back by global Rule 10's push
batch: the milestone boundary is a push point.

**Milestone 1 — SEC-1 fixed (rows 1–2).**
SEC-1 (P0): an excluded page — redacted, deleted, or outside an extracted range — is serialised whole into the export
when a kept page references it (a link `/Dest` or `/A /GoTo`, a multi-page form field's `/Kids` → widget `/P`,
probably `/Popup` / `/IRT`). `copySourcePages` deep-copies everything a kept page reaches, `_assemblePdfDoc` filters
page indices only, and pdf-lib does not garbage-collect. Reaches Download, Extract range, single-page download,
Flatten (link vector) and `assemblePdfBytes` → signed, sanitized and compressed outputs. Measured 2026-10-07 with a
probe of `copySourcePages` (2-page source, page 2 excluded): no reference → clean; GoTo `/Dest` → secret in bytes;
shared field `/Kids` → secret in bytes; control → the scan sees the secret.

**Milestone 2 — correctness P1s, docs batch, architecture steps 0–3 (rows 3–9, 29–30) — CLOSED 2026-10-17.**

**M2 CLOSED 2026-10-17, on the developer's cap ruling.** Its panel reached round 3 on `a7cae67` (2026-10-08): the
safety and completeness lenses reported at 19:25 and 19:28 (`var/claude/raw/m2r3-*.md`), recorded below as M2R3-1..4,
and the correctness lens never reported; row 9's close reviewer found the raw files on 2026-10-17. Rows 29–30 fixed
them (67bef02, 55b6b6f, d8db555). Round 4 on frozen `d8db555` (all three lenses, opus): five findings, M2R4-1..5
(a P1 — the source PDFs were read live), fixed in `7fa8fa4`. Round 5 on frozen `f2f2279`: correctness clean; safety
and completeness six, M2R5-1..6 (a pre-existing P2 — an edit committed over a newer state), at the 5-round cap. The
developer ruled: fix all six, close on ONE `advisor()` call, no sixth round. Fixed in `294f25d` (gate green: jsdom
3823, browser 698, coverage, build, qa:sweep 151/114/0); `advisor()` found the code clean and the bookkeeping in this
commit. Not certified by execution: Word/DOCX for R4-1 (by construction through `_extractFlowDoc`), CSV/XLSX sources
(read in the snapshot's tick), the watermark/Bates drop on a close (disclosed in KNOWN_ISSUES, not fixed).

**Backlog — rows 10–28.** No milestone: each row is taken up on its own ruling, with its own gate. Rows 12–28
are the open findings no row or architecture step owns (row 9's reconciliation, 2026-10-17); a row marked *ask first*
needs a developer ruling before any code.

## SEC-1 inventory — the certification matrix (panel round 6, 2026-10-08)

Round 6 replaced the open-ended hunt with two inventories: Table A, every place pdf.js 6.3.289 resolves a resource
name or picks a resources dictionary (32 rows), and Table B, every PDF 32000-2 key that leads to resources or to
something drawn (68 rows). **Correction (round 7, R7-K-2):** `var/claude/raw/m1r6-table{A,B}.md` (gitignored) hold
only the unmatched rows and a one-line "clean/modelled" range; the matched rows were checked by the round-6 reviewers
and exist only in their transcripts — Table A rows 21, 25, 27 and 29–32 are accounted for nowhere on disk. The rows
that had no matching code path, and what now matches them:

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

The reviewers reported every other row as already matched (round 1–5 code and tests; see `.claude/rules/redaction.md`)
— a claim with no artefact behind it (R7-K-2).

Round 7 (full three-lens panel, 2026-10-08) found 17 code-shaped findings in two classes plus fail-open reading (the
"11 code defects" first stated here was a de-duplicated count no file records — R8-K-7); ruled "bound the hunt": 15
fixed by class, pinned in `tests/export/copySourcePagesRound7.test.ts`, 2 disclosed in `SECURITY.md`.

Round 8 (the focused round, 2026-10-08) found 14 code defects (three of them regressions of the round-7 fixes:
R8-S-9, R8-C-3, R8-C-4) and 8 doc items; ruled "fix round 8, then ship" — all 14 fixed by class test-first in
`tests/export/copySourcePagesRound8.test.ts`, each fix sabotaged, the doc items corrected, and M1 certified with its
residue disclosed (`SECURITY.md`, `KNOWN_ISSUES.md`), without another panel round. Notes N-1 (layer names travel in
`/OCProperties`), N-2 (the class-2 claim worded as the drop list) and N-3 (a radio value naming a removed state) are
in those two files. The residue's structural answer is row 11.

## Status
<!-- progress-block v1 -->
| # | Step | Size | State | Evidence | Files |
|---|------|------|-------|----------|-------|
| 1 | Qualify the three SECURITY.md rows SEC-1 refutes (Redaction, Delete page, Extract page range) with an open-issue note and a working workaround (KNOWN_ISSUES holds no open defects by its own definition, so no entry there); record the review rulings and the architecture plan | S | done | ea1f0c3 | SECURITY.md, docs/plans/** |
| 2 | SEC-1 fix: red fixtures first (GoTo /Dest, shared field /Kids) at the copySourcePages seam and through the real export for redaction, delete page and extract range; then cut references to excluded pages (answered in the copier, so nothing is copied and no sweep is needed), byte no-op on clean documents; sabotage; restore the SECURITY.md rows | M | done | bef8f5c | src/export/copySourcePages.ts, src/export/exportService.ts, src/utils/contentStreamEditor.ts, src/handlers/signingHandler.ts, src/utils/viewerCheck.ts, locales/*.json, tests/**, SECURITY.md, KNOWN_ISSUES.md, .claude/rules/**, CLAUDE.md |
| 3 | TEST-1: replace the raw NUL byte in src/core/undoRedoController.ts:45 with the escape, and forbid raw control bytes in src/ and tests/ with a source-level test (the two test fixtures were escaped in the follow-up 2aa02e3) | S | done | a291a08 | src/core/undoRedoController.ts, tests/tools/** |
| 4 | TEST-2: setFormXObjectContent (contentStreamEditor.ts ~1069) swallows every error and its 3 callers report a successful true-edit — surface the failure so the caller falls back honestly (7 write sites in all, plus the handler's delete branch; the decoration callers followed in M2 rounds 1–2, e40d41b and 4267f60) | S | done | b5d632f | src/utils/contentStreamEditor.ts, src/handlers/textEditHandler.ts, tests/**, .claude/rules/true-edit.md, .claude/rules/redaction.md |
| 5 | TEST-3: the bare catch at exportService.ts ~832 ("no form fields") also hides form.flatten() failures — narrow it so Flatten & download never ships live fields silently (nothing benign reaches it: the catch is removed, both paths fail closed) | S | done | e683073 | src/export/exportService.ts, tests/**, .claude/rules/export.md |
| 6 | QUAL-1: release pdf.js documents (loadingTask.destroy) on close/open — in resetDocumentModel, the same tick as the history clear — including sources garbage-collected by a page delete (released at close, not at the delete); guard the readers that can still hold a released document (M2 round-1 and round-2 follow-ups: e40d41b, 4267f60) | M | done | 712e2ee | src/core/**, src/infra/pdfRenderer.ts, src/ui/findBarController.ts, tests/** |
| 7 | Docs and config drift in one docs-only pass (rulings 2026-10-08: batch-of-10 push, one panel per milestone, author casing MESSAOUDI, re-sign only after cloud sessions; SYNC-1 the three reviewer agents and pdf-qa-sweep say advisor() does not exist here while CLAUDE.md makes it rung 1; SYNC-3 CLAUDE.md names /converge as the panel runner where /certify runs it, and the repo agents have no Write tool for the raw-file contract; SYNC-6 the agents pin model: opus and pdf-qa-sweep asks for a model in autonomous mode, against model policy v2; README/FEATURES/VISION form fill + recent files; CHANGELOG; archive master.plan.md; rules-file caps; undici pin; stale memory notes; container-era wording; settings .bak leftovers) | M | done | 60901d0 | CLAUDE.md, .claude/**, README.md, FEATURES.md, VISION.md, CHANGELOG.md, docs/** |
| 8 | Architecture steps 0–3 (see docs/plans/architecture.plan.md) | L | done | 9ba51fa | src/**, tests/tools/** |
| 9 | Remaining P2 findings as plan rows; P3 findings fixed when their file is touched (list in § Known issues) — every open P1/P2 now has an owner; the unowned ones are rows 12–28 | M | done | b02e41c | docs/plans/**, SECURITY.md, KNOWN_ISSUES.md, .claude/rules/redaction.md |
| 29 | M2R3-1 + M2R3-2 (M2 round 3, P1 regression of the round-2 snapshot fix): `_extractFlowDoc` (DOCX/MD/TXT) and `exportXfdf` walk the LIVE `documentModel.pages` against an element snapshot taken at the start, and `_extractPageTableData` (CSV/XLSX) reads the elements live — an undo mid-export (of a page delete, or of a redaction) exports covered text, a field value or a cell. Red test first from the round-3 probe recipe (delete a page holding a redaction, start the export, undo mid-export), take pages and elements together before the first await (`downloadPageRange` too: its page list is built before `pickSaveTarget`, its elements after), measure whether an in-place undo mid PDF export (a page rotation or crop, a box rotation) can misplace a burn and fix it if so, sabotage, then the M2 round-4 three-lens panel. Commits: 67bef02 (the snapshot — its browser suite red), 55b6b6f (the one-argument browser callers), d8db555 (docs); round 4 (M2R4-1..5 below) fixed in 7fa8fa4 (the Evidence); round 5 (M2R5-1..6 below) fixed in 294f25d | M | done | 7fa8fa4 | src/export/exportService.ts, src/handlers/ocrHandler.ts, tests/export/**, SECURITY.md, KNOWN_ISSUES.md, .claude/rules/redaction.md, .claude/rules/ocr.md |
| 30 | M2R3-3: `InsertBlankPageCmd` redo re-runs `addBlankPage` with a NEW page id, so a later redo naming the old id (rotate, crop, an annotation) does nothing — give it the `AddPagesCmd` fix (redo restores the same page). Docs (`.claude/rules/ui.md`): d8db555 | S | done | 67bef02 | src/core/commands/pageCmds.ts, tests/core/** |
| 10 | SEC-1 cost follow-up (ruled 2026-10-08): replace the prune's full content tokenizing with a name-only scan; measure against the § Fragile figures, own gate and panel | M | todo | - | src/export/copySourcePages.ts, src/utils/contentStreamEditor.ts, tests/** |
| 11 | SEC-1 allowlist redesign (ruled 2026-10-08 as the follow-up to M1's disclosed residue): when a page is left out, rebuild each kept page and what it draws from known keys only, so an unknown path is dropped instead of hunted; own plan and panel | L | todo | - | src/export/copySourcePages.ts, tests/** |
| 12 | TEST-4 (P1): golden characterization tests pinning export BYTES at defaults for the ~15 "byte-identical when unset" claims (today guarded by predicates only) | M | todo | - | tests/export/**, src/export/** |
| 13 | SEC-3b: "Download page" (`downloadPage`) and "Export page as image" (`downloadPageAsImage`) ship the source page as-is (typed form values not applied, never flattened) — route both through `_assemblePdfDoc` like Extract pages; then drop the SECURITY.md open-issue note. Not ask-first: it makes both carry the typed values as Download, Extract pages and Flatten already do, the behaviour SECURITY.md § "One file, two readers" states as intended | M | todo | - | src/export/exportService.ts, tests/**, SECURITY.md |
| 14 | SEC-2, *ask first*: the generated `.p12` uses 3DES at forge's 2048 iterations and takes any passphrase length — the cipher is a reader-compatibility choice and the minimum is UX, both the developer's | S | todo | - | src/signing/certGen.ts, tests/signing/**, locales/*.json |
| 15 | QUAL-2: `pdfSanitizer` reads untrusted structure with the throwing `lookupMaybe(key, Type)` (9 calls) — `lookup` + `instanceof`, a wrong-typed key test-first | S | todo | - | src/utils/pdfSanitizer.ts, tests/** |
| 16 | TEST-5: the `brace-expansion: ^5.0.12` override forces a major outside `minimatch@5.1.9`'s range — re-scope the pin and re-audit ONLINE (never `--offline`; `.claude/rules/audit-gate.md`) | S | todo | - | package.json, package-lock.json, .claude/rules/audit-gate.md |
| 17 | TEST-7: 6 of 13 `loadPdfDocument` sites take the metadata re-stamp (the default is `updateMetadata: true`; pdfSigner.ts:159, textEditHandler.ts:267, exportService.ts:824/1010/1071/1165) — pass `updateMetadata: false` at every site (the /pdf-lenses rule, re-loads included), a site that keeps the stamp only with its own evidence, and pin every site, not only `viewerCheck`. textEditHandler's doc is re-saved (:707/:736/:773), so today the stamp lands in the stored source after a true edit | S | todo | - | src/signing/pdfSigner.ts, src/handlers/textEditHandler.ts, src/export/exportService.ts, src/utils/pdfLoadGuard.ts, tests/** |
| 18 | TEST-8: a test asserting `locales/{en,fr,ar}.json` are key-identical (today only a Claude PostToolUse hook checks) | S | todo | - | tests/**, locales/*.json |
| 19 | TEST-6: keep the gitignored `tests/**/zz*` probes, but out of the default local suite and the pre-push hook (a vitest exclude, opt-in by name), and the one that writes outside its sandbox writes inside it — never a deletion | S | todo | - | vitest.config.ts, .githooks/pre-push |
| 20 | TEST-9: measure the nine 120 s per-test timeouts in `redaction-vertical.browser.test.ts` and set each from the measurement | S | todo | - | tests/browser/redaction-vertical.browser.test.ts |
| 21 | TEST-12, *ask first*: real-producer fixtures reach 18 of 383 test files and the 15-file corpus never runs in CI — which corpus files may enter CI, and at what CI cost, is the developer's | L | todo | - | tests/**, .github/workflows/deploy.yml |
| 22 | QUAL-1b: release a source garbage-collected from the model at the delete itself (released only at close today), with ownership counting across the model and the history | M | todo | - | src/core/**, tests/** |
| 23 | QUAL-6: `PDFElement.type` as a discriminant, so the 70 downcasts go | L | todo | - | src/elements/**, src/core/**, src/handlers/**, src/export/** |
| 24 | QUAL-7: `MoveResizeCmd` mutates an element through an untyped bag and is used for everything — typed commands per change | M | todo | - | src/core/commands/moveCmds.ts, src/core/**, tests/** |
| 25 | QUAL-15: the blank page is a string sentinel with its A4 default re-typed 21 times — one constant and one predicate | M | todo | - | src/**, tests/** |
| 26 | QUAL-17: `formattingService` repeats "mutate → record → rebuild → autosave" 31 times — one helper | M | todo | - | src/core/formattingService.ts, tests/** |
| 27 | QUAL-12: 43 functions over 100 lines, 25 over 150 — a function-length ratchet like the architecture ratchet (pinned counts, two-sided), not a rewrite | S | todo | - | tests/tools/** |
| 28 | ARCH-21: the true-edit use case is orchestrated inside a pointer handler — move it to a use-case module the handler calls | M | todo | - | src/handlers/textEditHandler.ts, src/core/** |
<!-- /progress-block -->
### Blocked
### Needs input
- Row 14 (SEC-2): which `.p12` cipher and iteration count (some readers still need 3DES), and whether to set a passphrase minimum — a ruling before any code.
- Row 21 (TEST-12): which corpus files may run in CI, and at what CI-minute cost — a ruling before any code.
- RESOLVED — M1 (SEC-1): nothing pending from the developer — rounds 7 and 8 ruled; after the round-8 fixes M1 is certified with its residue disclosed, then the full deploy gate and the push. Row 11 (allowlist redesign) is the follow-up the residue points to.
### Needs research
- AddPagesCmd redo (found 2026-10-08 reading for QUAL-1) — REPRODUCED by the M2 round-2 completeness reviewer and FIXED in M2 round 2: the redo restores the source and the same pages (`.claude/rules/ui.md` § "Undoing an Insert pages and redoing it added nothing").
### Fragile
- SEC-1 cost, round 8 (2026-10-08, load 20–23, warm, five alternating runs, the round-8 commit — output with its
  SHA in `var/claude/raw/m1r8-cost.jsonl`): Publication 17 delete-last median 2310 ms vs 279 (runs 1171–12315);
  census 1266 vs 446; GPT-3 300 vs 65. Indistinguishable from round 7 at this noise.
- SEC-1 cost, round 7 (2026-10-08, load 16–18, no probe output kept — R8-K-8, warm, five alternating runs): Publication 17 delete-last median 1576 ms
  vs 298; census 1135 vs 180; GPT-3 216 vs 45 — single runs up to 7.5 s. Not slower than round 6 at this noise.
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
(`var/claude/review-20261007/`, five files). An arrow names the plan row, or the step of
`docs/plans/architecture.plan.md` ("arch step N"), that absorbs a finding. Since row 9 (2026-10-17) every open P1 and
P2 has an arrow: the ones no row or step owned became rows 12–28; a P3 is still fixed when its file is touched
(2026-10-08 ruling).
Each line is the finding's own heading; its evidence (file:line, measurements) stayed in the lens report.
DOC-4 was triaged from P2 to P3 (SendUserFile does exist in local sessions; only its "container is reclaimed"
rationale is stale).

**P1 (13)**
- ARCH-1 — Coordinate frames are untyped; frame meaning lives in comments → row 8 (steps 2–3)
- ARCH-2 — `PDFTurboApp` is composition root, application facade and UI controller in one class, and it lives in `core/` → arch step 10
- ARCH-3 — Binders depend on the concrete `PDFTurboApp` and reach its `_`-private members → arch step 5
- ARCH-4 — Redaction, the product's sharpest invariant, has no bounded context; its policy is spread over 5+ files in 3 directories → arch step 4
- QUAL-1 — Live pdf.js documents (and their workers) are never destroyed when a document is closed, replaced or garbage-collected from the model → row 6
- SYNC-1 — The reviewers are told `advisor()` does not exist; CLAUDE.md says it is the first rung → row 7
- SYNC-2 — Milestone certification: repo MAXIMAL (two clean rounds) vs the newer one-panel ruling → ruled
- SYNC-3 — "`/converge` runs the panel" is dangling since `/converge` became advisor-certified → row 7
- SYNC-4 — Rule 10 push cadence: the repo override (2026-07-27) predates the batch ruling (2026-10-04) → ruled
- TEST-1 — A raw NUL byte makes `src/core/undoRedoController.ts` a BINARY file to git: every diff of the undo/redo coalescing code is invisible to reviewers → row 3
- TEST-2 — `setFormXObjectContent` swallows every error, and its callers then report a successful true-edit → row 4
- TEST-3 — `exportService.ts:832` bare catch labelled "no form fields" also swallows `form.flatten()` failures on real forms → row 5
- TEST-4 — No golden/characterization test pins export output at defaults; the ~15 "byte-identical when unset" claims are guarded by predicates, not bytes → row 12

**P2 (41)**
- ARCH-5 — Domain entities are DOM views; element classes import i18n and build HTML → arch step 11
- ARCH-6 — The domain aggregate depends on pdf.js and on the export context → arch steps 6 (the pdf.js dependency) and 9 (the aggregate's imports)
- ARCH-7 — One aggregate, four holders, and a split repository → arch step 9
- ARCH-8 — `ExportService` is one class serving six contexts and doing its own I/O → arch step 7
- ARCH-9 — `contentStreamEditor.ts` (3023 lines) is four layers in one file, and its importers already show the cut lines → arch step 8
- ARCH-10 — `flowDoc.ts` (2580 lines) hosts shared text-script primitives and a redaction rule, so 7 non-flow modules depend on the flow context → row 8 (step 2a: the primitives moved to `shared-kernel/text/`, `flowDoc` re-exports them; the redaction rule stays for architecture step 4)
- ARCH-11 — CQS breach. An export (a query) mutates the aggregate outside history, using DOM focus as the decision input → arch step 7
- ARCH-12 — pdf.js and pdf-lib have no ports; library calls are spread over 25 and 14 files → arch step 6
- ARCH-13 — A 32-file type-only cycle pivots on `AppDOMRefs` and the app types → row 8 (step 1: 35 → 7 files in type-inclusive cycles; the 7 left are the binders typed on `PDFTurboApp`, architecture step 5)
- ARCH-14 — `IAppContext` is a 26-member port handed to every pointer handler; the narrow ports elsewhere prove the alternative → arch step 5
- ARCH-19 — No architecture fitness function, though the repo already has the pattern → row 8 (step 0)
- ARCH-21 — The true-edit use case is orchestrated inside a pointer handler → row 28
- DOC-1 — Git identity: "matches 100% of history" is false → row 7
- DOC-2 — "Recent SHAs are NOT stable / re-sign + force-push" looks container-era → row 7
- DOC-3 — Form fill, VISION and README understate shipped features → row 7
- DOC-5 — CHANGELOG stopped at 2026-09-24 → row 7
- DOC-6 — `master.plan.md` is fully closed but still in `docs/plans/` and claims to be "the only live plan" → row 7
- DOC-7 — New Gotcha entries went into CLAUDE.md, against its own intake rule → row 7
- DOC-8 — Five stale memory notes contradict the repo → row 7
- DOC-9 — Container-era rationale still drives live policy and comments → row 7
- QUAL-2 — `pdfSanitizer` reads untrusted structure with the throwing `lookupMaybe(key, Type)`, unguarded → row 15
- QUAL-6 — `PDFElement.type` is not a discriminant, so the code downcasts 70 times → row 23
- QUAL-7 — `MoveResizeCmd` mutates an element through an untyped bag, and is used for everything → row 24
- QUAL-12 — 43 functions exceed 100 lines, 25 exceed 150 → row 27
- QUAL-15 — The blank page is a string sentinel with its A4 default re-typed 21 times → row 25
- QUAL-16 — Two matrix types and two composition functions — one of them has already composed backwards once → row 8 (step 2)
- QUAL-17 — The formatting service repeats "mutate → record → rebuild → autosave" 31 times → row 26
- QUAL-21 — The `_underscore` private convention is really three conventions, and the app's "private" members are a public API → arch step 5 (the `app._`-as-public-API half; the naming half is fixed when its file is touched)
- SEC-2 — Generated `.p12` uses legacy 3DES at forge's default 2048 iterations, and its passphrase has no minimum length → row 14
- SYNC-5 — Mode plumbing: the tree is autonomous only through a global rule; memory names dead sentinels → row 7
- SYNC-6 — Model policy v2 drift in the repo skill and agents → row 7
- TEST-5 — The `brace-expansion: ^5.0.12` override forces a major outside its dependent's range and breaks `minimatch@5.1.9` → row 16
- TEST-6 — Gitignored `tests//zz*` probes run in the LOCAL suite and the pre-push hook but never in CI; one runs unconditionally and writes outside its sandbox → row 19
- TEST-7 — 6 of 13 `loadPdfDocument` sites take the metadata re-stamp; the site pin checks `viewerCheck` only → row 17
- TEST-8 — Locale key identity is enforced only by a Claude PostToolUse hook, not by any test → row 18
- TEST-9 — Nine 120 s per-test timeouts in `redaction-vertical.browser.test.ts` with no measurement → row 20
- TEST-10 — The export context is hand-stubbed in ~23 files; test-helper duplication is the visible cost of fat ports → arch step 7
- TEST-11 — Testability payoff of hexagonal, quantified: about two thirds of `src` cannot be unit-tested without a DOM, pdf.js or pdf-lib → informational, no row (the measurement behind docs/plans/architecture.plan.md)
- TEST-12 — Real-producer fixtures reach only 18 of 383 test files; the 15-file corpus that most rules measurements cite never runs in CI → row 21
- QUAL-1b (found 2026-10-08 during QUAL-1; FIXED at close by M2 round 1; the delete-time release is row 22) — a source garbage-collected from a live model (its last page deleted) was never released, not even at close (the M2 panel refuted the first claim that a close released it). It is now released at close (`DocumentModel.heldDocuments`); releasing it at the delete itself still needs ownership counting across the model and the history → row 22
- SEC-3b (found 2026-10-08 by the M2 panel, pre-existing; called SEC-3 in the 2026-10-08 Decisions Log and until 2026-10-17 — renamed because the lens report's SEC-3, the signer finding, holds that ID) — "Download page" (`exportService.downloadPage`) AND "Export page as image" (`downloadPageAsImage`, round 2) copy the source page as-is: they never apply typed form values and never flatten, so a field changed or cleared on screen keeps its original value in the one-page file or the image (reviewer probes: `SECRET-ORIG-123` kept). Disclosed as an open issue in SECURITY.md (the page-image row and § "One file, two readers"), not in KNOWN_ISSUES (which holds no open defects). Fix = route both through `_assemblePdfDoc` like Extract pages → row 13

**P3 (51)**
- ARCH-15 — Export reaches UI and core through re-exports instead of `contracts/` → row 8 (step 1: export→ui 0; export→core is type-only, 0 runtime edges)
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
- TEST-16 (P3, found 2026-10-08 during TEST-1) — `src/export/xlsxWriter.ts:47-48` says a RegExp built from escape text keeps oxlint's no-control-regex quiet; measured false for a single escape-text literal (the string concatenation is what defeats the static read). Reword when the file is touched.
- QUAL-1c (P3, found 2026-10-08 during QUAL-1) — a thumbnail panel replaced by `reinitThumbnailPanel()` or dropped by `clearThumbnailPanel()` never disconnects its IntersectionObserver (`render()` disconnects only its own previous one); the observer keeps the detached thumbnail nodes alive. Observer leak, not a worker leak.

**M2 panel round 3 (on `a7cae67`, 2026-10-08; recorded 2026-10-17 from `var/claude/raw/m2r3-{safety,completeness}.md`)**
- M2R3-1 (P1, both lenses) — `_extractFlowDoc` and `exportXfdf` (and its `collectFormWidgets(documentModel.pages, …)`) walk the LIVE page list against an element snapshot taken at the start: delete a page holding a redaction (the delete removes its redactions), start a DOCX/MD/TXT or XFDF export, undo mid-export → the page is back, its redaction is not in the snapshot, and the covered text or field value is exported with a success toast. A regression of the round-2 fix (before it, both lists were live and consistent) → row 29, fixed 2026-10-17 (67bef02: one snapshot of pages and elements for every export)
- M2R3-2 (P2, safety) — `_extractPageTableData` reads `this._ctx.elements` live after its awaits: undoing a redaction mid CSV/XLSX export ships the covered cell (the screen loses the redaction too) → row 29, fixed 2026-10-17 (67bef02)
- M2R3-3 (P2, completeness, pre-existing) — `InsertBlankPageCmd` redo creates a new page id, so a later redo naming the old one no-ops → row 30, fixed 2026-10-17 (67bef02: the redo restores the same page)
- M2R3-4 (P3, both lenses) — `KNOWN_ISSUES.md` graded seven export paths `[Verified: exportSnapshot.test.ts]` while the test drives two → fixed 2026-10-17 (the grade now names the two)
- M2R4-1 (P1, correctness; P3 from safety) — the source PDFs were not in the snapshot: `ReplaceSourcePdfBytesCmd` writes `bytes`/`doc` on the live source, so a true-edit delete undone mid-export (with the redaction removed after the edit undone too) put the deleted text back in DOCX/MD/TXT, XFDF and a multi-source PDF → row 29, fixed 2026-10-17 (the snapshot carries `sources`; every export reads it)
- M2R4-2 (P2, safety + completeness) — the OCR burn read `app.elements` and the page rotation after `await render`: a redaction undone mid-OCR left the covered text to Copy text / Export to Word → row 29, fixed 2026-10-17 (`_recognize` copies both before its first await)
- M2R4-3 (P3, safety + completeness) — `SECURITY.md` marked the in-place "moves, turns or crops" undo `[pinned]` for every export while the tests drove rotation and boxes on three paths, no crop; and listed only ink and form values as live (sources too, R4-1) → fixed 2026-10-17 (the crop is driven in place; the grade names the driven paths)
- M2R4-4 (P3, completeness) — row 29/30 Evidence cited 67bef02 alone, whose browser suite was red; 55b6b6f and d8db555 were cited nowhere; row 29's Files named docs 67bef02 never touched → fixed 2026-10-17 (rows 29/30 name all three commits; Evidence moves to the round-4 fix commit)
- M2R4-5 (P3, correctness) — the range export's toast counted the selection, and with every selected page deleted during the dialog an empty PDF was saved → fixed 2026-10-17 (count of pages exported; nothing written when none); a table export for a page deleted during the dialog still says "no table found" — stated bound (modal picker)
- M2R5-1 (P2, safety, pre-existing) — `_applySourcePdfEdit` guarded only its own parse; the OCR searchable layer and a text edit build their bytes from `src.bytes` over their own awaits, so an undo or redo meanwhile was overwritten at commit (a redone true-edit delete came back) → row 29, fixed 2026-10-17 (a required `base`; the commit refuses when `src.bytes !== base`)
- M2R5-2 (P3, safety + completeness) — the docs' list of what an export reads live omitted the watermark, Bates, the export password and the file name; a close mid-export drops the watermark and Bates stamp from vector pages (measured) → fixed 2026-10-17 as docs (SECURITY.md, the `_snapshotNow` docstring, redaction.md) + disclosed in KNOWN_ISSUES.md, not fixed in code (no undo command reaches them; a close only)
- M2R5-3 (P3, safety) — R4-1 graded XFDF `[pinned]` although no text edit changes what XFDF exports → fixed 2026-10-17 (the sentence says so; the guard stays)
- M2R5-4 (P3, completeness) — R4-1's `[pinned]` named Word (not driven) and "text" (no such export) → fixed 2026-10-17 (Markdown and the multi-source PDF pinned, Word by construction)
- M2R5-5 (P3, completeness) — CLAUDE.md's index still counted `ocr.md` (1) → fixed 2026-10-17 ((2); `true-edit.md` (6) with the R5-1 entry)
- M2R5-6 (P3, completeness) — row 29's Files cell omitted `KNOWN_ISSUES.md`, which 7fa8fa4 touched → fixed 2026-10-17
