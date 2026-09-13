# WS7 — certification record for `dfe34ae..HEAD`

**Status: NOT CERTIFIED.** Thirteen MAXIMAL panel rounds were run against this range and the
two-consecutive-clean counter never rose above **0 of 2**. No `WS7: 2/2 clean at <sha>` entry exists
in `docs/plans/master.plan.md`, deliberately: on this evidence it would be a false record.

This file is committed because the per-round reports live under `var/claude/ws7/`, which
`.gitignore` excludes — so they do not reach a clone, and for four of the thirteen rounds no report file
was ever written at all. A certification debt whose only record is machine-local is not a record.
[Created WS7 round 7, 2026-09-04, after the completeness lens found the plan citing a gitignored path.]

## Round history

| Round | Findings | Notes |
|---|---|---|
| 1 | 18 | Included a regression introduced by WS5's own P0 fix. |
| 2 | 17 | Most were round-1 fixes applied to ONE member of a class. |
| 3 | 23 | |
| 4 | 19 | |
| 5 | 11 | Stopped here originally; findings handed over rather than certified. |
| 6 | 18 | Cleared the three post-round-5 fixes with executed sabotage; found a P1 sanitizer leak plus two defects self-inflicted in round-6 prep. |
| 7 | 10 | Found the round-6 sanitizer fix had closed ONE shape of its class (and left three siblings), and a colour regression from WS4-F. |
| 8 | 19 | All THREE lenses independently found the same head-of-`/A` defect from round 7. |
| 9 | 22 | At `2a19552`, all three lenses (4 export, 8 safety, 10 completeness). Two P1s: pdf.js INHERITS `/AA` through `/Parent`, so a script on the `/Pages` root or an unlisted field parent ran after sanitize. Plus a regression from `3fc0863` (the paperclip's own scripts) and one from `2a19552` itself (a "corrected" opcGc count that was wrong). |
| 10 | 18 | At `d377ced`, after the dependency upgrade, all three lenses on Node 24 (1 export, 4 safety, 13 completeness). Two P1s: pdf-lib 2.11.0's strict PNG decode silently dropped user images from DOCX→PDF — which `d00cd26` and `d377ced` had recorded as a fixture problem — and an object pdf-lib cannot parse hid a live script from every sanitizer walk. |
| 11 | 12 | At `ac08b61`, all three lenses on Node 24 (2 export, 2 safety, 8 completeness). Sanitize & download never applied Lock PDF, and two defects were in round 10's own load guard: a per-reference rescan of the whole file, and an unanchored header match that refused a legal file. |
| 12 | 13 | At `d7eb108`, all three lenses on Node 24 (5 export, 1 safety, 7 completeness). Every code finding was in the load guard's text scan for object headers — a second tokenizer that disagreed with pdf-lib's six ways, five of them ACCEPTING a file pdf-lib had dropped from, three of those caused by round 11's own stream skip and boundary rule. |
| 13 | 6 | At `94dcc89`, all three lenses on Node 24 (2 export, 1 safety, 3 completeness). A P1 from the safety lens, pre-existing: pdf.js follows the cross-reference table and pdf-lib keeps the last copy in the file, so a crafted file showed one page and exported or signed another with nothing dropped. Both export findings were in round 12's own recorder. |

Nine of the thirteen rounds found defects in the **previous** round's fixes — rounds 6, 7, 8, 9, 10, 11, 12 and 13
by the surviving reports (which exist for rounds 4 and 6 to 13; none was written for 1, 2, 3 or 5), and
round 2 by the note in the table above, which was written from memory when this file was created. That
is the single most important fact in this file: in this range, a fix has been about as likely to
introduce a finding as to close one, which is why the bar was not lowered.

## Fixed in round 7 (reviewed by round 8, which found the head-of-`/A` sibling left behind)

- `pdfSanitizer.ts` — a JavaScript action survived sanitize when reached through `/Next`, listed in
  an array-valued `/A`, or attached to an `/Outlines` bookmark, with the report saying `false` (the
  UI called it clean). Round 6 had fixed only the indirect-`/S` shape of the same class. Chains are
  now SPLICED, so a `/URI` chained after a script still works.
- `opStreamWalker.ts` — WS4-F clipped the `colorMap` to a form's `/BBox` while the words come from
  unclipped `getTextContent`, so a run drawn past its form boundary exported BLACK instead of its
  real colour. Reverted for colour; the clip stays on rules/vRules, where it prevents invented
  geometry deleting prose.
- `xfdfMapping.ts` — the rotation docstring had become orphaned between two functions, making the
  round-6 withdrawal invisible on the function it describes.
- `SECURITY.md` / `README.md` / `FEATURES.md` / the sanitize tooltip — "embedded files stripped" was
  unqualified on four surfaces while `/FileAttachment` annotations survive.

## Still open

1. **Vertical-writing redaction** (`flowDoc.ts` `isItemRedacted`) — TWO-directional: a redaction over
   a vertical run may leak, and one above it may silently REMOVE the run. No vertical font exists in
   this repo to measure the advance's sign against. Disclosed in `SECURITY.md` and `KNOWN_ISSUES.md`.
2. **Text outside a Form XObject's `/BBox`** is invisible on screen and in every raster export, yet
   exports verbatim into DOCX/MD/TXT — `getTextContent` does not apply the clip. A flow-vs-raster
   divergence, undisclosed until now and untested.
3. ~~**`/FileAttachment` annotations survive `sanitizePdf`**~~ — CLOSED 2026-09-05 by developer
   ruling (annotation, Popup, `/FS` and — since `128219d` — `/AF` all go; since round 9 the Filespec
   itself loses its embedded stream); see `KNOWN_ISSUES.md` for the two fixture lessons.
4. **Rotated-page XFDF coordinates** (C20 / #57b) — no un-rotation exists in `xfdfMapping.ts`; the
   app's own round-trip is self-consistent, third-party interop on rotated pages is not.
5. Everything under `KNOWN_ISSUES.md` § "From the WS5 adversarial audit" — 10 deferred items.

## The standing recommendation

`src/docx/opcGc.ts` produced a "deletes a live user image" finding in **round 4 by the surviving reports**
(percent-encoded part names), in **round 9** (a `.RELS`-spelled relationships part, synthetic — no known
generator writes one) and one ~4s-per-save performance regression, and it buys a disclosed low-severity
nit (stray image bytes left in a `.docx`). Rounds 6 and 7 could not construct a delete-a-live-image case
against the current DOMParser implementation — `2a19552` said "rounds 4, 6 and 7" here and round 9
refuted it against the round-6/7 reports themselves — so it may well have converged — but it has the worst finding-per-line ratio
in the range, and reverting it while restoring the disclosure remains defensible. It was offered at
the round-3 fork and the rewrite was chosen instead.


## Round 8 — what was fixed, and what is still open (2026-09-04)

Round 8 returned **19 findings** across the three lenses. Five were code defects, all in
`pdfSanitizer.ts`, all introduced by round 7's own fix, and all are now closed:

| Defect | Evidence it was real |
|---|---|
| A cyclic action `/Next` looped **forever** — a frozen tab, reachable from the 🧹 button | `timeout 60` killed the run; the acyclic control returned in 11 ms |
| A script at the **head** of `/A` was deleted whole, destroying a `/URI` chained behind it | chained URI present before, absent after |
| An **array**-valued `/Next` dropped script entries instead of splicing their continuations | chained URI present before, absent after |
| `/S /Rendition` carrying `/JS` survived, with `report.javascript` saying `false` | payload present after sanitize |
| The round-7 `/Outlines` walk recursed over the **sibling** list | 8000 bookmarks fine, 10000 → `RangeError` |

The first three were one defect wearing three hats: round 7 spliced the middle of a chain and
truncated at every other position, in the commit whose own message says splicing is the point. The
fix replaces the boolean-returning mutator with `spliceActions`, which returns the actions that
SURVIVE — so head, middle, array element and cycle became the same operation and the distinction
that let this class reopen twice is no longer expressible. Sabotage-verified four ways, each landing
where predicted: dropping the cycle guard → 3; restoring the round-7 head deletion → 2 (and NOT the
"strips a script at the HEAD" case, which deletion also satisfies — that is why the splice half has
to be asserted separately); `/JavaScript`-only detection → exactly the Rendition case; outline
recursion → exactly the 10000-sibling case.

### Still open after round 8

**The scope decision was RULED on 2026-09-05** ("fix the security issues"): sanitize strips the whole
non-JavaScript egress class — `/SubmitForm`, `/Launch`, `/GoToR`, `/GoToE`, `/ImportData`, ruled as a
class rather than the two the panel named — and `/FileAttachment` annotations with their file. The
measured survival (`https://…/collect` present after sanitize) is now a red test. Like `a99ccea`, this
change is post-panel: certified by execution (15 cases, five sabotage mutations, the full deploy gate)
and NOT by the WS7 ladder, which stays paused at 0 of 2. **A single-lens (safety-promises) review of
`3fc0863` after the push returned five findings, one a P0** — `/AF` on the paperclip dict kept its
file whenever anything still referenced the dict, with the flag reporting success — plus a cross-page
Popup, a self-cyclic `/Next` array, and an overclaiming sentence. All fixed in `128219d` and pushed the
same night (five more cases, three more sabotage mutations); `128219d` and the docs-only `2a19552` are
post-panel like `a99ccea` and `3fc0863`, certified by execution only — until round 9 reviewed all of
them. The pattern this record exists to name: the fix for "reference deleted, payload serialised" had
that shape itself, one key over.

**Documentation and claim drift — 11 findings (the panel counted 13 across lenses; de-duplicated here), none of them a code defect**, carried here rather
than left in gitignored reports. Status as of 2026-09-05 (round 9 found this list still reading as
open after `2a19552` claimed to clear it):

1. ~~`src/utils/pdfSanitizer.ts` module header — no `/Outlines` entry, `/A` described as a single
   dict.~~ Fixed in `3fc0863`.
2. ~~`index.html:145` — the sanitize button's static `title` still said "& embedded files".~~
   Superseded: `3fc0863` made "embedded files" true again, and the round-9 fix re-worded the fallback
   title and the English and French tooltips to the full scope. The Arabic tooltip was left for the
   native review; that review was closed by developer ruling on 2026-09-13 and the Arabic tooltip was
   re-worded to the same scope the same day (session-authored; one of the 3 values pending, since round 10 added two more).
3. ~~`src/export/exportService.ts:351` — same claim on `sanitizeAndDownload`'s docstring.~~ Fixed in
   `2a19552`, widened again by the round-9 fix.
4. `docs/plans/master.plan.md:489` and `:266` — the Decisions Log rules that the `/BBox` clip covers
   the **colorMap** channel, which round 7 reverted. SUPERSEDED, not edited: the plan's
   `[2026-09-04 21:55]` entry declares them history and states the live two-channel rule. (An earlier
   version of this item also cited `:70`, and the plan entry cites `:52`; both of those lines are TRUE
   statements about `annotationDepth` suppression and the channels' safety directions, not the stale
   rule — only `:266` and `:489` are.)
5. ~~`src/export/opStreamWalker.ts:248` and `CLAUDE.md:572` — "all three clipped channels".~~ Fixed
   in `2a19552`.
6. ~~`CLAUDE.md:548` — "the 7 leak cases" never measured.~~ Fixed in `2a19552` (8 = 6 jsdom + 2
   browser, measured).
7. ~~`CLAUDE.md:971`, `KNOWN_ISSUES.md:129` — stale `exportPipeline.ts` citations.~~ Fixed in `2a19552`.
8. ~~`vitest.browser.config.ts:70-74` — 10 vs 14 browser files with hooks.~~ Fixed in `2a19552`.
9. ~~`tests/utils/pdfSanitizer.test.ts:330` — a `SECURITY.md` promise `git grep` cannot find.~~ Fixed
   in `2a19552`.
10. ~~`docs/plans/master.plan.md:104` vs this file — "three of the six" vs "seven".~~ Fixed in `2a19552`.
11. ~~This file's own round-6/7 counts~~ — reconciled 2026-09-05 in `2a19552`; round 9 then found that
    reconciliation had itself introduced two false sentences (the surviving-reports list and the
    opcGc round list), corrected above.

## Round 9 — what was fixed (2026-09-05)

Round 9 ran at `2a19552` with all three lenses in isolated worktrees and returned **22 findings**:
4 export, 8 safety, 10 completeness. Twelve were code-shaped and are fixed in `6f08fc7` (post-panel,
like the four commits it reviewed — certified by execution only until round 10); the ten documentation ones are folded into this file, `CLAUDE.md`, `KNOWN_ISSUES.md`
and the plan.

| Defect | Evidence it was real |
|---|---|
| **P1** a JavaScript `/AA` on the `/Pages` root survived and pdf.js still ran it on PageOpen — `collectActions` inherits `/AA` through `/Parent` | `page.getJSActions()` identical before and after; report all-false |
| **P1** a JavaScript `/AA` on a widget's parent field that `/Fields` never names survived; pdf.js hands it to the sandbox as the field's Keystroke action | `getFieldObjects()` carries `actions.Keystroke` after sanitize |
| **P1** a paperclip kept alive by a reply note's `/IRT` kept its OWN `/A` and `/AA` scripts (`3fc0863` pulled it out of `/Annots` before the strip loop) | script markers present after, `annotActions: false`; a no-`/IRT` control loses them |
| **P2** a paperclip whose Filespec is also a kept `/Rendition` media clip's `/D` kept its file, flag `true` | payload present after sanitize |
| **P2** a `/FileAttachment` reachable only through `/Fields → /Kids` kept its file, flag `false` | payload present after |
| **P2** XMP `/Metadata` on a form XObject survived while three docs said "XMP" unqualified | marker present after |
| **P2** `opcGc` never walked a `.RELS`-spelled relationships part, so the image only it referenced was DELETED (synthetic — no known generator writes one) | `removedParts: ['word/media/image1.png']` on a live image |
| **P3** `/AF` on an XObject, `/PieceInfo`, a 3D `/OnInstantiate` script — all survived, none claimed | markers present after |
| **P3** `report.associatedFiles` assigned before the field/outline walks that set it | outline `/AF` removed, flag `false` |
| **P3** a diamond through a shared script lost the `/URI` behind it on the second path | second entry's `/Next` undefined after |

The fix is structural rather than a fourth walk: **one pass over every dictionary in the file** for the
keys whose meaning is the same wherever they appear (`/AA`, `/AF`, `/Metadata`, `/PieceInfo`,
`/OnInstantiate`) plus the action splice on annotation-shaped dicts, and **the Filespec itself loses its
embedded stream** wherever it was reached from, so a shared reference cannot keep the bytes. Thirteen red
tests first (eleven sanitizer, two opcGc), twelve sabotage mutations after, figures in `CLAUDE.md` § PDF sanitizer. The two P1s were
graded P1 by the lens on the ladder's precedent (script survival with a clean report); by its own rubric
— a `[pinned]` promise broken with execution demonstrated — P0 was defensible, and this record does not
argue the grade down.

Two findings were against the PREVIOUS fix-up commits, which is the pattern this file tracks: the
paperclip-scripts regression came from `3fc0863`, and `2a19552`'s "corrected" opcGc round list was
itself wrong. Round 9 also confirmed, by execution: jsdom 2645 at `2a19552`, 8 leak cases (6 pure) from
dropping the `/BBox` intersection, 14 browser files with hooks, the sanitizer's 20 cases and 8
mutations, every citation `2a19552` fixed, the collector clean.

**The counter remained 0 of 2** after round 9.

## Round 10 — what was fixed (2026-09-13)

Round 10 ran at `d377ced` — the round-9 fixes plus the upgrade of every dependency to its latest
release — with all three lenses in isolated worktrees, every command on Node 24. It returned
**18 findings**: 1 export, 4 safety, 13 completeness. The code-shaped ones are fixed in the commits on
top of `d377ced` (post-panel, certified by execution only until round 11); the documentation ones are
folded into this file, `CLAUDE.md`, `SECURITY.md`, `KNOWN_ISSUES.md`, `CHANGELOG.md`,
`THIRD-PARTY-NOTICES.md` and the plan.

| Defect | Evidence it was real |
|---|---|
| **P1** pdf-lib 2.11.0 (fflate) rejects PNGs 2.8.1 embedded: DOCX→PDF dropped the image silently, opening one as a document failed | the 2×2 and 1×1 truncated literals throw `unexpected EOF`; Chrome's `decode()` draws 3 of the 4 |
| **P1** an object pdf-lib cannot parse is kept as an opaque `PDFInvalidObject`, invisible to every `instanceof PDFDict` walk — a Widget script inside it survived sanitize, report all-false | pdf.js `hasJSActions()` true on the sanitized output |
| **P2** Lock PDF wrote non-stream strings (`/URI`, `/Contents`) in plaintext while `/Encrypt` claimed them encrypted | tokens present in the raw bytes; pdf.js with the password read `""` |
| **P2** stale pdf.js line citations after 6.2.108 → 6.3.289; "fflate stays out of the entry bundle" false; THIRD-PARTY-NOTICES missing fflate and four transitive packages | each re-read at the cited site |
| **P3** "pdf.js runs none of" the kept media actions — `MediaAnnotationElement` plays a clip on click; `encryption.ts` said `/R 5` where 2.11.0 writes `/R 6`; nine broken PNG fixtures written as "ten truncated"; opaque fixtures commented "transparent"; bidi-js and Vitest version wording; the gate SUMMARY's 37/11 split and a 13089 ms figure in no retained log; a sabotage count of 3 that measures 4; CHANGELOG, FEATURES and this file not updated; three QA-sweep baselines | each measured or re-read |

**One more was found while preparing the fixes, by no lens:** pdf-lib 2.11.0 silently DROPS an
unparseable object with no `endobj` before EOF, where 2.8.1 threw — so a page whose content stream was
that object exported empty. Its default load-time `/Info` stamp takes the dropped object's number, which
made the drop invisible to a check after load. Fixed by one guarded loader for every pdf-lib load in
`src/` (`CLAUDE.md` § "The 2026-09-13 upgrade to latest").

Fixes, each with a failing test first and a sabotage run after (figures in `CLAUDE.md`):
`embedPngTolerant` plus a skipped-image count for DOCX→PDF; `loadPdfDocument`; the sanitizer REFUSES a
file holding a reachable unparseable object; password-protected exports save with object streams. The
kept-media rationale is corrected rather than silently re-justified, and the keep-ruling is flagged back
to the developer in the plan.

Two findings were against the PREVIOUS commits: `d00cd26`/`d377ced` described the PNG loss as correct
product behaviour, and `d377ced` recorded figures (the 37/11 split, 13089 ms) that no kept log supports.
The plan's `[2026-09-13 14:55]` RECORDED entry repeats both and is left as dated history; the corrected
figures live here and in `CLAUDE.md`. The same holds for `master.plan.md`'s dated round-8 entries citing
`pdf.worker.mjs:35814-35819` (6.2.108 line numbers).

**The counter remains 0 of 2.** Round 10 found defects, so the next clean round would be the first of
the two required. Round 11 is the next step.

## Round 11 — what was fixed (2026-09-13)

Round 11 ran at `ac08b61` over `dfe34ae..ac08b61`, focused on the round-10 commits (`9e03376`, `389b4d6`,
`ac08b61`), all three lenses in isolated worktrees on Node 24. It returned **12 findings**: 2 export,
2 safety, 8 completeness. The round-10 fixes it re-verified held — the sanitizer's refusal of an
unparseable object (non-vacuous against a pdf.js `hasJSActions()` control), Lock PDF on the four
downloads and compress (`/R 6 /V 5`), and 54 byte-identity combinations — but two findings are defects
in round 10's own load guard.

| Defect | Evidence it was real |
|---|---|
| **P2** Sanitize & download never applied the Lock PDF password: the copy opened with no password and its link, note, field and page strings were plaintext | probe: `sanitize:pw → encrypt:false`, opened under a wrong password and under none, while the compress sibling reported `encrypt:true` |
| **P2** the load guard re-scanned the whole file once per dangling reference | 20 MB: 18 ms → 229 ms at 50 references → 1267 ms at 300 |
| **P3** the header match was unanchored and read stream bodies, so a page SHOWING `9 0 obj` made a legal dangling `/Info 9 0 R` refuse the file, contradicting `KNOWN_ISSUES.md` | the round-10 `danglingInfo` fixture with `(9 0 obj)Tj` as its content threw `PdfObjectDroppedError` |
| **P3** `SECURITY.md` § "Lock PDF" presented its plaintext list as complete and omitted stream DICTIONARIES | a form XObject dictionary string and an embedded file's `/Params /ModDate` stayed plaintext with object streams on |
| **P2** `xlsxWriter.ts` still said fflate stays out of the initial bundle — round-10 F2 fixed one of its two sites | re-read at the site |
| **P3** `FEATURES.md`'s stamp stale again (round-10 F12 regressed by `ac08b61`); a 6.2.108 line citation unlabelled in `CLAUDE.md`; the plan's WS3 row and this file still said ONE Arabic value pending (3); `tests/blockers/README.md` counted 12 describes and 18 tests (14 and 25); two 2026-07-31 QA baselines disagreeing across `CLAUDE.md`, `deploy.yml` and `scripts/qa-sweep.mjs`; `THIRD-PARTY-NOTICES.md` listing no transitive dependency of docx, fontkit or the other libraries | each re-read, or counted off the runner |

Fixes, each with a failing test first, confirmed red for the stated reason, and a sabotage run after
(figures in `CLAUDE.md`): sanitize re-loads its output with `updateMetadata: false` and saves through
`_saveForExport`; the guard collects every header in one pass, at a token boundary and outside stream
bodies. The cost case compares the guard against pdf-lib's own load of the same bytes, best of three, so
machine load moves both sides. One sabotage landed on nothing the first tests could see — dropping the
token boundary stayed green, because the stream skip hid page text either way — and a case with the
text in a catalog string was added until it went red.

The two QA baselines are reconciled by saying what is known rather than picking one: both come from
`5170c27`, two runs of the same day and flag whose logs were not kept; each total also counts its
A11Y/ACCEPT lines, which is why pass + skip falls 2 short in both.

**Not certified by this round, named:** the safety lens's probe of an unparseable object INSIDE an object
stream was vacuous — its fixture used a classic xref, which cannot express a compressed entry, so
neither library ever associated the object with the stream. That vector is unexercised, not clean. No
browser suite or QA sweep ran inside the panel; the fix gate's runs are the evidence for those. That gate
(Node 24, the working tree over `ac08b61` that became `0ee442c` and the docs commit after it — all of
it except two later markdown edits: plan row 22 and this paragraph) was green at every step: audit, OCR assets,
type-check, lint, jsdom 2703 passed / 2 expected fail / 1 skipped, browser 89 files / 336 tests,
export branch coverage 44.07 %, build (precache 24), and the QA sweep with `--allow-destructive` at
151 checks / 114 pass / 0 fail. The logs are under the gitignored `var/claude/ws7/round11-fix-gate/`.

Still flagged to the developer, unchanged: `/PieceInfo` stripping (unruled) and the kept-media ruling,
whose premise round 10 corrected.

**The counter remains 0 of 2.** Round 12 is next.

## Round 12 — what was fixed (2026-09-13)

Round 12 ran at `d7eb108` over `dfe34ae..d7eb108`, focused on the round-11 commits (`0ee442c`, `d7eb108`),
all three lenses in isolated worktrees on Node 24. It returned **13 findings**: 5 export, 1 safety,
7 completeness — one of them found by all three lenses independently. The round-11 fixes it re-verified
held: Sanitize & download applies Lock PDF (executed by two lenses, one with a sabotage; with no password
the output is byte-identical to `sanitizePdf(assemblePdfBytes())`), and the guard's single pass. Every
code finding was in that guard.

| Defect | Evidence it was real |
|---|---|
| **P1** (export lens; P2/P3 in the others) a stream with no `endstream` ended the header scan for the rest of the file, so a later drop was ACCEPTED and exported empty | probe: raw pdf-lib dropped the object, the guard accepted, the export lost the page text or the annotation; the same file with `endstream` was refused |
| **P2** a real header glued to `endobj`, `>>`, `]` or `)` was missed — round 11's whitespace-only boundary | four probes, each accepted and exported empty; round 10's regex matched all four |
| **P2** `>> stream` inside a string started a fake stream skip that hid the dropped object's header — found by all three lenses; three doc sites said what remained "errs towards refusing" | the control refused, the same file with the string accepted |
| **P2** a member lost from an object stream has no header, so the scan could never see it, and no doc said so | members ordered 7, 9, 8 with 9 malformed: 8 missing from the export while pdf.js showed it |
| **P3** a string reading ` 9 0 obj ` still refused a legal file; a comment between header tokens was missed (pre-existing) | executed |
| **P3** docs and pins: this file said "Ten" rounds twice and listed round 11 above round 10; `CLAUDE.md` cited 3 for the rescan sabotage where it measures 4; the default-flag QA baseline disagreed between `CLAUDE.md` and `deploy.yml`; no test set a password on compress, lossless or lossy | read, or re-run |

**The text scan was replaced, not patched a third time.** Rounds 10, 11 and 12 had each found it wrong in a
new place, because it was a second tokenizer that had to agree with pdf-lib's. Before any code, a probe ran
all sixteen shapes through pdf-lib with its two drop points instrumented: every round-12 fail-open was a
real drop at one of them, none a shape pdf-lib reads differently. The guard now wraps those two points
(`PDFParser.tryToParseInvalidIndirectObject` returning nothing, `PDFObjectStreamParser.parseIntoContext`
throwing part-way), records what each dropped reference resolved to at that moment, and refuses when a
reachable drop still resolves to the same thing after the load. That also closes a bound the scan could
not: a dropped NEWEST revision with an older one standing in. Failing tests first, each confirmed red for
the stated reason (the old guard accepted the file, or refused the legal one); sabotage figures in
`CLAUDE.md`. One sabotage stayed green — skipping a per-member "was it assigned?" check — and the check was
deleted, since the end-of-load comparison already decides it. A browser-suite case runs the refusal in the
Vite bundle, where a second copy of pdf-lib would leave jsdom green. Compress joined the Lock PDF class test
(lossless in jsdom, lossy in the browser suite), each pin proven by removing that mode's password call.

**Not certified by this round, named:** bytes pdf-lib never parses as an object — skipped as junk, or
swallowed by a stream whose end it places too late — are not a drop and are not detected; that bound is
disclosed, not tested. No encrypted file with a drop was built, so the check running against the second,
decrypting parse rests on reading `PDFDocument.load`.

No browser suite or QA sweep ran inside the panel; the fix gate's runs are the evidence for those. That gate
(Node 24, the working tree over `d7eb108` that became `02dd373` and the docs commit after it — all of it
except two later markdown edits: plan row 23 and this paragraph) was green at every step: audit (0
vulnerabilities), OCR assets, type-check, lint, jsdom 2724 passed / 2 expected fail / 1 skipped, browser
90 files / 340 tests, export branch coverage 44.07 %, build (precache 24), and the QA sweep with
`--allow-destructive` at 151 checks / 114 pass / 0 fail. The logs are under the gitignored
`var/claude/ws7/round12-fix-gate/`.

Still flagged to the developer, unchanged: `/PieceInfo` stripping (unruled) and the kept-media ruling,
whose premise round 10 corrected.

Before round 13 was spawned, the two Lock PDF sabotage figures in CLAUDE.md were re-run against
`tests/export/exportPasswordSave.test.ts` as it stands after round 12. Saving the password branch without
object streams fails 11, not the 9 recorded: sanitize has routed through the seam since round 11, so its
two string cases join. Saving the no-password branch with object streams still fails the 4 controls. The
source was restored and checked with `cmp`. Only the CLAUDE.md figure changed.

**The counter remains 0 of 2.** Round 13 is next.

## Round 13 — what was fixed (2026-09-13)

Round 13 ran at `94dcc89` over `dfe34ae..94dcc89`, focused on the round-12 commits (`02dd373`, `d18d284`,
`94dcc89`), all three lenses in isolated worktrees on Node 24. It returned **6 findings**: 2 export,
1 safety, 3 completeness. The parser-level recorder itself held against the round-12 shapes, re-run by the
export lens on 20 files with byte-identical exports; both export findings were in how the recorder decided
what counts, and the safety finding predates every round of this guard.

| Defect | Evidence it was real |
|---|---|
| **P1** (safety) pdf.js follows `startxref` and the cross-reference chain, pdf-lib keeps the last definition and the last trailer — so a file whose table names an earlier copy of an object, or whose startxref trailer names another `/Root`, showed one page and exported or SIGNED another, with nothing dropped | probe: pdf.js read VIEWED from the source, the guard accepted with no drops, the pdf-lib re-save carried SIGNED — for a duplicated object and for a second trailer |
| **P2** (export) a drop reachable only through a terminated but unparseable object (`PDFInvalidObject`) was never walked, so the guard loaded a file pdf-lib had dropped from | probe: accepted, the dropped content missing from the export |
| **P3** (export) a drop superseded by a later revision still refused when both revisions were the same interned pdf-lib value (`null`, a name, a boolean) — round 12 compared values, and pdf-lib interns those | probe: a legal three-revision file refused |
| **P3** (completeness) `CHANGELOG.md` said opening a legal PDF could fail, where only exporting, editing, signing, OCR, sanitizing or compressing it could; the round-12 sabotage figures in `CLAUDE.md` did not say which files they ran against; plan row 23's Files cell was incomplete | read, and the sabotage re-run |

**The P1 was measured in pdf.js before any code was written.** A probe built ten file shapes and read each
through pdf.js 6.3.289 and pdf-lib 2.11.0. Five diverged (an earlier duplicate the table points at, a stale
incremental update, a second trailer, junk before `%PDF-` with relative offsets, and a duplicate font);
five agreed — among them a table whose offsets are all wrong, because pdf.js then rebuilds by scanning and
keeps the last definition, as pdf-lib does. So the guard refuses (`PdfXrefMismatchError`) only when the chain
from `startxref`, read the way pdf.js reads it (first-wins per section, `/XRefStm` before `/Prev`, offsets
from the first `%PDF-`, whitespace and comments skipped), lands exactly on a definition pdf-lib did not keep
and the two values differ, or when the startxref trailer's `/Root` is a different dictionary. An identical
duplicate and an unreachable one still load. The recorder already sat inside pdf-lib's parser, so it now
also keeps where each definition started and the cross-reference sections pdf-lib parses and then discards;
nothing reads the file a second time.

The two export findings changed the recorder's rule rather than adding a special case. A drop is now
superseded by assignment ORDER — pdf-lib's own assignment clock, an object-stream member taking the clock of
its member table — never by value. And a reachable damaged object refuses every drop still standing, since
its references cannot be read.

Failing tests first, each confirmed red for the stated reason: the damaged-object cases red with
`expected 'loaded'`, the interned-value cases red because the file was refused, the parse-differential cases
red because nothing was thrown, and every control green. Sabotage, fifteen mutations on the guard file and
four re-measured across five jsdom files, each landed and restored with `cmp`; the figures are in
`CLAUDE.md`, now scoped by the files they ran against. A new corpus test loads 15 real files (arXiv papers,
IRS/GSA/USPTO forms, government reports) and 5 tracked public ones through both raw pdf-lib and the guard:
the outcome matched on all 20, and 14 of the 15 reached the comparison, so the absence of false refusals is
a measurement. The browser suite gained the refusal and an interned-value control in the Vite bundle.

**Not certified by this round, named:** the comparison is not made when the chain cannot be followed through
sections pdf-lib parsed, for entries the table places inside an object stream, for a linearized file's
first-page table, or for pdf.js's choice of trailer in recovery mode — each disclosed in `KNOWN_ISSUES.md`,
none tested. No encrypted file with a drop or a duplicate was built. The swallow bound from round 12 stands.

No browser suite or QA sweep ran inside the panel; the fix gate's runs are the evidence for those. That gate
(Node 24, the working tree over `94dcc89` that became the fix commit and the docs commit after it — all of it
except this Round 13 section and plan row 24) was green at every step: audit (0 vulnerabilities), OCR assets,
type-check, lint, jsdom 2745 passed / 2 expected fail / 2 skipped, browser 90 files / 343 tests, export
branch coverage 44.07 %, build (precache 24), and the QA sweep with `--allow-destructive` at 151 checks /
114 pass / 0 fail. The logs are under the gitignored `var/claude/ws7/round13-fix-gate/`.

Still flagged to the developer, unchanged: `/PieceInfo` stripping (unruled) and the kept-media ruling.

**The counter remains 0 of 2.** Round 14 is next, and it is the last round the ruling authorises: a clean
round 14 leaves the counter at 1 of 2, so the developer is asked again after it whatever it returns.
