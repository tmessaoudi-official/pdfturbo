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

## New leaks found by the re-run panel (2026-08-23) — NOT yet fixed

Each is pinned by a probe with a **passing control**, run against the source md5s that are shipping
now (`var/claude/redaction-panel/round1/probes-final.log`; reproducers: untracked
`tests/browser/zzpanel-probe{,2,3}.browser.test.ts`).

| Leak | Where | Evidence |
|---|---|---|
| Source-PDF **images** under a redaction are not filtered — DOCX/MD/TXT embed the whole image | `_extractFlowDoc` image channel (`exportService.ts` ~:1249-1278 → `flowDocWriters`) | probe 1: `images_under_redaction = 1`; completeness P0-1 |
| Redaction filter **no-ops when the page CropBox origin is non-zero** — DOCX/MD/TXT | `_extractFlowDoc` | probe 2: `SECRETWORD` survives; `viewBox [50,50,350,350]` vs item at `100,300` |
| Same root cause, CSV/XLSX | `_extractPageTableData` | probe 3: `items = SECRETWORD\|PUBLICWORD` |

On a scan the whole page is one image XObject, so the first row is the canonical redaction case.
The CropBox rows are the same class as the `/Rotate` bug already fixed: the rect and the text items
are compared in different coordinate origins.

## Open

1. **Certification is NOT complete — and round 1 of the re-run found TWO LIVE LEAKS.** Rounds 1–3 each
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

1. **Certification.** `advisor()` ran at 3C and 6C. The three-lens panel has NOT been re-run over this
   round; the two-consecutive-clean counter remains **0**.
2. **Finding C — non-zero CropBox origin also shifts the whole flow LAYOUT.** Not a leak, and
   deliberately not fixed. Words, images and margins are mixed absolute/crop-relative: probe output
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
  all 58 existing call sites stay byte-identical instead of churning the contract.
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

### Still open after this round

- **Leak #4 — `walkPageOps` ignores Form XObject matrices.** `paintFormXObjectBegin`/`End` are not
  handled, so an image inside a form reports the form-LOCAL ctm and `imagePlacementRedacted` misses
  it; a `cm` inside a form also leaks out past the form's end, corrupting later page-level geometry.
- **Sign-rect frame mismatch.** `_pageGeomForSign` derives from the pdf.js CropBox viewport while
  the signer validates and places against pdf-lib's MediaBox `getSize()` — a 4th instance of the
  frame-mismatch pattern.

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
