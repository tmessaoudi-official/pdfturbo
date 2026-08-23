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
