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

## Open

1. **Certification is NOT complete.** Rounds 1–3 each found real defects *in my own fixes*; round 4 was
   **cut short by a rate limit** with both lenses mid-investigation. The safety lens's last message was
   *"One more check: the single failure I observed looked exactly like pre-fix behaviour"* — an
   **unresolved lead**, not a finding. **Re-run the panel (`export-fidelity-reviewer`,
   `safety-promises-reviewer`, `completeness-reviewer`) over `git diff 7859864..HEAD` before treating
   this work as converged.** MAXIMAL tier wants two consecutive clean rounds; we have zero.
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
