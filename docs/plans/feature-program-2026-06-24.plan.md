# Feature program — overlay-text features + DOCX→PDF fidelity (2026-06-24)

## Decisions Log
- [2026-06-24] **Feature 4 (true-edit F10 + F13 + F3 byte-splice) DONE** — 8 commits ahead of
  `origin/master` (`c24590e` spec → `9c62714` plan → `a540520` F10 → `ad70e34` F13 → `d4d0221`
  byte-offsets → `78d54fe` F3 splice → `52b0970` browser guard → `660595e` CLAUDE.md). Full gate green
  on every commit. **NOT pushed — push is MANUAL (user pushes).**
- [2026-06-24] AGREED (user): build **5 features**, one at a time, each its own spec→plan→TDD→FULL gate
  (`type-check && lint && test && test:browser && build`)→ONE commit. **No Co-Authored-By. Push MANUAL.**
- [2026-06-24] AGREED (user): **build order = 1→2→3→4→5** (Recommended — smallest/highest-value/most
  self-contained first, big DOCX→PDF render last):
  1. **Find & replace on OVERLAY text** (also satisfies the deferred "PDF find/replace" follow-up).
  2. **Bullet / numbered lists** on overlay text.
  3. **Links** (clickable link annotations) on overlay text.
  4. **Stroke / Tc / Tz on the ARABIC overlay** (extend the Slice-2 advanced attrs to the RTL `arabicOverlay` path).
  5. **DOCX→PDF fidelity** — render tables / images / real font faces in `docModelToPdfBytes` (the largest).
- [2026-06-24] AGREED (user): **design mode = "Autonomous design, you test"** — I write a sensible spec +
  plan for each feature using my own judgment (brainstorming HARD-GATE is satisfied by this standing
  pre-approval), build it, and the user reviews by manually testing the result. Stop only for a genuine
  design fork with no clear answer (→ AskUserQuestion).
- [2026-06-24] AGREED (user): after all 5 are built → **user tests manually → then a fresh deep QA sweep.**

## Sequence / status
- [x] Feature 1 — overlay-text find & replace — **ALREADY DONE** (`3b24c99`, `src/core/overlayReplace.ts`;
      find-bar Replace/Replace-all, undoable, visual-confirmed). Discovered on the 2026-06-24-#2 resume —
      the row was stale; no work needed.
- [x] Feature 2 — overlay-text bullet/numbered lists — **DONE** (`listMarkers.ts` pure core +
      `TextElement.list` + bake in `renderText` + editor marker gutter + `FormattingService`
      setListType/toggleList + Text-popover buttons + i18n. Full gate green; visual-confirmed
      `qa-shots/f2-lists/`).
- [x] Feature 3 — overlay-text links — **DONE** (`linkUrl.ts` sanitiser + `TextElement.linkUrl` +
      `/Link` URI annotation baked in `renderText` + editor 🔗 badge/dotted-underline +
      `FormattingService.setLinkUrl` + Text-popover URL input + i18n. Full gate green;
      visual+functional confirmed `qa-shots/f3-links/` — real clickable annotation in the export).
- [x] Feature 4 — Arabic overlay stroke/Tc/Tz — **DONE** (`buildArabicRunOps`/`effectiveArabicWidth`
      pure helpers in `arabicOverlay.ts`; stroke/Tc/Tz applied to shaped RTL Arabic in both the
      pure-Arabic and mixed-bidi paths; byte-identical no-attr path. Full gate green; visual-confirmed
      `qa-shots/f4-arabic/` — stroke/wide/spaced Arabic all render).
- [ ] Feature 5 — DOCX→PDF fidelity (tables/images/fonts) — partial today (headings/lists/colors done;
      tables/images/font-faces are the ceiling to push)  ← **NEXT (largest)**
- [ ] User manual test
- [ ] Deep QA sweep

## Resume (after compact)
- HEAD should be `660595e` (Feature 4 complete) **or later if the user pushed**; check `git log --oneline -3`
  and `git rev-list --count origin/master..HEAD`.
- Start with **Feature 1 (overlay-text find & replace)**: brainstorm a sensible design → spec
  (`docs/superpowers/specs/`) → writing-plans (`docs/superpowers/plans/`) → execute inline TDD, one commit,
  FULL `test:browser` + build gated. Then Feature 2, etc.
- The DOCX editor already has a find/replace bar (`src/docx/findReplace*.ts`) — REUSE its pure matcher
  patterns where sensible, but the PDF overlay-text surface is the app's own `TextElement` array + the
  text-search infra (`src/handlers/textSearchHandler.ts`, `src/core/...`), NOT ProseMirror. Scope Feature 1
  during its brainstorm.
- Mode is **autonomous design / user tests** → don't re-ask approval per spec; just build. Push stays MANUAL.

## Notes / constraints (standing)
- TDD, tests EXECUTED (paste runner output). One commit per feature. No Co-Authored-By. `git push` MANUAL.
- Reuse the ONE shared color palette (presets + recent + swatch row) — never a lone `<input type=color>`.
- Visual confirmation via before/after screenshots for any rendered surface (`qa-shots/`).
- FULL `test:browser` + `npm run build` in every gate (the CI-red lesson).
