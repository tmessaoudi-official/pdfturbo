# WS7 — certification record for `dfe34ae..HEAD`

**Status: NOT CERTIFIED.** Seven MAXIMAL panel rounds were run against this range and the
two-consecutive-clean counter never rose above **0 of 2**. No `WS7: 2/2 clean at <sha>` entry exists
in `docs/plans/master.plan.md`, deliberately: on this evidence it would be a false record.

This file is committed because the per-round reports live under `var/claude/ws7/`, which
`.gitignore` excludes — so they do not reach a clone, and for four of the seven rounds no report file
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
| 6 | 18 | Cleared the three post-round-5 fixes with executed sabotage; found a P1 sanitizer leak plus two defects introduced while preparing that round. |
| 7 | 10 | Found the round-6 sanitizer fix had closed ONE shape of its class, and a colour regression from WS4-F. |

Three of the seven rounds found defects in the **previous** round's fixes. That is the single most
important fact in this file: in this range, a fix has been about as likely to introduce a finding as
to close one, which is why the bar was not lowered.

## Fixed in round 7 (post-panel — no round has reviewed these)

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
3. **`/FileAttachment` annotations survive `sanitizePdf`** — see `KNOWN_ISSUES.md`; deciding between
   deleting the annotation and deleting only its `/FS` is a product call.
4. **Rotated-page XFDF coordinates** (C20 / #57b) — no un-rotation exists in `xfdfMapping.ts`; the
   app's own round-trip is self-consistent, third-party interop on rotated pages is not.
5. Everything under `KNOWN_ISSUES.md` § "From the WS5 adversarial audit" — 10 deferred items.

## The standing recommendation

`src/docx/opcGc.ts` produced a "deletes a live user image" finding in **four consecutive rounds** and
one ~4s-per-save performance regression, and it buys a disclosed low-severity nit (stray image bytes
left in a `.docx`). Rounds 6 and 7 could not construct a delete-a-live-image case against the current
DOMParser implementation, so it may well have converged — but it has the worst finding-per-line ratio
in the range, and reverting it while restoring the disclosure remains defensible. It was offered at
the round-3 fork and the rewrite was chosen instead.
