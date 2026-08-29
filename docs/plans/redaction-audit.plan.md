# Redaction / hide-vs-remove audit — plan & open items

Started as "crop's disclosure gap went unnoticed for a year — what else claims or implies removal?"
It became a redaction correctness audit that found **five live leaks in shipped code**.

Full narrative and the transferable lessons live in `CLAUDE.md` § *The hide-vs-remove audit*; the
user-facing grades live in `SECURITY.md` § *Hiding is not removing*. This file is only the open-items
list, so it can be deleted once they are closed.

## Shipped (all pinned by a test proven to fail when the fix is reverted)

| Leak | Fix |
|---|---|
| Table → CSV/XLSX read raw page text | redaction filter in `_extractPageTableData` |
| OCR → Copy text / Export to Word recognised the un-burned page | burn painted on the OCR canvas |
| DOCX/MD/TXT + XFDF exported redacted **overlay** text | `dropElementsUnderRedactions` in both paths |
| Redaction on a **blank** page was a vector rect over live text | covered elements not drawn |
| Every export shipped the **un-redacted page** as an orphan object | `pageHasRedaction` pre-copy filter |
| The table/flow filter **no-opped at `/Rotate` 90/270** | `getViewport({ scale: 1, rotation: 0 })` |

## New leaks found by the re-run panel (2026-08-23) — ALL SINCE FIXED (see § below)

Each is pinned by a probe with a **passing control**, run against the source md5s that are shipping
now (`var/claude/redaction-panel/round1/probes-final.log`; reproducers: untracked
`tests/browser/zzpanel-probe{,2,3}.browser.test.ts` — **since deleted**, superseded by the
committed guards; see the later note in this file. No probe file is committed, and `.gitignore` now
carries `tests/**/zz*` so a `git add -A` cannot publish one — a prose claim alone never guaranteed that).

| Leak | Where | Evidence |
|---|---|---|
| Source-PDF **images** under a redaction are not filtered — DOCX/MD/TXT embed the whole image | `_extractFlowDoc` image channel (`exportService.ts` ~:1249-1278 → `flowDocWriters`) | probe 1: `images_under_redaction = 1`; completeness P0-1 |
| Redaction filter **no-ops when the page CropBox origin is non-zero** — DOCX/MD/TXT | `_extractFlowDoc` | probe 2: `SECRETWORD` survives; `viewBox [50,50,350,350]` vs item at `100,300` |
| Same root cause, CSV/XLSX | `_extractPageTableData` | probe 3: `items = SECRETWORD\|PUBLICWORD` |

On a scan the whole page is one image XObject, so the first row is the canonical redaction case.
The CropBox rows are the same class as the `/Rotate` bug already fixed: the rect and the text items
are compared in different coordinate origins.

## Open

1. **Certification is NOT complete — and round 1 of the re-run found TWO LIVE LEAKS.** (HISTORICAL:
   this § describes the 2026-08-23 re-run, not round 5. Round 5's own certification state is recorded
   in its sections below.) Rounds 1–3 each
   found real defects *in my own fixes*; round 4 was **cut short by a rate limit** with both lenses
   mid-investigation. The re-run round (2026-08-23) was ALSO rate-limited, but its output was recovered
   from the agent transcripts → `var/claude/redaction-panel/round1/` (`completeness.md` verbatim,
   `recovery-note.md` for the other two lenses). **Verdict: FINDINGS — see § New leaks below.**

   Round 4's safety-lens lead (*"the single failure I observed looked exactly like pre-fix
   behaviour"*) is now **RESOLVED**: it was the CropBox-origin leak, confirmed by probes 2 and 3
   above. Do not re-chase it — fix it. **Re-run the panel (`export-fidelity-reviewer`,
   `safety-promises-reviewer`, `completeness-reviewer`) after the fix round.** MAXIMAL tier wants two
   consecutive clean rounds; we have zero.

   **Range for the re-run: `dfe34ae..HEAD`.** Do NOT use `7859864` — it was re-signed into `dfe34ae`
   and now dangles (this plan used to say `7859864`, which is exactly the defect its own recovered
   finding P2-4 names). `dfe34ae` has been published since 2026-08-05 and is stable. If it ever
   dangles too, re-derive by subject rather than hardcoding a new one:
   `git log --format=%H -1 --grep='hide-vs-remove pins'`.
2. **DOCX editor: deleting an image leaves its bytes in the `.docx`.** Verified (no part GC anywhere in
   `src/docx`); disclosed in `SECURITY.md`, deliberately not fixed — removing a package part safely means
   proving nothing else references it, and getting that wrong destroys images. Needs its own change.
3. **Arabic: 11 values pending a native pass** — the 3 re-worded here (`toolbar.cropTitle`,
   `toast.modeHint.crop`, `toast.redactionPlaced`; single-verb substitutions, the first changes since the
   2026-07-30 sign-off) plus `toolbar.exportXlsxTitle`, 6 × `toolbar.cropMargin*`, and
   `toast.cropMarginsTooLarge`. Counts are stated in three places in `CLAUDE.md` — update all three.
4. **Disclosed bounds, not defects** — decide whether any deserve fixing: the blank-page drop is blunt
   (a partially-covered element goes entirely, and so does one deliberately stacked *above* a redaction,
   which the raster path draws above the burn); the intersection test uses the stored AABB so a **rotated**
   element's true footprint is not what is tested; **ink is composited above the burn**, so handwriting
   under a redaction stays visible on every path.
5. **C9 (borderless tables → DOCX) remains gated** on real-file corpus breadth — unchanged by this work.

## Decisions Log

- [2026-08-05 09:20] AGREED: audit every surface a user could believe deletes content, by building the
  file, running the real path, and attempting recovery — rather than reasoning from the docs.
- [2026-08-05 10:05] AGREED: reverted the true-edit delete toast. The branch is unreachable and the
  "refuses on Type3/invisible/vertical" caveat was invented; an asymmetry between sibling code paths is
  not evidence of a bug, and a fallback for a failure mode with no observed instance is itself the defect.
- [2026-08-05 10:40] AGREED: fix the leaks in code rather than weaken `toast.redactionPlaced`, which now
  promises removal in all three locales.
- [2026-08-05 11:05] AGREED: disclose rather than fix the DOCX image-bytes leak (see item 2).
- [2026-08-05 11:50] AGREED: the orphan-page leak IS real. The earlier "could not reproduce" was an
  artefact of a vacuous scan — `getDocument({ data })` transfers the buffer, so the scan read 0 bytes.
  A safety scan that cannot fail is worse than none; a negative result needs the same non-vacuity proof
  as a positive one.
- [2026-08-05 12:10] AGREED: push the five commits despite incomplete certification. The container is
  reclaimed on inactivity, so holding risks losing the work; the deployed state currently carries all
  five leaks, every fix is test-pinned, and the full deploy gate is green.
- [2026-08-23 07:55] AGREED: round-1 panel output recovered from agent transcripts rather than re-run; verdict FINDINGS, two-clean counter stays at 0.
- [2026-08-23 07:55] AGREED: the `zzpanel-probe*` files stay untracked in the tree as the reproducers for the fix round.

## Fix-round work order (written 2026-08-23, pre-compaction — resume from here)

Baseline: `origin/master == 4c8225c`, tree level (`0 0`), only the 3 untracked `zzpanel-probe*` files.
Fast gate green at that SHA: type-check ✓, lint ✓ (4 pre-existing `no-shadow` warnings), jsdom
**208 files / 2395 passed + 2 expected-fail**. Full deploy gate NOT run.

### Step 1 — the three live leaks (TDD: red first, for the stated reason)

| # | Fix | Site |
|---|---|---|
| P0-1 | filter `pageImages` through the same redaction test the 4 sibling channels use | `exportService.ts` ~:1247-1276 |
| P0-2 | add the viewBox/CropBox origin offset before comparing rect vs items | `exportService.ts:1245` (`_extractFlowDoc`) |
| P0-3 | same fix, same reason | `exportService.ts:586` (`_extractPageTableData`) |

P0-2/3 are ONE root cause: `redactionRectToContent` returns coords relative to a `(0,0)` viewport
origin; pdf.js reports items in full-page space. Same class as the `/Rotate` bug already fixed —
rect and items compared in different origins. Fix the origin, do not special-case a call site.

Promote `zzpanel-probe{,2,3}.browser.test.ts` into real guards (rename properly) or delete them.
They must not stay untracked. Each already ships a passing CONTROL — keep that property.

### Step 2 — the two guards that cannot fail

- **P1-2** `redactionLeaks.test.ts:343,351` — fixture's `getViewport` ignores rotation and
  `convertToViewportPoint` has no rotation term, so naive `el.x * scale` and the shipped mapping are
  numerically identical at rotation 0. The test named "honours a non-zero CropBox origin" passes
  against the code it replaced. Fixture must mimic pdf.js's real behaviour (the table fixture 250
  lines above already does — copy that shape, do not invent one).
- **P1-3** `exportService.ts:1240` has no test at any non-zero PAGE rotation; reverting it leaves the
  suite green. `redactionLeaks.test.ts`'s six `(pageRot, userRot)` combos drive `exportTableCsv` only.

Sabotage-verify BOTH: revert each fix, confirm the new guard goes red for the stated reason, restore
and `cmp` byte-for-byte.

### Step 3 — four doc surfaces that contradict each other

- **P2-5** `tests/browser/blockers-redaction.browser.test.ts:124-128,147` — comment describes a FIXED
  leak in the present tense; helper uses `getViewport({ scale: 1 })` annotated as "what exportService
  does", i.e. the removed defective shape left as a template.
- **P2-6** `KNOWN_ISSUES.md:66` — "with no value changes needed" is false since 3 values changed and
  11 are pending. CLAUDE.md was amended; the user-facing register was not.
- **P3-8** `CLAUDE.md:1397` and `:1760` — two `ar [Unverified]` prose markers outside the 11-item count.
- **P3-9** `README.md:46`, `FEATURES.md:52` — redaction described as rasterisation only; false on a
  BLANK page, where removal is `dropElementsUnderRedactions` (`exportService.ts:740`).

### Step 4 — certification

Re-run the panel over `dfe34ae..HEAD` (NOT `7859864` — dangles). Three unnamed lenses:
`export-fidelity-reviewer`, `safety-promises-reviewer`, `completeness-reviewer`. Freeze first: commit,
then review the commit. MAXIMAL wants two consecutive clean rounds; counter is **0**, and four rounds
so far have each found real defects — three of them in my own fixes. Budget for that.

### Decisions Log

- [2026-08-23 22:10] AGREED: steps 1–3 land as one commit round; step 4 certifies it. Bucket 5
  (Arabic native pass ×11, DOCX part GC, disclosed bounds, C9 corpus) stays out of scope — the first
  is blocked on a human, the rest are deliberate deferrals with reasons already recorded above.

---

## Fix round EXECUTED (2026-08-28/29)

All three leaks in § "New leaks found by the re-run panel" are **fixed and guarded**. Each was first
reproduced against shipping code with its control passing, then fixed, then sabotage-verified.

| # | Leak | Fix | Sabotage evidence |
|---|---|---|---|
| P0-1 | source IMAGES under a redaction embedded whole in DOCX/MD/TXT | `imagePlacementRedacted` (exportService), footprint from all four CTM corners | removing the guard fails exactly the 2 image rows |
| P0-2 | flow export no-ops at a non-zero CropBox origin | `redactionRectToPageSpace` + `viewBox` threaded to `reconstructPage` | dropping the `viewBox` arg fails exactly the 6 flow rows |
| P0-3 | same, table CSV/XLSX | same helper at that call site | reverting it fails exactly the 6 table rows |

Guards: `tests/browser/redaction-crop-origin.browser.test.ts` (27) + `tests/utils/redactionPageSpace.test.ts`
(12 pure). The `zzpanel-probe*` reproducers are **deleted** — superseded by those, which keep the
passing-control property.

**The origin class is now closed, and the inventory is the reusable part.** The two paths that BAKE
pixels already handled the CropBox origin (`pdfElementRenderer`'s `cropOriginX/Y`, the OCR burn's
`unrot.viewBox[0]/[1]`); only the two that EXTRACT text did not. `grep -rn "cropOrigin\|viewBox\[0\]" src/`
is the check.

### Step 2 (the two guards that cannot fail) — one confirmed, one REFUTED

- **P1-2 is not what it was recorded as.** The OCR fixture's `convertToViewportPoint` DOES subtract the
  origin, so dropping the production `ox +` term makes the fill land at `-20` and the test fails. The
  origin dimension is guarded. What is genuinely unexercised there is ROTATION (the fake page is
  `rotate: 0`).
- **P1-3 is real but its consequence was overstated.** Mutating `{scale:1,rotation:0}` → `{scale:1}`
  goes undetected — but it goes undetected on the PRE-fix code too (measured: 14 failed either way,
  with a square AND a non-square crop box), because at 90° the wrong un-rotation dims and the wrong
  flip base cancel. So it is not "re-ships the documented P0 leak". After the fix the question is moot
  for redaction: the filter reads only `viewBox`, which is rotation-invariant, so that argument is no
  longer load-bearing for it (it still is for layout dims — margins, column detection).
- A THIRD vacuous guard was found and fixed: `tests/signing/appearance.test.ts` had its only assertion
  inside a `catch`, so it ran zero assertions. Now `expect.assertions(2)`, sabotage-verified. A sweep of
  every `it` body for that shape found it was the only instance in the suite.

### Step 3 (doc surfaces) — done

`KNOWN_ISSUES.md` (the "no value changes needed" claim, and the pending Arabic count, now **12**),
`README.md` + `FEATURES.md` (redaction described as rasterisation only — false on a blank page), and
the two stale `ar [Unverified]` prose markers in `CLAUDE.md`, which are now marked UNRECONCILED rather
than silently resolved: the repo cannot prove whether the 2026-07-30 native pass covered them.

### Still open

1. **Certification.** SUPERSEDED by round 5 — the panel HAS since run twice over `d945127..HEAD`; see
   the two round-5 sections below for what each found and the counter state. Original text: `advisor()`
   ran at 3C and 6C. The three-lens panel has NOT been re-run over this
   round; the two-consecutive-clean counter remains **0**.
2. **Finding C — non-zero CropBox origin also shifts the whole flow LAYOUT.** Not a leak, and
   deliberately not fixed. NOW REGISTERED as **C22** in `KNOWN_ISSUES.md` and
   `tests/blockers/README.md`, and pinned by `tests/browser/blockers-cropbox-layout.browser.test.ts`
   — so "wants its own change, pinned first" is half done: it is pinned; the change is still open. Words, images and margins are mixed absolute/crop-relative: probe output
   shows a word at `"y":300` on a 300-high crop. Normalising means moving items, rules, links, images
   AND the position-derived `colorMap` keys in lockstep; a partial normalisation silently breaks
   colour/underline/link matching. Wants its own change, pinned first.
3. **`tests/browser/redaction-orphan-leak.browser.test.ts` is FLAKY** (observed 1 failed / 2 passed, then
   3 passed on an immediate re-run against a clean tree; it passed in this round's full suite). It is the
   only signal that the orphan-page leak returned, so random reds train people to re-run it. Needs
   root-causing, not a retry.
4. Items 2–5 of the original § Open (DOCX part GC, Arabic native pass, disclosed bounds, C9) unchanged.

### Decisions Log

- [2026-08-28 23:10] AGREED: fix the origin at `redactionRectToPageSpace` rather than per call site, and
  give `reconstructPage` an optional trailing `viewBox` defaulting to `[0,0,pageWidth,pageHeight]` — so
  all 57 existing call sites stay byte-identical instead of churning the contract.
  (The figure read "58" until `9ee7381`; corrected in both places this time — the point of that commit.)
- [2026-08-28 23:15] AGREED: drop a redacted image WHOLE. For a leak filter over-approximating is the
  only safe direction; the cost (one redaction removes a scan from these exports) is disclosed in
  `SECURITY.md` rather than hidden.
- [2026-08-29 00:05] AGREED: the fixture's crop box must be NON-SQUARE and its origin ASYMMETRIC. A
  square box hides a width/height swap exactly as a symmetric origin hides an x/y transposition — found
  by sabotaging my own guard, which passed until the box became 300×240.
- [2026-08-29 00:20] AGREED: `tests/export/redactionLeaks.test.ts`'s fake page now reports `viewBox`.
  A fake that omits a field real pdf.js always provides is unfaithful; the 7 failures it caused were the
  fixture being wrong, not the fix.

## Round 5 (2026-08-29) — resumed after a session was closed mid-round

Two untracked probe files were left in the tree by the stopped session. Run rather than read,
they turned out to encode three unfinished findings, all since confirmed and two of them live
leaks. Recorded here because a probe that asserts the BUG passes while the bug exists — a green
run on `zzcert-probe.test.ts` was evidence FOR the defect, which is easy to misread as "fine".

### Leak #5 — a source ANNOTATION under a redaction was painted OVER the burn (fixed)

The burn is written into the page CONTENT STREAM; pdf.js paints annotation appearance streams
AFTER it. So a FreeText note, a stamp or an un-flattened form widget sitting over a redaction was
repainted on top of the burn and baked into the exported pixels — **visibly**, not merely
extractably, which is a worse grade than every leak found in rounds 1–4. Measured: the covered
annotation's centre sampled `(255,0,0)` through an opaque black burn, with a burn-only control
sampling black in the same image.

This **refutes `CLAUDE.md` #62b** ("the redaction-rasterize path + PNG export already cover that
nuclear case"). The claim had never been tested; it was reasoning about a path nobody had driven.

Fixed at the shared collaborator, not per call site: `stripRedactedAnnotations` removes any
annotation whose `/Rect` meets a redaction, called from `rasterizePageWithRedactions` AND from
`_applyOverlaysToPage` — the latter because `downloadPageAsImage` and `renderThumbnailWithOverlays`
both rasterize what it produces and carried the identical leak. `annotationRectRedacted` is pure,
exported and normalises reversed `/Rect` corners; it fails CLOSED on an unreadable rect.

### Open at the time this section was written — BOTH SINCE FIXED in the same round

Kept for the record rather than deleted, but marked: a resuming reader was otherwise told to fix
work that is already committed. Leak #4 was fixed in `27324c5`, the sign-rect frame in `7ba25d4`,
and both are written up later in this same file.

- ~~**Leak #4 — `walkPageOps` ignores Form XObject matrices.**~~ FIXED — see § "Leak #4" below.
- ~~**Sign-rect frame mismatch.**~~ FIXED — see § "The sign-rect frame mismatch" below.

### Decisions Log

- [2026-08-29 08:20] AGREED: drop a source annotation WHOLE when its `/Rect` meets a redaction,
  rather than clipping its appearance or disabling annotations wholesale. Over-approximating is
  the only safe direction for a leak filter, and `annotationMode: DISABLE` would have satisfied
  the leak assertion while silently deleting every annotation on a redacted page — which is why
  the guard carries a CONTROL annotation that must survive.
- [2026-08-29 08:35] AGREED: place the strip in `_applyOverlaysToPage`, the shared collaborator,
  not at the two rasterizing call sites. A per-site fix would leave the next rasterizing caller on
  the same cliff — the "fix the origin, not three call sites" lesson from the `hookTimeout` entry.
- [2026-08-29 08:40] AGREED: the CropBox-origin fixture needs an ASYMMETRIC origin on both axes AND
  a non-square crop AND a snugly-sized redaction. The first version had all the right words and was
  VACUOUS — sabotaging the origin term away left it green, because a 50pt shift still overlapped.

### Leak #4 — `walkPageOps` ignored Form XObject boundaries (fixed)

A form XObject is an implicit `q`/`cm`: pdf.js's canvas backend saves the graphics state and
applies the form's `/Matrix` on `paintFormXObjectBegin`, restoring at `End`. The walker handled
neither op, so an image inside a form reported the form-LOCAL ctm — `imagePlacementRedacted`
computed its footprint in the wrong place and a redacted picture exported into DOCX/MD/TXT
intact — and the form's inner `cm` leaked out to every later page-level op.

**The leak-out compounds MULTIPLICATIVELY, not additively.** Measured: a page-level
`[100,0,0,50,20,20]` placement after a form containing `100 0 0 50 0 0 cm` was reported as
`[10000,0,0,2500,2000,1000]`.

**The fixture is where the real lesson is.** The first version placed the form with a page-level
`q 1 0 0 1 150 500 cm /Fm0 Do Q` and gave it no `/Matrix` — and it PASSED against the unfixed
walker, because the placement rode an ordinary `transform` the walker already handled. Only a
form carrying its own `/Matrix` exercises the Begin argument. The throwaway probe that started
this thread asserted the opposite (form-local ctm) from a HAND-BUILT OPS table and was simply
wrong about real pdf.js; dumping the real operator list settled it:

```
paintFormXObjectBegin[[1,0,0,1,150,500],[0,0,200,200]]
transform[...]            ← only the form's INTERNAL cm arrives this way
paintImageXObject[...]
paintFormXObjectEnd[]
```

Blast radius, stated because nothing pinned the old values: rules and text origins inside forms
also move from form-local to page space. That is the desired direction — a coloured run or an
underline inside a form previously keyed at a position `getTextContent` never reports, so it
silently failed to match.

**Checked and deliberately NOT changed:** `paintInlineImageXObject` and `paintImageMaskXObject`
are not recorded by the walker. That is not a leak — images reach the DOCX export only via named
`paintImageXObject` placements resolved through `page.objs`/`commonObjs`, so an inline image or a
stencil mask never enters that export at all. Recorded so nobody later adds the recording without
also adding the filtering, which is the one change that WOULD open a leak here.

### Decisions Log

- [2026-08-29 09:05] AGREED: handle the form boundary in `walkPageOps` by pushing the CTM and
  composing `args[0]` on Begin, popping on End — mirroring `CanvasGraphics.paintFormXObjectBegin`,
  including its `length === 6` guard for a form with no or a malformed `/Matrix`.
- [2026-08-29 09:10] AGREED: a Form XObject fixture MUST carry its own `/Matrix`. Placing the form
  with a page-level `cm` tests the `transform` op that already worked and proves nothing about the
  fix — the first version of this guard passed against the unfixed walker for exactly that reason.

### The sign-rect frame mismatch (fixed) — the 4th instance of the same root cause

Not a leak: a MISPLACED signature. The sign modal's X/Y/W/H are written verbatim into the
signature annotation's `/Rect`, which PDF defines in ABSOLUTE user space, and `PdfSigner`
bounds-checks them against pdf-lib's `getSize()` (the MEDIA box). But the drag-to-place prefill
mapped the drawn rect through the pdf.js viewport's dimensions alone — i.e. relative to the CROP
box. On a page with an inset CropBox the visible signature therefore landed displaced by exactly
the origin, and with a deep enough inset outside the visible area altogether.

Fixed as the sibling of the redaction fix: `displayRectToPageUserSpaceRect` is to
`displayRectToUserSpaceRect` what `redactionRectToPageSpace` is to `redactionRectToContent`, and
`_pageGeomForSign` now returns the page's `viewBox` rather than bare `W`/`H` — the viewBox is
what carries the origin, and it is rotation-invariant.

~~`validateRect` is deliberately UNCHANGED…~~ **SUPERSEDED the same day.** The panel refuted it:
with the prefill emitting absolute coordinates, bounding them against `getSize()` — a *dimension*,
not an extent — refuses legitimate placements near the far edge of a page whose MediaBox origin is
non-zero. `PageSize` now carries an optional origin (defaulting to 0, so every existing caller is
unchanged) and BOTH signers pass `getMediaBox()`. Pinned by 3 cases in `signRectPageSpace.test.ts`.
Left visible rather than deleted because the original ruling is referenced below.

### Decisions Log

- [2026-08-29 09:20] AGREED (first half stands, second half SUPERSEDED): fix the sign-rect frame at
  the PREFILL, emitting absolute user-space coordinates. The rider — "rather than teaching
  `validateRect` about the CropBox" — did not survive the panel: `validateRect` was taught about the
  MediaBox ORIGIN (not the CropBox), and `incrementalSigner` was updated with it. The `/Rect` is absolute by
  specification, so absolute is the canonical frame for those inputs — and changing `validateRect`
  would also change the contract for hand-typed coordinates and for `incrementalSigner`.

### Round 5 close-out checks

- **`downloadFlattened` × redaction ordering — VERIFIED SAFE, not reasoned.** `form.flatten()` runs
  on each *source* doc inside `_assemblePdfDoc` BEFORE `copyPages`, so widget appearances are baked
  into source content streams before any page is copied and before the burn is drawn. The burn wins on
  both the vector and raster paths, and post-flatten there are no widget annotations left for the strip
  to see.
- **`hasRedaction → rasterizer` branch confirmed** in both `_assemblePdfDoc` and `downloadPage`, which
  is what makes the `_applyOverlaysToPage` strip a no-op for every page reaching it from the PDF export
  path (it fires for `downloadPageAsImage` and `renderThumbnailWithOverlays`, which have no such branch).
- **`KNOWN_ISSUES.md` C12 carried the refuted #62b claim in paraphrase** — "Raster path (covers the
  redaction-rasterise case)" — and was found only by grepping for the CLAIM rather than for the one file
  already known about. That is this repo's own recorded lesson from the hide-vs-remove round, and it
  caught a real miss again.

**Certified by execution:** the `rasterizePageWithRedactions` path (end-to-end real-pdf.js pixels), the
`walkPageOps` form-boundary fix (real pdf.js operator lists), and the sign-rect mapping (pure).
**NOT certified end-to-end (at the time of writing — NOW PARTLY SUPERSEDED):** the
`downloadPageAsImage` and `renderThumbnailWithOverlays` wiring. `renderThumbnailWithOverlays` IS now
driven to pixels at every rotation and with a crop
(`tests/browser/redaction-annotation-frames.browser.test.ts`, 6 cases). `downloadPageAsImage` is
still not driven directly — it is covered only by sharing `_applyOverlaysToPage` with the
thumbnail. Named
rather than implied, per the `[pinned]` discipline.

## Round 5 — the milestone review, and what it caught

Three lenses (`export-fidelity`, `safety-promises`, `completeness`), spawned unnamed against the
frozen commit `f4a237a`. **All three independently converged on the same P0, each with its own
reproduction: the fix shipped the very class of defect it was written to close.**

`buildPageOverlays` MUTATES the page it is handed — `setRotation(totalRot)` and
`setCropBox(effBox)`. The strip read both AFTER that call, so it received a doubled rotation and
the narrowed box, and the leak stayed live on `downloadPageAsImage` and
`renderThumbnailWithOverlays` — the only two callers where the strip had work to do.

**Why the suite could not see it: every guard ran at rotation 0 with no crop.** That is the exact
shape this file already records for the 2026-08-05 round ("a rotation bug shipped inside a rotation
fix"), repeated. A fix for a frame bug has to be pinned at every frame, or it is pinned at the one
frame where all frames coincide.

**A second trap, found while writing the new guard:** element coordinates are DISPLAY space, so a
test that holds a redaction rect fixed while rotating the page is measuring nothing — the burn
genuinely moves off the target and the test asserts a leak that is not one. The guard derives the
rect per rotation via `contentRectToDisplay`. My first version of the crop case was vacuous for the
same family of reason (a 10pt origin shift still overlapped); it now uses a (100,150) origin.

Also fixed from the panel: `beginAnnotation`/`endAnnotation` (the third implicit-CTM op — a stamped
image reported its ctm at the page origin, so the filter erred in BOTH directions); genuine
fail-closed behaviour in the strip (`lookupMaybe` THROWS on a wrong type rather than yielding
undefined); and `validateRect` bounding against the media BOX rather than its dimensions.

### Still open after round 5

- **The signer signs the ASSEMBLED document.** A redaction-bearing page becomes a fresh raster page
  at origin (0,0) sized to the crop box, so for that one page the absolute sign prefill is off by
  the crop origin. Not fixed on purpose: making the prefill depend on which assembly branch a page
  will take couples the UI to export internals, which is how this family of bug breeds.
- **The form `/BBox` clip is not modelled** by `walkPageOps`. It makes an in-form footprint an
  OVER-approximation, which is the safe direction for a leak filter, but it can admit a rule that is
  clipped away on the page. No confirmed instance; recorded rather than guessed at.
- **C22** (flow LAYOUT on a non-zero CropBox origin) — now registered in `KNOWN_ISSUES.md` and
  `tests/blockers/README.md`, which it was not before.

### Decisions Log

- [2026-08-29 10:20] AGREED: both `stripRedactedAnnotations` call sites read the page frame BEFORE
  `buildPageOverlays`. The rasterizer did not strictly need it (it captured `srcRot` early and
  passes `skipCropBox`), but relying on that subtlety is what let the sibling diverge silently.
- [2026-08-29 10:25] AGREED: a guard for a frame bug asserts over the WHOLE output (no red pixel
  anywhere) rather than sampling a computed point, so the test's own coordinate arithmetic cannot
  mask the defect it exists to catch.
- [2026-08-29 10:30] AGREED: keep the `endAnnotation` pop although sabotage leaves the suite green,
  and say so in the code. It is unobservable only because `beginAnnotation` resets the ctm; the pop
  keeps the stack balanced for any future op emitted after an annotation block.

## Round 5 review, round 2 — and the regression the first fix introduced

Frozen at `e7b7789`. All three lenses ran again. **The counter did NOT reach clean: 3 + 5 + 10
findings.** Two mattered.

### A regression created BY the `beginAnnotation` fix

Composing the annotation placement was right for the IMAGE channel — it is what lets
`imagePlacementRedacted` see a stamped image. But `walkPageOps` emits **four** channels off the same
`ctm`, and the other three describe the PAGE's own text. Before the fix an annotation's vector ink
sat at (0,0), where `classifyRuleAsUnderline`'s overlap test never matched real text — inert noise.
Placed correctly it lands ON a text baseline: a `Square` annotation's border reads as an underline
the source does not have, and a page of un-flattened widget borders becomes a phantom lattice. Since
`reconstructPage` REMOVES in-region words from the paragraph flow, that can silently DELETE body text
from the DOCX/MD/TXT export — verbatim the harm this repo cites as the reason C9 stays unwired.

Fixed with an `annotationDepth` counter: images are still collected inside an annotation, the three
page-text channels are not. **The lesson is that "fix the ctm" and "fix the image channel" were not
the same change** — a shared variable feeding four consumers means a correctness fix for one is a
behaviour change for all four, and only the image channel had been reasoned about.

### `stripRedactedAnnotations` was still not fail-closed

`annots.lookupMaybe(i, PDFDict)` sat OUTSIDE the try added in the previous round, so a wrong-typed
ENTRY (a bare number in `/Annots`) threw where a wrong-typed `/Rect` was caught. Two lenses found it
independently. On the thumbnail path that throw degrades to a plain UN-REDACTED raster — the exact
degradation the wholesale-delete branch was written to prevent, defeated three lines later.

### Process finding, accepted

**The round was run on a moving tree** and that is a real violation of this repo's own freeze rule —
I was editing `opStreamWalker.ts` and `exportPipeline.ts` while the reviewers measured. One reviewer
also had to restore its own sabotage snapshots and flagged that it may have clobbered an in-flight
edit of mine. No work was lost (verified against `git show HEAD:`), but the round's numbers are
weaker for it. **Freeze means freeze: no edits between spawning the panel and reading its reports.**

### Also corrected

`CLAUDE.md` said `validateRect` was "deliberately UNCHANGED" three lines above the paragraph
explaining how it had changed; three guard counts were stale in the very file that carries the
"a wrong count here is exactly the claim this file exists to prevent" rule; `SECURITY.md` claimed
both image-export paths were "pinned at each rotation" when only the thumbnail was; the
`endAnnotation` comment claimed to mirror pdf.js's own `restore`, which pdf.js does not do there
(the unwind happens at the NEXT `beginAnnotation`); and the rasteriser path is now pinned across all
four rotations and a crop, which it never was.

### Decisions Log

- [2026-08-29 11:20] AGREED: inside an annotation appearance stream, collect the IMAGE channel but
  suppress `rules`/`vRules`/`colorMap`. An annotation's ink is not page content, and placing it
  correctly is precisely what makes it dangerous to the flow reconstructor.
- [2026-08-29 11:25] AGREED: `SECURITY.md` states which callers are DRIVEN end-to-end and which are
  covered only by sharing a collaborator. "Pinned" is a claim about tests, not about confidence.
- [2026-08-29 11:30] AGREED: `.gitignore` carries `tests/**/zz*`. A prose promise that no probe file
  remains is not a mechanism, and this repo commits with `git add -A`.

## Round 5 review, round 3 — severity converging, but two real coverage gaps

Frozen at `80ca590`. Findings: 3 + 2 + 10. **No live product leak this round** — a genuine change
from rounds 1 and 2, both of which found leaks in the fixes themselves. What did come up:

### Two guards that could not fail

- **The `vRules` gate was unpinned.** Removing it left the ENTIRE repo green. The fixture's bar was
  horizontal, so it could never produce a vertical rule — and `vRules` is precisely the channel whose
  harm the gate's own comment names (`buildTableGrid` clusters it into columns → phantom lattice →
  `reconstructPage` deletes in-region words). Fixed by adding a vertical bar; each of the three gates
  now reds exactly one case when removed individually.
- **The new rasterize frame cases had no over-reach control.** Demonstrated, not argued: making the
  strip delete `/Annots` wholesale made all five pass while every annotation on the page was
  destroyed. This is the rule the previous round wrote into `CLAUDE.md` — *a leak guard needs a case
  that fails when the fix OVER-reaches* — not applied to the block written in the same round.

### Documentation defects, several self-inflicted

The worst: a "correction" in round 2 replaced a TRUE statement with a false one. `geometry.ts`'s
docstring for `displayRectToUserSpaceRect` was edited to say the signer validates against
`getMediaBox()` — but that function has no origin term at all, as the sibling 16 lines below says
explicitly. Also: a fourth guard count went stale in the very commit that fixed three others; two
"sabotage fails EXACTLY case X" claims stopped being true the moment cases were added to those files;
the plan file still carried the `validateRect`-is-UNCHANGED sentence that `CLAUDE.md` had already
superseded (the sibling-copy miss again); and two of the three leaks fixed in this range had no
user-facing `SECURITY.md` bullet.

### Process: parallel reviewers cannot share a working tree

Two lenses reported the tree moving under them — this time from EACH OTHER's sabotage, not from the
author. One lens defended itself by working in an isolated `git archive` snapshot, which is the right
answer. **A reviewer that performs mutation testing needs its own worktree, or the lenses must run
sequentially.** Running three sabotage-performing agents against one checkout makes every number they
produce unattributable.

### Decisions Log

- [2026-08-29 11:55] AGREED: every channel gate gets its own fixture feature. A gate that no test can
  fail is not a guard, and the horizontal-bar fixture silently exempted `vRules`.
- [2026-08-29 12:00] AGREED: every frame case in a leak guard asserts BOTH directions — covered ink
  gone AND uncovered ink present. One shared control at rotation 0 does not cover a rotation-specific
  over-reach.
- [2026-08-29 12:05] AGREED: a reviewer that sabotages must do so in an isolated worktree. Recorded
  after two lenses independently reported contamination from a third.
