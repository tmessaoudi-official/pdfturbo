# WS7 — certification record for `dfe34ae..HEAD`

**Status: NOT CERTIFIED.** Nine MAXIMAL panel rounds were run against this range and the
two-consecutive-clean counter never rose above **0 of 2**. No `WS7: 2/2 clean at <sha>` entry exists
in `docs/plans/master.plan.md`, deliberately: on this evidence it would be a false record.

This file is committed because the per-round reports live under `var/claude/ws7/`, which
`.gitignore` excludes — so they do not reach a clone, and for four of the nine rounds no report file
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

Five of the nine rounds found defects in the **previous** round's fixes — rounds 6, 7, 8 and 9 by the
surviving reports (which exist for rounds 4, 6, 7, 8 and 9; none was written for 1, 2, 3 or 5), and
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
   title and the English and French tooltips to the full scope (the Arabic tooltip is deliberately
   untouched and is now the 15th value pending native review).
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
4 export, 8 safety, 10 completeness. Twelve were code-shaped and are fixed in the commit that carries
this section; the ten documentation ones are folded into this file, `CLAUDE.md`, `KNOWN_ISSUES.md`
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

**The counter remains 0 of 2.** Round 9 found defects, so the next clean round would be the first of the
two required. Round 10 is the next step.
