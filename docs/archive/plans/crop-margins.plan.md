# Numeric crop margins (#G23 v1b) Plan

## Decisions Log

- [2026-08-04 23:50] AGREED: margins convert **per page** for apply-to-all, unlike the drag path which
  clamps one rect. "20pt off each edge" means the same thing on a mixed-size document; one rect does not.
- [2026-08-04 23:55] AGREED: a page whose margins leave nothing is SKIPPED, never cropped to nothing.
- [2026-08-05 00:05] AGREED: extract `PageService._commitCrops` so the drag and margin paths share undo
  grouping, thumbnail invalidation and toast selection. The existing `cropPage` tests are the
  equivalence evidence for that refactor.
- [2026-08-05 01:50] AGREED (panel finding, P1): margins are typed in **DISPLAY** space and mapped
  through the drag path's own `redactionRectToContent`. The first version derived a content rect from
  margins directly, ignoring `srcRot`/`p.rotation`, and cropped the WRONG VISUAL EDGE on any rotated
  page — a `/Rotate 90` scan hits it with no user action. Rotation belongs to the caller, once, shared.
- [2026-08-05 01:55] AGREED (panel finding, P2): clicking ✓ with nothing typed is a NO-OP. A full-page
  "crop" consumed an undo entry for an invisible change and added a `/CropBox` to a page that had none,
  so exported bytes stopped being byte-identical. The ⤺ button is how a crop is cleared.
- [2026-08-05 02:00] AGREED (panel finding, P2): a PARTIAL skip warns too. Reporting "applied to all
  pages" while silently leaving a small page uncropped is the misleading case, and mixed-size documents
  are exactly what per-page conversion exists for.
- [2026-08-05 02:05] AGREED (panel finding, P1): `.toolbar-group` wraps at the mobile breakpoint.
  `.toolbar` has wrapped since QA-D F3 for the stated invariant "every control stays reachable without
  scrolling", but that never reached INSIDE a group — so three of the five new controls rendered outside
  a 375px viewport, un-hit-testable, with `.container { overflow: hidden }` leaving no scroll to reach
  them. Pinned statically because the live gate is blind to it twice over.
- [2026-08-05 02:10] AGREED (panel finding, P1 — the most important of the round, and not about this
  feature): **crop HIDES, it does not remove**, and that was disclosed nowhere a user would look. Now in
  `README.md`, `FEATURES.md` and its own § in `SECURITY.md`. Two aggravating factors recorded: text
  extraction respects the CropBox so the obvious check gives a false negative, and a redaction-bearing
  page takes the rasterising path where the crop IS destructive — same action, opposite guarantees.
  Numeric margins did not create this gap but they raise the stakes, since a margin is the affordance
  for a header banner and typing a number manufactures confidence.

## Outcome

Shipped. Gate green: audit 0 vulns, type-check, lint, 2337 jsdom, 196 real-Chrome, build,
sweep `151/114/0 fail/0 warn/0 a11y` with `--allow-destructive` (default run `149/103/0/0/46`).
Ceiling left open (v1c): resizable drag handles on an existing frame; aspect-aware apply-to-all.
