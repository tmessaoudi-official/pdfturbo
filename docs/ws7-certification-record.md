# WS7 — certification record for `dfe34ae..HEAD`

**Status: NOT CERTIFIED.** Eight MAXIMAL panel rounds were run against this range and the
two-consecutive-clean counter never rose above **0 of 2**. No `WS7: 2/2 clean at <sha>` entry exists
in `docs/plans/master.plan.md`, deliberately: on this evidence it would be a false record.

This file is committed because the per-round reports live under `var/claude/ws7/`, which
`.gitignore` excludes — so they do not reach a clone, and for four of the eight rounds no report file
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

Four of the eight rounds found defects in the **previous** round's fixes (rounds 2, 6, 7 and 8 by the
surviving reports; the round-3/4/5 reports were never written, so their share is unknown). That is the single most
important fact in this file: in this range, a fix has been about as likely to introduce a finding as
to close one, which is why the bar was not lowered.

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
   ruling (annotation, Popup and `/FS` all go); see `KNOWN_ISSUES.md` for the two fixture lessons.
4. **Rotated-page XFDF coordinates** (C20 / #57b) — no un-rotation exists in `xfdfMapping.ts`; the
   app's own round-trip is self-consistent, third-party interop on rotated pages is not.
5. Everything under `KNOWN_ISSUES.md` § "From the WS5 adversarial audit" — 10 deferred items.

## The standing recommendation

`src/docx/opcGc.ts` produced a "deletes a live user image" finding in **rounds 4, 6 and 7 by the surviving reports** (the round-5 report was never written) and
one ~4s-per-save performance regression, and it buys a disclosed low-severity nit (stray image bytes
left in a `.docx`). Rounds 6 and 7 could not construct a delete-a-live-image case against the current
DOMParser implementation, so it may well have converged — but it has the worst finding-per-line ratio
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
Popup, a self-cyclic `/Next` array, and an overclaiming sentence. All fixed and pushed the same night
(five more cases, three more sabotage mutations). The pattern this record exists to name: the fix for
"reference deleted, payload serialised" had that shape itself, one key over.

**Documentation and claim drift — 11 findings (the panel counted 13 across lenses; de-duplicated here), none of them a code defect**, carried here rather
than left in gitignored reports:

1. `src/utils/pdfSanitizer.ts` module header — "What it removes" still has no `/Outlines` entry and
   still describes `/A` as a single dict.
2. `index.html:145` — the sanitize button's static `title` still says "& embedded files", the exact
   claim `8ae525c` removed from all three locales, README, FEATURES and SECURITY.
3. `src/export/exportService.ts:351` — same surviving claim on `sanitizeAndDownload`'s docstring.
4. `docs/plans/master.plan.md:489` (also `:266`, `:70`) — the live Decisions Log still rules that the
   `/BBox` clip covers the **colorMap** channel, which round 7 reverted. A resuming session reading
   the plan would re-add the reverted clip.
5. `src/export/opStreamWalker.ts:248` and `CLAUDE.md:572` — "all three clipped channels" is stale
   after the colour revert; one call site, two channels. The conclusion holds, the count does not.
6. `CLAUDE.md:548` — "dropping the intersection fails the 7 leak cases" was never measured; it is 8
   at HEAD (6 jsdom + 2 browser) and 6 at the commit where it was written.
7. `CLAUDE.md:971`, `KNOWN_ISSUES.md:129` — two stale `exportPipeline.ts` line citations.
8. `vitest.browser.config.ts:70-74` — the comment rewritten in round 7 *for* an unverified claim
   carries a new one: `hookTimeout` governs `after*` too, so **14** browser files have hooks, not 10.
9. `tests/utils/pdfSanitizer.test.ts:330` — cites a `SECURITY.md` hyperlink promise that
   `git grep` cannot find.
10. `docs/plans/master.plan.md:104` vs this file — "three of the **six**" vs "seven" for the same
    statistic.
11. ~~This file's own round-6/7 counts~~ — reconciled 2026-09-05: the round table above now carries
    one row per round, the "defects in the previous round's fixes" count names the rounds it rests
    on, and the opcGc count below says which reports substantiate it.

**The counter remains 0 of 2**, and round 8 is the fourth round of eight to find defects in the
previous round's fixes. A ninth round has NOT been run: the `/goal` stop condition was cleared by the
developer mid-round-8, so the ladder is paused rather than failed.
