# CLAUDE.md — PDFturbo

Client-side PDF editor (edit, annotate, sign, fill, redact, export) running 100% in the
browser — no backend, nothing uploaded. TypeScript + Vite + PWA, deployed to GitHub Pages.
Stack: pdfjs-dist (rendering), @cantoo/pdf-lib (export/encryption), i18next (EN/FR/AR with
RTL), IndexedDB (session persistence), bwip-js + qr-code-styling (barcode/QR tool).

## Routing

Work here is handled with the **global reasoning framework** (`~/.claude/CLAUDE.md`) — the 8-phase
workflow, the four-dimension Completion Gate, evidence grades, the anti-bandaid gate. A cloud session
gets a fresh `~/.claude/` every time and never reads the developer's own, so the framework travels in
this repo and is reinstalled at session start by `scripts/claude-bootstrap/install.sh` (a SessionStart
hook). See `scripts/claude-bootstrap/README.md`. On any conflict, **this file wins**.

Repo-native slash skills live in `.claude/skills/` and reviewer agents in `.claude/agents/`; both are
read in place, nothing is installed. `ls .claude/skills/` is the authoritative list — a count written
in prose drifts, so none is written here.

## Questions are plain text — `AskUserQuestion` is FORBIDDEN

`AskUserQuestion` **times out in the cloud container**, so a question asked that way can hang the turn
and be lost — a gate that cannot fire is worse than no gate. Every question to the developer is
ordinary prose: context, a minimal concrete example, numbered options, the **recommended option first
with its reason**, and a visible *"none of these / challenge the premise"* escape — then STOP and wait.
Protocol: `.claude/skills/ask-human/SKILL.md`.

Partial mechanical backing: every skill in `.claude/skills/` declares
`disallowed-tools: AskUserQuestion`, which removes the tool from the pool while that skill is active.
The grant clears on the next user message, so outside a skill the discipline is yours.

**Do not ask about routine work.** The standing directive for this repo is *no interrupts*: announce
the task size and the plan, then build it. Asking is reserved for the cases in
§ "When this protocol is mandatory" of that skill — chiefly a genuinely ambiguous request, or a change
that would weaken a documented invariant, a declared ceiling, or bump `SCHEMA_VERSION`.

## Certification ladder — governs every 3C/6C gate

`advisor()` does not exist in this environment, so independent certification comes from
**fresh-context, read-only, adversarial reviewer subagents** in `.claude/agents/` — that is the TOP
rung here, not a fallback. Three lenses, one agent each:

| Lens | Agent |
|---|---|
| correctness + regression | `export-fidelity-reviewer` |
| security + safety-promises | `safety-promises-reviewer` |
| completeness + blast-radius | `completeness-reviewer` |

Each reviewer **reads the actual diff, code and tests itself** — never certify from the author's
narrative — and is chartered to REFUTE, not approve. `/converge` runs the panel mechanically.

**Tier: MAXIMAL by default** — all three lenses, **two consecutive fully-clean rounds**, any finding
resets the counter, cap 5 rounds → then ask in plain text (never silently proceed). Rationale: this
repo's severe bugs have not been confined to one subsystem — a destroyed `w:drawing` on DOCX save, an
Android keyboard loop that made typing impossible, OCR dead in production for three reasons, an
invisible watermark. A path allowlist would have to cover nearly everything, so a single rule is both
safer and cheaper to follow.

**The one carve-out is mechanical, not a judgement call:** if `git diff --name-only` touches no
`src/`, STANDARD is enough — one reviewer, three lenses in a single pass, one clean round. Locale
strings, docs and `CLAUDE.md` edits qualify. Anything touching `src/` does not.

Availability chain: reviewer subagents → (if subagents are unavailable, e.g. inside a restricted
agent) three distinct-lens self-passes **with mandatory disclosure that certification was
self-graded**. Never silently skip a gate. The deploy gate below is the floor, never the certification.

## Git autonomy — overrides global Rule 10

Autonomous `git add`, `git commit` **and `git push`** are **authorised** for green, self-contained
work (developer directive, 2026-07-27). Asking permission for them violates the no-interrupts
directive. Limits:

- **Author/committer**: `Takieddine Messaoudi <takieddine.messaoudi.official@gmail.com>` — matches
  100% of history. The container's SessionStart hook sets the git identity to
  `Claude <noreply@anthropic.com>`, so this must be set explicitly per commit or per repo.
- **Never a `Co-Authored-By` trailer** (repo history has zero) and never the Claude email.
- **NOT authorised**: `--force` / `--force-with-lease` push, rewriting published history,
  `npm publish`. There is no `deny` list to stop you — the discipline is the control.
- Commit only when the deploy gate is green and the change is self-contained; never a broken build.
- Commit style: `feat:` / `fix:` / `refactor:` / `docs:` / `chore:`, imperative subject.
- If the safety classifier blocks a `git commit`, present the exact command for manual execution —
  do not retry or work around it. The same applies to `.claude/settings.json`, which Claude cannot
  write: stage it as `scripts/claude-bootstrap/settings.json.pending` instead.

## Plans live in the repo

Every plan or spec produced here is persisted at **`docs/plans/<topic>.plan.md`**, each carrying its
own `## Decisions Log` (`- [YYYY-MM-DD HH:MM] AGREED: <one-sentence decision>`), appended in the same
change as the ruling. The container is reclaimed and only committed state survives, so an out-of-repo
plan file is never the record of truth. There is no plan-location sentinel to ask about.

There is no separate roadmap SSOT or decision register: the plan file is the plan, and a ruling that
outlives it graduates into a **§ Gotchas** entry below — which is what makes that section this
project's real decision register. Transient review output (reports, handoffs, memory) goes to
`var/claude/**`, which is gitignored.

## Commands

```bash
npm run dev          # dev server at http://localhost:5173/pdfturbo/
npm run build        # production build → dist/
npm run preview      # serve the production build locally
npm run type-check   # tsc --noEmit
npm run lint         # oxlint . (sole linter — eslint removed 2026-06-14)
npm run test         # vitest run (jsdom) — excludes tests/browser/**
npm run test:browser # vitest run in REAL Chrome (@vitest/browser + Playwright) — tests/browser/*.browser.test.ts
npm run test:watch   # vitest watch mode
```

**Before every commit**: `npm run type-check && npm run lint && npm run test`. **Before every
PUSH** run the FULL deploy gate — CI (`deploy.yml`) runs MORE than the three above and a miss here
goes green-local / red-CI (it has happened): `npm audit --audit-level=high` → `npm run ocr:assets`
→ type-check → lint → `npm run test` (jsdom) → `npm run test:browser` (real Chrome) →
**`npm run test:coverage:export`** (the M1 #14 branch-coverage gate on `src/export/pdfElementRenderer.ts`,
threshold 25% — adding an uncovered branch to `renderText` can drop below it and FAIL the build even
when every test passes) → `npm run build`. Any of these failing on `master` blocks the deploy.

**Browser harness** (`vitest.browser.config.ts`): real-browser regression tests for things jsdom
cannot exercise — canvas/pdf.js rasterization, pointer drag, image (`commonObjs`/`VideoFrame`)
extraction, content-stream edits verified by pixels. Uses the system Google Chrome via Playwright's
`channel: 'chrome'` (no browser download). **CI runs it** (deploy.yml: after the jsdom suite, before
build, using the runner's system Chrome). Run it locally for any editor/export/DnD change. Guards
ISSUE-1..5 (see `KNOWN_ISSUES.md`).

**Running `npm run test:browser` in the Claude cloud container (2026-07-28)** — it works, but not
out of the box. Two things bite in order: (1) the config uses Playwright `channel: 'chrome'` and the
container has no Google Chrome; (2) the *preinstalled* Chromium-1194 at `/opt/pw-browsers` lacks
`Map.prototype.getOrInsertComputed`, which `pdfjs-dist` v6 calls from
`WorkerTransport.getOptionalContentConfig`, so **every** `page.render()` throws
`TypeError: this[#methodPromises].getOrInsertComputed is not a function`. Fix both with one command
plus a temporary config:

```bash
npx playwright install chromium     # Chrome 151 / chromium-1234 (~115 MB, not persisted)
# then run vitest with a throwaway config that sets
#   playwright({ launchOptions: { executablePath: '/opt/pw-browsers/chromium-1234/chrome-linux64/chrome' } })
# instead of channel:'chrome' — delete it afterwards, never commit it.
```

With that, the full suite passes in-container (68 files / 179 tests). **Do not claim a green browser
run without doing this** — and note the preinstalled binary silently produces 7 uniform
`getOrInsertComputed` failures that look like product bugs and are not.

**`optimizeDeps.include` is load-bearing** (`vitest.browser.config.ts`): every npm package reached
by `await import('<pkg>')` in `src/` must be listed — **plus `pdfjs-dist/build/pdf.worker.min.mjs`,
which is the one that actually bites.** pdf.js loads its worker at runtime, so vite discovers it LATE,
optimizes it mid-suite, and logs `optimized dependencies changed. reloading`; that reload re-hashes
every pre-bundled dep URL and kills whichever dynamic import is in flight — surfacing as
`TypeError: Failed to fetch dynamically imported module: …@pdf-lib_fontkit.js`. **The named module in
that error is the victim, not the cause** — chase the `dependency optimized:` line above it instead.
It bites `test:coverage:export` and not plain `test:browser` purely by timing: the full suite loads
the worker early, before any lazy import is airborne. Reproduce with BOTH steps in order (a lone
coverage run passes, which is how a wrong fix gets "verified"):
`rm -rf node_modules/.vite && npm run test:browser && npm run test:coverage:export`.

## Architecture

```
src/
├── main.ts                 # entry point — instantiates PDFTurboApp
├── core/                   # app orchestration + domain
│   ├── pdfTurboApp.ts      # app orchestration hub (thin delegators over extracted services)
│   ├── documentModel.ts    # page/element data model
│   ├── historyManager.ts   # command-pattern undo/redo (50-command stack)
│   ├── pdfRenderer.ts      # pdfjs page rendering
│   ├── uiController.ts     # toolbar/modal DOM wiring
│   ├── pageThumbnailPanel.ts, inkLayer.ts, storage.ts (IndexedDB)
├── elements/               # one file per annotation element type (text, shape, image,
│                           #   signature, highlight, redaction, comment, code/QR, pdf)
├── handlers/               # pointer/tool interaction (drawing, eraser, ink, text edit,
│                           #   text search, selection) — each holds a ref to the app
└── utils/                  # i18n, elementFactory, geometry, focusTrap, textLayer, …

tests/                      # mirrors src/ structure; vitest + jsdom + fake-indexeddb
locales/                    # en.json / fr.json / ar.json — MUST stay key-identical
```

- Undo/redo: every mutation goes through a Command object pushed to `historyManager` —
  never mutate `documentModel` directly from a handler without a command, or undo breaks.
- Handlers receive the concrete `PDFTurboApp`; its public surface is effectively the
  app-wide API. Adding handler↔app interactions widens this coupling — prefer extending
  an existing seam.

## Gotchas (verified by the 2026-06-11 craftsmanship review, refreshed 2026-06-14)

- **Mobile thumbnail controls = a single ⋮ action menu (F2b, 2026-06-26)**: the per-thumbnail controls
  (↺↻ rotate / 📄🖼 export / × delete) reveal on `:hover` on **desktop only**. On `≤640px` a 50×74px tile
  can't host five 44px touch targets, so the media query in `pdf-layers.css` **hides** `.thumb-rotate`/
  `.thumb-dl`/`.thumb-delete` (they stay in the DOM — desktop uses them) and **shows** a single `.thumb-more`
  ⋮ button that opens `_openActionMenu` — a body-anchored popup (`.thumb-action-menu` / `.thumb-action-menu-item`,
  ≥44px rows) with Rotate L/R, Export PDF, Export image (→ the existing format submenu), Delete. Both popups
  share ONE open-menu state (`_openMenu`/`_closeMenu`/`_onMenu*`) and the shared `_positionMenu(menu, anchor)`,
  which **flips the menu upward** when there's no room below (the thumbnail strip sits at the viewport bottom,
  so it almost always opens up) + clamps horizontally. Guarded by the F2b jsdom tests in
  `tests/ui/pageThumbnailPanel.test.ts` (wiring) + live @375px evidence (`qa-shots/f2b/`: overlays `display:none`,
  rows measured 44px, menu fully in-viewport). i18n: one new key `thumbnail.moreActions` (ar [Unverified]);
  row labels reuse the existing `thumbnail.*` keys. Spec/plan:
  (see git history).
- **Export paths are consolidated** (the historic triplication is RESOLVED): `downloadPDF`,
  `downloadPage`, `downloadPageAsImage` on `pdfTurboApp.ts` are now thin
  one-line delegators to `_exportService`; the shared rotation/cropbox/watermark/ink logic
  lives once in `src/export/exportPipeline.ts` (`buildPageOverlays`) + `exportService.ts`
  helpers (`_applyOverlaysToPage`, `_saveOrDownload`). Apply export fixes in
  `exportService`/`exportPipeline`, not in three places.
- **Watermark renders LIVE on the editor canvas (2026-06-25)**: the watermark was historically
  export-only (only `exportPreviewPanel` called `drawWatermark`), so enabling it showed *nothing*
  while editing — read as "watermark not working." `PageRenderPipeline._renderWatermarkOverlay()`
  now paints it onto a dedicated `#watermarkOverlay` canvas (z-index 1, pointer-events none, NOT the
  pdf.js page canvas — keeps true-edit colour sampling / thumbnails clean), removed+recreated every
  `renderCurrentPage`; `WatermarkPanel.apply()` re-renders so toggling is immediate. **De-dup
  invariant**: the export-preview ghost draws its OWN watermark, so `_renderWatermarkOverlay` SKIPS
  when `exportPreviewOpen`, `ExportPreviewPanel.show()` removes the live overlay, and `hide()`
  re-renders to restore it — exactly one watermark in every mode (guarded by
  `tests/core/pageRenderPipeline.test.ts` + `tests/ui/exportPreviewPanel.test.ts` +
  `tests/browser/watermark-live.browser.test.ts`). The exported PDF is unchanged (pdf-lib
  `drawWatermark` in `buildPageOverlays`, no double-bake). **Density is now 1–10 (0.5 steps),
  font-size max 400** (angle ±180 and opacity 1–100 were already full); the export spacing uses the
  shared pure `src/utils/watermarkDensity.ts` `densitySpacingFactor` (interpolated table preserving
  the old integer-1..5 factors EXACTLY → byte-stable at integer densities). `apply()`/`_updatePreview()`
  parse density with `parseFloat` (NOT `parseInt`, which truncated 1.5→1).
- **`renderElements()` destroys and recreates every element DOM node** on each call.
  Focus-restoration hacks depend on this; keyed identity is NOT preserved.
- **i18n**: every user-visible string goes through `t()`; `escapeValue: true` is set
  (`i18n.ts:70`) — i18next HTML-escapes interpolated values, so the XSS surface is small.
  Still prefer `textContent` over `innerHTML` for any user/translation data, and never
  disable escaping. The three locale files must stay key-identical (a hook checks this on
  write). Arabic values still need native-speaker review before being treated as final.
- **Base path is `/pdfturbo/`** (vite.config.ts) — asset URLs and SW scope depend on it.
- **PWA is `registerType: 'prompt'`** (`vite.config.ts:12`) — a new deploy does NOT silently
  swap open sessions; the SW waits and the app surfaces an update prompt (`toast.appUpdateAvailable`).
  Pushes to `master` are still production releases (auto-deployed via GitHub Pages), but open
  clients update only on user action / next load, not instantly.
- **Tests run in jsdom**: canvas rendering, real PDF rasterization, and pointer gestures
  are not exercised by `npm run test`. There is now a real-browser harness — `npm run test:browser`
  (`tests/browser/*.browser.test.ts`, real Chrome) — that DOES exercise these; use it for
  editor/export/DnD changes alongside `npm run dev` manual checks. CI runs both suites (deploy.yml).
- **Only `@cantoo/pdf-lib` is the PDF write library** (the dead `pdf-lib` and `qpdf-wasm`
  deps were removed 2026-06-11). Never add the bare `pdf-lib` back — it has been abandoned
  upstream since ~2021.
- **File System Access save (#54)**: `src/utils/fileSystemAccess.ts` (`canUseFsSave`/`pickSaveTarget`/
  `writeToHandle`, local types — the API is absent from some `lib.dom` versions, so no dep). `downloadPDF`
  uses the native Save dialog on Chromium. **Non-obvious: `showSaveFilePicker` needs *transient user
  activation*** — an `await` (e.g. PDF assembly) can outlive it, so the picker MUST be acquired BEFORE the
  slow work (`pickSaveTarget` is called first in `downloadPDF`, then assemble, then `writeToHandle`).
  Cancel (AbortError) → silent no-op; any non-abort failure → anchor-download fallback (progressive
  enhancement). The picker is now used by **all the major byte exports** — `downloadPDF`,
  `downloadPage`/`downloadPageRange`, `downloadFlattened`, `sanitizeAndDownload`, `compressAndDownload`,
  `exportTableCsv`, `downloadPageAsImage`, **and `exportAsDocx`** (each calls `pickSaveTarget` FIRST, before
  the heavy assembly, to stay within the transient-activation window). Only `exportAsMarkdown`/TXT and the
  XFDF export stay plain `_downloadBlob`. **Automation note:** the native Save dialog can't be driven by
  Playwright — to capture a download in a browser test, `delete window.showSaveFilePicker` to force the
  anchor-download fallback. Open-via-picker + recent-files deferred (#54b).
- **Table → CSV (#56)**: `src/utils/tableExtract.ts` (`clusterPositions`/`buildTableGrid`/`gridToCsv`, pure) +
  `ExportService.exportTableCsv`. `walkPageOps` now emits **`vRules`** (thin *vertical* line-like rects) alongside
  the horizontal `rules` — the horizontal filter (underline/strike) is byte-unchanged; vertical is a new
  additive branch. buildTableGrid clusters h-rule y's → rows, v-rule x's → cols, assigns text by center.
  **Lattice/ruled tables only** (needs visible grid lines on both axes); borderless = ceiling. CSV is a plain
  download (no FS-Access picker — sidesteps the transient-activation issue after async extraction). XLSX deferred (#56b).
- **Form flattening (#62)**: ⊞ export-flyout button → `ExportService.downloadFlattened()`. The default export
  fills+flattens a source's AcroForm **only when the user typed values** into it; an opened PDF's untouched
  fields therefore survive into the export as orphaned **widget annotations** (`copyPages` drops the document
  `/AcroForm`, so `getForm().getFields()` is 0 in BOTH paths — the residue is the page `/Annots` Widget, not the
  form catalog). `downloadFlattened` passes `_assemblePdfDoc(…, { flattenAllForms: true })` → `form.flatten()` runs
  on **every** source unconditionally, baking each widget's appearance into the page content stream and removing
  the annotation. The opts param defaults false → byte-identical for the other 3 `_assemblePdfDoc` callers
  (downloadPDF / downloadPageRange / assemblePdfBytes). Gated by `VITE_FEATURE_FLATTEN` (#28 seam, default ON;
  `main.ts` removes the button when off). The app's own overlay annotations are already baked by `buildPageOverlays`;
  source **markup** annotations (notes/stamps authored elsewhere) = ceiling **#62b** — pdf-lib has no generic
  markup-flatten, and the redaction-rasterize path + PNG export already cover that nuclear case.
  **Form FILLS are undoable (#QA-2026-06-23 P1 fix):** the form-overlay change callback routes through
  `app.handleFormInput` → `UndoRedoController.handleFormInput`, which sets `_formValues` live AND coalesces a
  burst of edits to one field into a single `SetFormValueCmd` (`src/core/commands/formCmds.ts`) recorded after a
  500ms idle (mirrors `handleTextInput`); `undo()`/`redo()` **flush** the in-flight edit (record, not discard).
  Undo reverts the stored value and the existing `renderCurrentPage` re-render repaints the overlay input. The
  old direct `setFormValue` mutation in the callback is gone (it stays on the app only for bulk session restore).
- **XFDF import/export (#57)**: `src/utils/xfdf.ts` is a **pure** codec (`buildXfdf`/`parseXfdf` via the platform
  `DOMParser`, no dep) over a normalized `XfdfAnnot` record in **PDF user space** (points, y-UP, bottom-left,
  0-based page). `src/export/xfdfMapping.ts` does the editor-display(top-left,y-DOWN)↔user-space flip
  (`elementToXfdfAnnot`/`xfdfAnnotToElement`) + `pageHeightPt` (blank→blankHeight, source→pdf.js viewport).
  Maps **highlight↔`<highlight>`, comment↔`<text>` (sticky note), text↔`<freetext>`** both ways; other subtypes
  return null (skipped, never mis-mapped). Export = `ExportService.exportXfdf` (XFDF↓ flyout button, plain
  download); import = `PDFTurboApp.importXfdf(file)` (XFDF↑ button → hidden `xfdfInput`; builds elements with the
  target page's id and adds them in ONE undoable `MacroCmd` — `app.elements` is a flat all-pages array filtered by
  `pageId` at render, so multi-page import just sets the right pageId). Gated by `VITE_FEATURE_XFDF` (#28 seam).
  **Non-obvious:** import constructs elements **directly** (not via `ElementFactory.fromJSON`, whose `applyBase`
  overrides `el.id` with `data.id` → `undefined` when absent); the element constructor auto-assigns `id` via
  `_nextId`. Ceiling **#57b**: ink/stamp/square/circle/line subtypes, multi-line highlight QuadPoints, freetext DA
  font appearance (fontSize rides a non-standard attr for app round-trip; Acrobat ignores it), form `<fields>`
  data, rotated-page coordinate transform. Acrobat byte-exactness is unverifiable in-repo (no Acrobat) — the
  internal export→import round-trip (tests) is the correctness guarantee.
- **Bates / page-numbering (#61 engine + #61b UI)**: `src/export/batesStamp.ts` is a **pure** engine
  (`batesStampText` page-mode `N / total` vs bates-mode `prefix+padStart(digits)`; `batesPosition` 6 anchors,
  bottom-left origin) + `drawBatesOnPage` in `exportPipeline.ts`, threaded through **all** export paths
  (`exportService.ts` passes `documentModel.bates` + the page's **full-document** `pageNumber`/`pageCount` into
  `_applyOverlaysToPage`/`rasterizePageWithRedactions`/blank branch — so a single-page or range export still reads
  "5 / 10"). UI = `src/ui/batesPanel.ts` (mirrors `watermarkPanel.ts` but **no preview canvas** — Bates is
  export-only by design; reuses the `.watermark-modal`/`.wm-*` CSS, so no new layout). `documentModel.bates`
  defaults **disabled** → export byte-identical (the engine `ctx.bates?.enabled` guard no-ops). **Non-obvious:**
  (1) `SavedState.bates` is **optional with NO `SCHEMA_VERSION` bump** — a pre-#61b blob lacks it and restores via
  the model-default fallback (`documentLoader.ts`: `state.bates ?? documentModel.bates`), so legacy sessions are
  NOT discarded; (2) input coercion uses a NaN-safe `intOr` (NOT `parseInt(...) || fallback`) so a deliberately
  typed `startNumber=0` is preserved (the engine emits `ACME-000000`) — the `|| fallback` idiom silently rewrote 0;
  (3) Esc-to-close lives in `keyboardBinder.ts` (every modal needs its own branch there — `trapFocus` only handles
  Tab); (4) `documentModel.toJSON()` now includes `bates` (it's dead code today but a future autosave refactor
  calling it must not silently drop Bates). Gated `VITE_FEATURE_BATES` (#28 seam). **#61c deferred**: full
  restore-path integration test, malformed-blob restore hardening, off-page huge-startNumber cap.
- **PDF sanitizer (#53)**: `src/utils/pdfSanitizer.ts` `sanitizePdf(bytes)` strips `/Info`, XMP
  `/Metadata`, `/OpenAction`, `/AA` (catalog + every page), and `/Names→/JavaScript` +
  `/Names→/EmbeddedFiles` via pdf-lib key-deletion (no new dep; 1.31 KB lazy chunk). **Non-obvious:
  it MUST load with `PDFDocument.load(bytes, { updateMetadata: false })`** — the default `true`
  makes pdf-lib re-stamp `/Info` Producer + ModDate at *load time* (constructor → `updateInfoDict`),
  silently re-injecting the metadata you're stripping. The same applies to any verification re-load.
  Wired via `ExportService.sanitizeAndDownload()` (🧹 export-flyout button) over the **assembled**
  export, not the raw source. Redaction-completeness check is deferred (#53b).
- **True text editing engine**: `src/utils/contentStreamEditor.ts` can genuinely delete/
  replace existing PDF text via content-stream surgery (position-matched, not index-matched).
  Wired into the edit-text tool (2026-06-11): `textEditHandler` tries a true edit first
  (inline floating input; Enter applies, empty deletes, Esc cancels) and falls back to the
  overlay approach when no content-stream match is found. The edit swaps `SourcePdf.bytes`
  + pdfjs doc via `ReplaceSourcePdfBytesCmd` (undoable; old pdfjs docs stay alive on the
  history stack by design). See (see git history) for
  remaining limitations (cm transforms, XObjects, Helvetica fallback font — Phase B/C).
  **ISSUE-2 fix (2026-06-14):** `replaceTextAt` has 3 paths — (1) literal byte-swap, now GATED by
  `isByteSwapUnsafeFont()` so it NEVER runs for subset/CID/embedded fonts (byte≠glyph there → was the
  heading "data-loss" bug); (2) subset glyph reuse via ToUnicode (keeps original font for in-subset
  edits); (3) standard-font redraw emitted as in-stream text operators in ONE `writeBack` (do NOT use
  pdf-lib `page.drawText` after `setPageContent` — it orphans the redraw). XObject-embedded targets
  refuse before blanking (no delete-without-replacement). Guarded by
  `tests/browser/issue2-true-edit.browser.test.ts`. **Honest restyle font-substitution (Slice B,
  2026-06-20):** `replaceTextAt` returns `false | true | 'substituted'` (was `boolean`). Path 1/2 →
  `true` (original font KEPT); refuse → `false`; Path 3 → `'substituted'` **only when the original was a
  non-standard embedded font** (`byteSwapUnsafe` = subset/CID/FontFile/Differences) — a Path-3 redraw of
  an ALREADY-standard base-14 font (e.g. a Helvetica that couldn't byte-swap in place, or a bold/italic
  restyle of one) returns plain `true`, since it's redrawn in the SAME family with no real loss (no false
  alarm). `textEditHandler.commit()` surfaces `toast.trueEditFontSubstituted` only on `'substituted'`;
  the delete and size/color-only in-stream paths (font kept) keep `toast.trueTextDeleted`/`trueTextEdited`.
  The base-14 substitution CEILING is unchanged — this LABELS it. Guards:
  `tests/browser/trueedit-restyle.browser.test.ts` + the engine/handler jsdom tests. **Sequential-edit ghost fix (2026-06-19):** Path 3
  BLANKS the original show op IN PLACE (`()Tj` / `[]TJ`) and APPENDS the redraw at end-of-stream, so two
  ops share the origin. `findTarget` used to pick the blanked ghost (lower opIndex wins the distance tie)
  on the NEXT edit → the live redraw lingered and the new text overlaid it (the reported "second edit
  resets / text on top of each other / underline frozen" bug — manifests on ANY Path-3 edit: CID/subset
  fonts always, and standard fonts when a restyle forces Path 3). Fix: `findTarget` now SKIPS empty-payload
  ops (`showOpPayload(...).trim()===''`) in both the page-stream and XObject loops, so delete/replace/the
  decoration-resize all target the live redraw. An empty op shows nothing, so it is never a valid edit
  target anyway. Guards: `tests/utils/contentStreamSequentialEdit.test.ts` (jsdom: visible-payload count)
  + `tests/browser/trueedit-sequential.browser.test.ts` (real Chrome pixels: wide→short far-zone bare,
  delete clears, 3× edits latest-only, underline tracks the 2nd edit). **Honest fallback (#1, 2026-06-17):** maximal
  in-place coverage ("Option 2") is structurally bounded — Path 1 (standard fonts) + Path 2 (reuse
  glyphs ALREADY in the embedded subset) ARE the ceiling. A NEW character absent from a subset/CID font
  has no glyph outline in the PDF, so it cannot be drawn in the original font client-side (→ Path 3
  base-14 substitute, or refuse → overlay). So `_emitOverlay` now surfaces `toast.trueEditOverlay`
  ("couldn't edit in place — added an editable overlay") on EVERY fallback (Arabic / subset-new-glyph /
  Form XObject / encrypted source) — no more silent surprise; the Arabic overlay itself renders
  correctly via the #3/#3b bidi path. Guarded by the overlay-fallback case in
  `tests/handlers/textEditHandler.test.ts`. **Text modes are SEPARATE (Sprint 3, reverted the
  ISSUE-5 unification):** `editText` edits EXISTING source text only — a blank-canvas click drops NO box
  (it re-shows the editText hint). New text is created with the draw-to-place `addText` tool (the
  split-button default), which sizes by drag and auto-switches to `select`. The old blank-drop trapped
  the user in `editText` where elements are `pointer-events:none` (`toolModeManager.setMode`), so the box
  was unselectable and every further click spawned another. Guarded by `issue5-unified-text.browser.test.ts`.
  **Sprint 2 fixes (2026-06-14):** (A-1) a refused edit at commit time is **no longer a silent no-op** —
  the handler captures overlay context (bbox + sampled bg/fg) when the inline input opens and falls back
  to the redact+text overlay via shared `_emitOverlay` when `replaceTextAt` returns false. (A-2)
  `replaceShowOpHex` now replaces the full payload in the first `TJ` hexstring AND blanks every other hex
  item (no stale glyphs). (A-3) `cmapHexToUnicodeStr` decodes ToUnicode as UTF-16BE code units +
  surrogate pairs (the old length-parity guess was wrong for ligatures/non-BMP). (A-4) `blankAllNearby`
  only blanks true shadow duplicates (same fontKey+size+payload, captured pre-mutation). (A-5) Type3 /
  vertical (`-V`) / invisible-`Tr` (mode 3/7) text now **refuse** true-edit (→ overlay) via `isType3Font`/
  `isVerticalWritingFont` + `renderMode` on `TextOpInfo`. **(B-3, 2026-06-15)** non-WinAnsi new text
  (CJK/Cyrillic/emoji) also refuses the Path-3 standard-font redraw via `hasNonWinAnsi()` (the WinAnsi
  base-14 fallback would paint '?') → overlay; joins the Arabic refusal. **(B-1, 2026-06-15)** the
  content-stream tokenizer (`consumeNumberBody`) now keeps `1e-3`/`2.5E+2` as ONE number token (the old
  `[0-9.]` class split the exponent, corrupting round-trips) — guarded so a lone `e` stays an operator.
- **Private-method convention**: `_underscore` prefix throughout; oxlint's `no-unused-vars`
  allows unused args/vars only when `_`-prefixed (`argsIgnorePattern`/`varsIgnorePattern`).
  `no-underscore-dangle` is deliberately OFF in `.oxlintrc.json` so it doesn't fight this convention.
- **PDF→DOCX/MD export (beta)**: `src/utils/flowDoc.ts` reconstructs a flow model
  (lines→paragraphs→headings/styles/RTL/lists/2-column) from pdf.js text items;
  `flowDocWriters.ts` emits DOCX (via `docx` npm, **dynamically imported** — keep it that
  way, it's a ~395 KB lazy chunk) + Markdown + TXT. Source-PDF text only — overlay
  annotations are NOT exported. Heuristic thresholds are font-size-relative.
  **MD/TXT parity (2026-06-15):** the Markdown/TXT writers now carry ordered-list ordinals
  (`orderedMarker` + `computeOrderedOrdinals`, sharing `orderedRefKey`'s instance logic with the
  DOCX writer — letters/roman/decimal per `listFormat`), list nesting (`'  '.repeat(listDepth)`),
  and images (data-URI `![]` in MD, `[image]` in TXT) — previously all three were dropped.
  Phase 2 (2026-06-13): added 2-column XY-cut (`detectColumnSplit`) and list detection
  (`detectListPrefix`) — see (see git history).
  Phase 3 (2026-06-13): native DOCX ordered-list numbering via `w:numPr` + instance-based
  restart (separate lists separated by body text restart at 1). Tests now unpack the DOCX
  ZIP with `fflate` and assert `w:numPr` presence and multi-instance `numId` divergence.
  **Phase 4 (2026-06-13)**: images — `getOperatorList` OPS.paintImageXObject + CTM tracking
  in `_extractFlowDoc` → `FlowImage` (x/y/w/h/base64/mimeType) on `FlowPage.images?` →
  `ImageRun` in DOCX (appended after text per page; pt→px at 96 DPI). Canvas extraction
  requires a real browser (`_extractFlowDoc` renders each image-bearing page off-screen first
  to populate `page.objs` before iterating; pdfjs-dist v6 stores images as `{ width, height,
  bitmap?: ImageBitmap }`, not HTMLCanvasElement — bitmap is drawn onto a temp canvas for
  base64. Browser QA required to verify on unviewed/un-scrolled pages).
  **ISSUE-3 fix (2026-06-14):** an image reused across ≥2 pages is promoted by pdf.js to
  `page.commonObjs` with a `g_` name; extraction now resolves `g_`-prefixed names from `commonObjs`
  (not just `page.objs`) — bitmap typed as `CanvasImageSource` (v6 bitmaps are `VideoFrame`). Guarded by
  `tests/browser/issue3-docx-images.browser.test.ts`. **ISSUE-4 fix:** `exportAsDocx` emits a file when
  there is text OR images (image-only PDFs export their images instead of a silent no-op). Also:
  **export-path dedup** — extracted `_applyOverlaysToPage` + `_saveOrDownload` helpers
  in `exportService.ts`, eliminating the triplicated 10-param `buildPageOverlays` block.
  **Sprint 2 fidelity (2026-06-14):** (B-1) real font faces via 28-entry `WORD_FONT_ALLOWLIST` +
  `resolveWordFont` (strips subset/style/foundry suffix; unknown → serif/sans/mono fallback) instead of
  collapsing every face to 3 generics. (B-2) page margins from per-page text bbox (Q1/Q3, outlier-robust,
  clamped to ≤40% page dim) → `w:pgMar`. (B-3) paragraph/line spacing from baseline gaps → `w:spacing`.
  (B-4) images are **floating-anchored** at PDF coords (`wp:anchor`/`wp:posOffset`, Y-flipped EMU), no
  longer centered-trailing — still via `word/media/` (ISSUE-3/4 guard). (B-5) justified detection
  (`AlignmentType.JUSTIFIED`) + first-line/left `w:ind`; `isCentered` tightened so full-width justified
  blocks aren't misread as centered. Verified by a real-Chrome DOCX export QA (margins/spacing/fonts/
  floating-image XML all present, 0 console errors). New tests: `tests/utils/flowDocFidelity.test.ts`,
  `flowDocExtraction.test.ts`.
  **Sprint 3 (2026-06-15):** ordered-list markers widened — `detectListPrefix` now recognizes decimal
  `(1)`/`1)`, and lower/upper-alpha **paren forms** `a)`/`(a)`/`A)`/`(A)` (NEVER bare-dot `a.`/`A.`/`I.`,
  to dodge author-initials), each carrying a docx `LevelFormat` (decimal/lowerLetter/upperLetter). The
  writer maps each distinct (format,text) to its own numbering reference — legacy decimal `%1.` keeps the
  `ordered-list` id — and restarts instances per-reference. `flowDocWriters.ts` `refKeyOf`/`usedRefs`.
  **Fidelity scorecards** (honest done/reachable/ceiling): (see git history).
  **Sprint 3 batch 2 (2026-06-14) — DONE:** (1) **DOCX hyperlinks** — `exportService` reads
  `page.getAnnotations()` (Link+url), passes `FlowLinkRect[]` to `reconstructPage`, which bbox-tags words
  (`FlowRun.linkUrl`, in the merge key); the writer wraps same-url runs in `ExternalHyperlink` (blue +
  underline) and the MD writer emits `[text](url)`. (2) **DOCX JPEG re-encode** — `pickImageMime`
  (`flowDoc.ts`): alpha→PNG, large opaque (≥200×200)→JPEG q0.85; extraction samples canvas alpha + picks
  the mime (was hardcoded PNG → multi-MB scans). (3) **List nesting** — `para.listDepth` now derived from
  item x0 indent vs `colLeft` in font-size units (was hardcoded 0). (4) **Headings H4–H6** — `heading`
  type widened to `0..6`, `assignHeadings` `slice(0,6)`, writer `HEADINGS` extended. (5) **True-edit TJ
  kerning preservation** (biggest-ROI) — `replaceShowOpInPlace`/`replaceShowOpHex` now DISTRIBUTE the new
  text across the existing TJ string/hex segments by original char/byte counts (last segment absorbs the
  length delta) instead of collapsing/jamming into one segment — kerning numbers survive, neighbour glyphs
  stop shifting. New `decodeLiteralString` measures segment lengths. The A2 no-stale-glyph guarantee still
  holds. Guards: `tests/utils/{flowDoc,flowDocWriters,flowDocHyperlinks,flowDocImageMime,contentStreamEditor}.test.ts`
  + `tests/browser/issue3-docx-images.browser.test.ts` (Gap 7 JPEG).
  **Sprint 4 fidelity DONE (2026-06-15):** super/subscript + roman lists (50ac4d5); spot-color/Separation
  black-collapse fixed via the v6 hex-string color path (d7879fb). **(b) underline/strikethrough** —
  `classifyRuleAsUnderline(rule, run)` (pure, y-up PDF space) matches thin filled/stroked rules from the
  export op-walk to text-run baselines; rules are collected by decoding v6 `constructPath` args
  `[paintOp, pathData, minMax]` and transforming the path-local minMax bbox by the CTM into Word space
  (`Word.x/y = it.transform[4]/[5]`, the same space) → `FlowRun.underline/strikethrough` → docx `w:u`/`w:strike`.
  Thresholds: height ≤ 0.18×fontSize (rejects shading), width > 3×height (rejects vertical bars), ≥50%
  x-overlap, baseline band dy∈[-0.35,0.10]×size (underline) / [0.18,0.62] (strike). **(d) rotated-image
  sizing** — `decomposeImageCtm([a,b,c,d,e,f])` → {scaleX,scaleY,rotation}; image extraction uses scaleX/scaleY
  for true on-page size and stores `FlowImage.rotation` → docx `transformation.rotation` (DEGREES; docx
  converts to 60000ths — NOT EMU). Guards: `tests/utils/flowDocUnderlineStrike.test.ts` (9),
  `flowDocImageRotation.test.ts` (7), writer XML tests, `tests/browser/underline-strike.browser.test.ts`
  (real pdf.js op-list → reconstructPage → DOCX e2e).
  **List continuation merge DONE (2026-06-15):** a wrapped list item whose continuation line split into a
  separate marker-less paragraph used to reset the writer's numbering instance (next item restarted at 1).
  `reconstructColumn` now re-absorbs a single-line, body-sized, hanging-INDENTED (right of the marker),
  marker-less paragraph directly after a list item back into that item — genuine body paragraphs (start at
  the column-left edge) and real list items (carry a marker) stay separate. Guard: `tests/utils/flowDoc.test.ts`
  (`reconstructColumn — wrapped list-item continuation merge`).
  **Number-tokenizer exponent already DONE (B-1):** `consumeNumberBody` keeps `1e-3`/`2.5E+2` as one token in
  BOTH the main loop and `tokenizeOne` (array parser) — verified 2026-06-15.
  **Path-3 fill-color canvas-sample DONE (`d7879fb`, e2e-guarded 2026-06-15):** `resolveRedrawColor`
  (precedence: style override > parsed `rg`/`g`/`k` > canvas-sampled `fallbackColor` > black) +
  `replaceTextAt(…, fallbackColor)`; `textEditHandler` passes `sampledFallback =
  hexToRgb01(overlayContext.textColor)` (the glyph color sampled in `_buildOverlayContext`), so
  Separation/spot (`scn`) text no longer redraws black. Guards: `tests/utils/contentStreamColor.test.ts`
  (pure `resolveRedrawColor`, incl. the scn-fallback case) + `tests/browser/truedit-spot-color.browser.test.ts`
  (real pdf.js render of a Separation colorspace → forces Path-3 via Helvetica `é` edit → asserts the
  redrawn glyph stays chromatic, and a no-fallback control redraws black). **All three `02-trueedit-matrix.md`
  "reachable gaps" are now done** (Gap 1 TJ-kerning distribute, Gap 2 this, Gap 3 exponent).
  **Ceiling** (genuinely hard client-side): lattice/borderless tables, vector→raster, recursive 3-col
  XY-cut, exact subset-font faces; true-edit IN-PLACE Arabic (subset CID fonts lack the glyphs — structural),
  true-edit cm-rotation Path-3 redraw, Type3; mixed LTR+RTL single-line reorder; tashkeel GPOS positioning.
  **Decoration + graphics-state fidelity (#text-decoration, 2026-06-18):** PDF has NO underline/strike TEXT
  attribute — they're SEPARATE thin filled `re` rects whose width is decoupled from the text, so a true-edit
  that changed text LENGTH used to leave the rule frozen (longer edit → un-underlined tail; the reported bug).
  `replaceTextAt`/`deleteTextAt` take `opts.adjustDecorations` (wired from `isEnabled('textDecor')`, #28 seam,
  default ON; PURE behavior gate — no UI button, so vite needs NO define, env-undefined→ON like every flag).
  Pure helpers in `contentStreamEditor.ts`: `locateDecorationRects` (CTM-aware walk, USER space) collects BOTH
  decoration encodings — filled `re`+fill-painter rects (`kind:'rect'`) AND horizontal stroked lines
  `mx my m  lx ly l  S` (`kind:'line'`, the Word/LibreOffice underline form; `DecorationRule` is a discriminated
  union) → `matchDecorationForText` (reuses the export `classifyRuleAsUnderline` baseline-band+≥50%-overlap
  classifier — SINGLE candidate only, else refuse) → `adjustedRuleWidth` (scale by new/old text-width ratio
  measured in the matched standard font → path- AND scale-invariant; the old rule already bakes in Tz/CTM and
  we keep them, so the ratio cancels — no separate hScale math; div-by-0 guarded). Resize rewrites the rect's
  width operand OR the line's `l` endpoint x (relative to the fixed `m` anchor, draw-direction-preserving) IN
  the same `writeBack` → atomic + undoable via the existing `ReplaceSourcePdfBytesCmd` (NO new command, NO schema
  bump). Delete neutralises the paint op to `n` (fill for rect, stroke `S` for line) + clears its operands.
  **The stroked-LINE form is the real-file fix (2026-06-19):** the original 2026-06-18 ship handled ONLY filled
  `re` rects, so Word/LibreOffice underlines (drawn as `m…l…S`) stayed frozen — the reported "still not
  propagated" symptom = a successful in-place edit whose stroked rule was refused, NOT the overlay path.
  **NEGATIVE-height bbox normalization (#bg-fill, 2026-06-20):** PDF `re` allows a NEGATIVE height — iText/
  JasperReports draw filled background BANDS top-down as `x y w -h re f` (real-world: a Navigo/IDFM invoice's
  blue header band = `0.553 0.702 0.886 rg 27 719 540 -66 re f`). `locateDecorationRects` stored the SIGNED height,
  and `classifyRuleAsUnderline`'s "too tall to be a decoration" guard `rule.height > 0.18*fontSize` is DEFEATED by a
  negative value (`-66 > 1.98` is false) — so a 66pt full-width background fill was misclassified as the subtitle's
  strikethrough and its width resized 540→120pt, WIPING the band (the reported "background color changes" bug; only
  fired for runs whose baseline fell in the mis-computed band, e.g. the size-11 subtitle, not the size-18 heading —
  hence "sometimes"). Fix: `locateDecorationRects` normalizes every `re` to its true positive bbox (`y0 = h<0 ? y+h : y`,
  `height = |h|`); a genuine thin top-down underline normalizes to a thin positive height and still matches. Width keeps
  its sign (a negative-width rect is already rejected by the classifier, so the width-operand resize never touches it).
  Guard: `tests/utils/contentStreamEditor.test.ts` ("REFUSES a tall background rect drawn with NEGATIVE height" + the
  thin-underline no-regression case).
  **Non-obvious REFUSE gates (each = leave PDF unchanged, never guess):** sheared/rotated CTM (b or c ≠ 0); >1
  in-band rule (double underline); a SLANTED line (m/l y differ) or POLYLINE (≥2 `l`); `s` (closepath+stroke,
  ambiguous closing segment) — only plain `S`; and a rect/line whose painter ALSO closes an `m/l/c/v/y/h`
  subpath (neutralising it would erase that vector art), refused via `sawOtherPath` + the single-segment
  counts. **F10 + F13 + F3 byte-splice DONE (2026-06-24, (see git history)):**
  **F10** — `prepareDecorationResize` now refuses (returns the null mutator) when the target run is `tilted`
  (sheared/rotated/non-uniformly-scaled `textMatrix×CTM`; reuses the existing flag — NOT a new `tmTilted` — that
  `addDecorationAt` already gates on), beside the F6 text-rise gate; the text edit still proceeds, only the
  decoration geometry is left untouched. **F13** — new pure `ctmStackUnderflows(ops)` (a `Q` popping an empty
  graphics-state stack) gates the same function (stale CTM ⇒ decoration geometry unreliable). **F3 hybrid
  byte-splice (the deferred rewrite, now SHIPPED):** the tokenizer stamps `byteStart`/`byteEnd` on every `CsToken`
  and `groupOps` stamps the op span on every `CsOp`; `findTarget` snapshots `source` + `origSerialized` (per-op
  `serializeOp`) onto `EditTarget` pre-mutation; new `buildStreamContent(found, appendedTail)` diffs mutated-vs-snapshot
  ops — **exactly ONE op changed (valid span) → splice that op's bytes into the original `source`, every other byte
  (incl. inline-image/binary) verbatim + append the tail; ZERO ops changed + a tail (addDecorationAt) → keep `source`
  verbatim + append; else → today's `serializeOps` (zero regression)**. `writeBack` (delete/size/color/Path1/Path2),
  Path 3 (`+redraw`), and `addDecorationAt` (`+block`) all route through it; `redraw`/`block` already start with `\n`
  so the fallback is byte-identical to the old `serializeOps(ops)+tail`. The F12 multi-stream PRESERVATION bound is
  unchanged (an XObject edit writes that one stream via the builder). Guards: `tests/utils/contentStreamEditor.test.ts`
  (F10 tilted-refuse, F13 `ctmStackUnderflows`+gate, byte-offset slice-back, `serializeOp`, `buildStreamContent`
  splice/fallback/inline-image) + `tests/browser/trueedit-bytesplice.browser.test.ts` (real Chrome: inline image
  survives a one-word edit byte-identical AND pdf.js renders the spliced stream). **Edge-case hardening F5–F8 (2026-06-20, audit (see git history)):** F5 — `locateDecorationRects` now also refuses a **mirror / negative-scale CTM** (`ctm[0]<0 ||
  ctm[3]<0`; flip-X/flip-Y/180°) for BOTH rect and stroked line (the line path uses `abs()` so a mirror silently
  flipped resize direction; the `re` path was safe-by-luck only). F6 — `prepareDecorationResize` refuses when the
  target run carries a non-zero **text rise (`Ts`, super/subscript)**: its reported baseline (origin.y, no rise
  applied) is low-confidence and could match an unrelated nearby rule (cm-only sizing without Tm scale remains a
  documented ceiling). F7 — the inline-image tokenizer (`findInlineImageEnd`) now scans for a **whitespace-delimited
  `EI`** (preceded by whitespace, followed by ws/delimiter/EOF) from after the `ID` marker, falling back to the
  legacy first-`EI` — a bare `indexOf('EI')` matched the byte pair "EI" inside binary image data and truncated the
  image, corrupting the whole page on re-serialize (the one concrete corruption vector F3 would also have closed).
  F8 — `locateTextOps` captures the `"` show op's `aw ac` operands as persistent word/char spacing (spec: `"` ≡
  `aw Tw ac Tc string '`) so a later Path-3 redraw of that run uses correct spacing. **F9 — Path-3 build-then-blank
  ordering:** `replaceTextAt` used to `blankShowOp` the original BEFORE embedding/encoding the redraw font, so any
  throw in `embedFont`/`encodeText` (a CP1252-high char `€`/`Œ` whose base-14 AFM lacks a width) destroyed the
  original with no replacement (silent data loss). It now builds the redraw string + runs the decoration resize
  inside a `try`, and only blanks once the redraw is guaranteed; on throw it `return false` → the caller's overlay
  fallback, original untouched. Success-path byte-output is unchanged (still blank + appended redraw). Path-3 redraw re-emits captured `Tc`/`Tw`/`Tz`/`Ts` — and (F2, 2026-06-19) `Tr` render mode + stroke
  color (`RG`/`G`/`K`/`SC`/`SCN`, reset on `CS`) + line width (`w`) so stroked/outline text keeps its outline —
  via `buildPath3Redraw`; `locateTextOps` stamps them onto `TextOpInfo` only when non-default → byte-identical for
  plain ops. **F1 restyle (2026-06-19):** `replaceTextAt` computes `wantsRestyle` (style carries
  bold/italic/fontFamily/color/fontSize) and SKIPS Path 1 & Path 2 → forces the isolated Path-3 redraw (the only
  path that applies `style`; its own `q…Q` block, no neighbour bleed) — previously Path 1/2 swapped bytes and
  silently dropped the restyle. No `style` ⇒ Path 1/2 byte-identical; a restyle Path 3 refuses (Arabic/non-WinAnsi/
  XObject) → handler overlay carries the style. P2 (documented): stroke `w` line-width is not q/Q-stack-restored,
  so a stale `w` may feed a wrong `height` to classification — affects match acceptance only (never resize geometry),
  and a false match still requires a thin horizontal baseline-band line >50% across the text (= an underline).
  **Text-attribute inventory (#text-attr, 2026-06-19) — what a true-edit preserves:** Path 1 (literal byte-swap)
  and Path 2 (subset hex) mutate ONLY the show-op operand, so they preserve EVERY surrounding attribute by
  construction (font/size/fill/stroke/Tc/Tw/Tz/Ts/Tr/Tm/CTM/alpha/dash/clip). Path 3 (standard-font redraw) is the
  ONLY lossy path — it is appended at **end-of-stream** in an isolated `q…Q`, so it inherits the DEFAULT graphics
  state and must re-emit each attribute explicitly: it DOES re-emit fill/font/size/Tc/Tw/Tz/Ts/Tr/stroke/`w` and
  applies `style`. **Path-3 ceilings (all rare, all documented, no real-file repro → not coded):** (1) Tm
  rotation/skew + CTM scale/rotation flattened to an axis-aligned `1 0 0 1 x y Tm` (F3/F4, the same cm-rotation
  ceiling above); (2) embedded font face → standard substitute (the core Path-3 tradeoff — glyph shapes/metrics
  shift slightly); (3) **ExtGState alpha (`ca`/`CA`)** is NOT captured by `locateTextOps`, so semi-transparent
  (watermark/faded) text redraws fully opaque; (4) **line dash / cap / join** on stroked/outline text are not
  captured → a dashed outline redraws solid; (5) **text-clip render modes 4–6** keep their FILL (visible) but lose
  the clip side-effect (the appended redraw is past all page content, so nothing downstream is clipped) — modes
  3/7 (invisible/clip-only) are refused → overlay. F1/F2 (restyle + stroke/width/Tr) shipped `9d67b84`; common-case
  edits (Path 1/2 + the Path-3 attrs above) are fully covered.
  **Max-fidelity Sub-project A (2026-06-25, spec (see git history),
  plan (see git history)):** five fidelity gains, all gated/additive →
  byte-identical at defaults. **A2 (`14f5a55`) Path-3 alpha:** `locateTextOps` records the active ExtGState resource
  name; a Path-3 redraw of semi-transparent (watermark/faded) text recovers its `ca`/`CA` via `lookupExtGStateAlpha`
  and, when alpha<1, `addPageExtGStateResource` adds a fresh ExtGState that `buildPath3Redraw` re-emits via `/GSx gs`
  (was redrawn opaque). **A3a (`a5bc8f3`) XObject Path-1/2 true-edit:** font introspection is now XObject-aware — a
  shared `getFontResourceDict` + optional `xObjectName` on `getPageFontEntry`/`isByteSwapUnsafeFont`/
  `getPageFontToUnicode`/`getPageFontBaseName`/`getPageFontDescriptor`, so an XObject target's REAL font is seen
  (else the page lookup misses it and defaults byte-swap-SAFE → Path-1 would corrupt an XObject CID font — the key
  trap). New `isPath3OnlyTarget` gates `getEditableTextAt` + the `textEditHandler` hit: a Path-1/2-safe XObject target
  edits in place (`writeBack`→`setFormXObjectContent`), a Path-3-only one overlays. `TextOpInfo.xObjectName` is
  stamped by `findTarget`. **A1 (`6586c23`) Path-3 full affine:** `locateTextOps` captures the text→user linear
  matrix (`textMatrix×CTM`) when non-identity + the BASE `Tf` size; `buildPath3Redraw` emits that matrix as the Tm
  (was hard-coded identity) using the base size (or the scale double-applies) → rotated/scaled/sheared text redraws
  in place instead of upright. **A3b (`5d0cb2e`) XObject Path-3:** the Path-3-in-XObject refuse is lifted — the
  target's origin/textMatrix are XObject-LOCAL (the `Do` re-applies the page CTM at render), so the redraw writes the
  XObject's own stream via `setFormXObjectContent` with the substitute font/gs added to the XObject's `/Resources`
  (`getResourcesDict`/`ensureResourceSubDict`, XObject-aware `addPageFontResource`/`addPageExtGStateResource`); an
  unresolvable XObject dict refuses → overlay. **A6 (`3b9a553`) polish:** A6a re-emits stroke dash/cap/join (`d`/`J`/
  `j`) on a Path-3 outline redraw; A6b measures the decoration resize's new width at the NEW font size on a
  size-change edit; A6c is a guard test for the already-correct rotated-page inline-input placement (anchored at the
  click point). **Audit dropped A4 (Path-3 bold/italic face — already wired via `matchStandardFont :2027`) and A5
  (non-WinAnsi/ligature refuse — already `hasNonWinAnsi :2004`) as ALREADY SHIPPED** (stale scorecards; code is
  truth). Guards: the A1/A2/A3a/A6 cases in `tests/utils/contentStreamEditor.test.ts` + the rotated/XObject cases in
  `tests/handlers/textEditHandler.test.ts` + `tests/browser/{trueedit-alpha,trueedit-xobject,trueedit-transform}.browser.test.ts`.
  **Embedded-advance width (#text-decoration-width, 2026-06-19, fixes the "underline trails past the added text"
  overshoot):** the resize scales the old rule by `newTextWidth/oldTextWidth`. Path 1/2 keep the EMBEDDED font, but
  the widths used to be measured in a base-14 PROXY whose per-glyph metrics differ (measured: a real invoice font's
  tabular DIGITS are ~25% wider than Helvetica's — proxy/actual 0.80 for digits vs 0.99 for letters), so any edit
  that shifted the digit/letter MIX drifted the rule (adding letters to a digit run → overshoot tail). Now
  `prepareDecorationResize` measures with the font's OWN advances via `getPageFontGlyphWidths` (CID `/W`+`/DW`,
  **Identity encodings only** — else show-code ≠ CID; or simple `/Widths`+`/FirstChar`) + pure `embeddedTextWidth`
  (maps each char→code via the ToUnicode reverse map, sums advances; null if any char unmapped → proxy fallback).
  The closure gained `forceProxy`: **Path 3 passes it `true`** (it redraws in the standard font, so the proxy IS the
  render font there); Path 1/2 default false. **Scoped by `reverseMap.size > 0`** → a base-14 font with no ToUnicode
  keeps the proxy (which is exact there), so the Helvetica decoration tests are byte-unchanged. As a bonus, the
  proxy font is now embedded only on the fallback, so the prior "tiny orphan font dict on every match" is gone in
  the common case. **Path-3 absolute-anchor (2026-06-19, fixes the real-file overshoot the embedded-advance fix did
  NOT reach):** on a PDF whose every font is a CID/Identity-H subset with **no ToUnicode** (a real Word/LibreOffice
  invoice), `getPageFontGlyphWidths` returns null AND the reverseMap is empty, so the embedded path can't engage and
  the edit takes **Path 3** (standard-font redraw). There `forceProxy=true`, and scaling `R_old` by `proxyNew/proxyOld`
  OVERSHOOTS because `R_old` came from the ORIGINAL embedded font (`R_old ≠ proxyWidth(oldText)`) — measured live:
  167.6pt rule × 1.539 (HelveticaBold ratio) = 258pt vs the 212pt the redraw actually renders → a ~46pt tail. Fix:
  when `forceProxy`, set the rule to the **absolute redrawn width** `newW × (Tz hScale/100)` (the proxy IS the render
  font in Path 3, starting at the same left edge), NOT `R_old × ratio`. Verified on the real file via the live app +
  canvas pixel scan: overshoot 66px → 1px. Path 1/2 keep the ratio (correct there, `R_old` = embedded oldW). Known
  P2: a Path-3 edit that ALSO changes fontSize measures `newW` at `target.fontSize`, not the new size (rare). **Ceiling #text-decoration-b:** highlight/background-rect resize, `re`-drawn-as-stroke (`re S`)
  underline, decorations inside Form XObjects, rotated-CTM rects/lines; non-Identity CID encodings + ligature
  ToUnicode keys fall back to the (approximate) proxy. Guards: `tests/utils/contentStreamEditor.test.ts` (rect+line
  locate/match/adjust/redraw/capture/resize/delete + slanted/polyline/sheared/co-painted refusals;
  `getPageFontGlyphWidths`/`embeddedTextWidth` CID-`/W` read + non-Identity null; a CID-digit underline that resizes
  to the embedded width 26.4pt, NOT the 38.4pt proxy overshoot), `tests/browser/trueedit-underline-resize.browser.test.ts`
  (real pdf.js pixels: BOTH rect and stroked-line underline extend under the new tail; OFF controls leave it bare).
  **Richer PDF text toolbar (2026-06-21) — three sub-items.** The formatting toolbar (`index.html`) gained
  **Underline / Strikethrough / Align** buttons (`underlineBtn`/`strikeBtn`/`alignBtn`), wired in
  `formattingBinder.ts` → `pdfTurboApp` delegators → `FormattingService.toggleUnderline`/`toggleStrikethrough`/
  `cycleAlign` (each a `MoveResizeCmd`, early-returns without a selected TextElement). **(C) overlay TextElement**
  carries `underline`/`strikethrough`/`align` (`textElement.ts` + `elementFactory.ts`, **no SCHEMA_VERSION bump** —
  the three are optional, `toJSON` omits when unset); DOM render sets `text-decoration`/`text-align`, and the
  export bake (`pdfElementRenderer.renderText`) draws the lines via `page.drawLine` + applies an alignment x-offset
  (`font.widthOfTextAtSize`). Decorations are gated `if (!elemRot && …)` — the rotation signal is **`elemRot`**
  (numeric, 0 = unrotated), NOT `pdfRotVal` (= `degrees(-0)`, truthy even at 0°); rotated-element decoration is the
  ceiling. **(B1) dead Bold/Italic during a true edit FIXED:** the toolbar's B/I clicks route to
  `FormattingService.toggle*` which early-return with no selected element, so `btn-active-fmt` (which `commit()`
  reads) never flipped. `textEditHandler._openTrueEditInput` now attaches **session-local** click toggles on
  bold/italic (and underline/strike) that flip the class directly, removed on close so they never leak to
  element-formatting clicks. **(B2) NEW underline/strike on true-edited EXISTING text** — `addDecorationAt(doc,
  pageIndex, point, kind, tol)` appends a **standalone stroked line** (`buildStandaloneDecoration` → `q w RG m l S Q`)
  at the text baseline, KEEPING the original font (no Path-3 substitution). Width is measured in the font's OWN
  advances (`getPageFontGlyphWidths`/`embeddedTextWidth`) with a standard-font proxy fallback, × the `Tz` hScale;
  underline sits at `baseline − 0.1·size`, strike at `baseline + 0.28·size`. **Refuse gates (leave PDF unchanged):**
  a new `TextOpInfo.tilted` flag (set in `locateTextOps` when the text→user transform `textMatrix × CTM` is
  rotated / sheared / non-uniformly scaled beyond Tz) and invisible render mode 3/7 and undecodable text. Wired in
  `commit()` as ADD-only toggles (start OFF): a decoration-only commit takes the in-stream fast path + a no-op-save
  guard; bold/text edits run `replaceTextAt` first, then `applyDecorations` appends to the (already-edited) doc
  before save — both undoable via the existing `ReplaceSourcePdfBytesCmd`. Gated by the `textDecor` seam (default
  ON). Guards: `tests/utils/contentStreamEditor.test.ts` (buildStandaloneDecoration + addDecorationAt underline/
  strike geometry + tilted/no-match refusals), `tests/handlers/textEditHandler.test.ts` (decoration-only commit
  calls addDecorationAt; no-toggle = no add + no save), `tests/browser/trueedit-add-decoration.browser.test.ts`
  (real pdf.js pixels: underline below baseline, strike through glyph body, none cross-contaminates). Verified
  live (synthetic PDF, screenshots in `qa-shots/b2-session/`): bold + underline + bold-underline all apply
  in-place, same font, no overlay.
  **Rich text toolbar Slice 1 (2026-06-21)** — 8 Tier-1 controls on overlay `TextElement`s via inline buttons + a
  new "Text ⋮" popover (`src/ui/textOptionsPopover.ts`, **app-owned**, mirrors `batesPanel`; Esc branch added to
  `keyboardBinder.ts`). New OPTIONAL `TextElement` fields `backgroundColor`/`lineHeight`/`opacity` (**no
  SCHEMA_VERSION bump**; `toJSON` omits when unset, `elementFactory.fromJSON` reads with `?? default` so legacy
  blobs restore). All mutations route through `FormattingService`: `setAlign`, `setLineHeight` (clamp 1–3),
  `setTextOpacity` (clamp 0–1), `setTextBackground`/`clearTextBackground`, `transformCase` (pure
  `src/utils/textCase.ts`, title-case preserves whitespace via capture-group split), `clearFormatting` (resets 10
  fmt fields in ONE `MoveResizeCmd`, NOT `text`), and the **format painter** (`copyTextStyle`→`pasteTextStyle`,
  `painterArmed`/`cancelPainter`; paste-on-select hook in `pdfTurboApp.selectElement`, armed-state cleared on
  document load via `resetDocumentModel` so it can't leak across PDFs). Color presets/recent = pure
  `src/utils/recentColors.ts` (localStorage try/catch, cap 8) rendered as a swatch row in `main.ts` (swatch click
  sets `colorInput.value` + applies). Bake (`pdfElementRenderer.renderText`): bg rect (gated `!elemRot`, anchored
  via the shared highlight/redaction `anchorForCenter`) + `fontSize * (lineHeight ?? 1.2)` + `opacity ?? 1` threaded
  to text/decoration/rect. Discrete **L/C/R align buttons** (the old cycle stays for back-compat); the active one
  gets `btn-active-fmt`, synced in `uiController.updateFormattingToolbar`. **Non-obvious:** (1) the **raster export
  path** (`exportPipeline.ts`, used for redaction-bearing pages + thumbnails) ALSO honors lineHeight/opacity/
  backgroundColor now (`globalAlpha` scoped inside the existing `ctx.save()/restore()`), but is **code-reviewed,
  NOT pixel-test-guarded** — the primary vector bake IS; (2) the editor `<textarea>` preview now sets
  `style.lineHeight` (`_applyInputFormatting`) for parity with the bake. No feature flag (additive core-toolbar
  improvement). Spec/plan: (see git history). Guards:
  `tests/core/formattingService.test.ts`, `tests/utils/{textCase,recentColors}.test.ts`,
  `tests/ui/{textOptionsPopover,uiController}.test.ts`, `tests/browser/{text-toolbar,text-toolbar-bake}.browser.test.ts`.
  **Backlog/ceiling (Slice 2+):** Tier-2 (stroke/outline, char-spacing `Tc`, horizontal-scale `Tz`, justify,
  whole-box sub/superscript), find&replace on overlay text, links, bullet/numbered lists, multi-run rich text
  (ceiling); RTL direction-aware controls are gated behind the open Arabic-RTL P1 overflow defect.
  **Rich text toolbar Slice 2 (Tier-2, 2026-06-21)** — 5 advanced controls on overlay `TextElement`s: text
  **stroke/outline**, **character spacing** (`Tc`), **horizontal scale** (`Tz`), **justify** align, and whole-box
  **super/subscript**. New OPTIONAL `TextElement` fields `strokeWidth`/`charSpacing`/`horizontalScale`/
  `baselineShift:'super'|'sub'` + `TextAlign` widened to include `'justify'` (**no SCHEMA_VERSION bump**; `toJSON`
  omits when unset, `elementFactory.fromJSON` rehydrates with type guards → legacy blobs restore). **The outline has
  NO separate stroke color — it is painted in the element's OWN fill color** (the shared Slice-1 palette: presets +
  recent + `#colorSwatchRow`); the Outline control is **width-only** (a standalone `<input type=color>` was removed as
  a palette duplication, user call 2026-06-21). Mutations route
  through `FormattingService`: `setTextStroke(width)`/`clearTextStroke`, `setCharSpacing` (clamp −5..20), `setHorizontalScale`
  (clamp 50..200), `setBaselineShift('super'|'sub'|null)`, justify via the existing `setAlign('justify')` — each a
  `MoveResizeCmd`, NaN-safe clamps (`Number.isFinite`, never `parseFloat(...)||x`), and `clearFormatting`/the format
  painter carry all 5. **The core is the raw-operator bake** `src/export/styledText.ts` (`hasAdvancedText(te)`,
  `effectiveLineWidth(font,line,size,charSpacing,horizontalScale)`, `drawStyledTextLine(page,opts)` via
  `page.pushOperators` — the `arabicOverlay.ts` pattern): `renderText` takes the operator path **ONLY when
  `hasAdvancedText(te) && !elemRot`**, else the existing `page.drawText` runs UNCHANGED → **byte-identical export for
  every element without an advanced attr** (real-Chrome-guarded). **Non-obvious:** (1) stroke = render mode 2 via
  `TextRenderingMode.FillAndOutline` (NOT `FillThenStroke`, which does not exist in `@cantoo/pdf-lib`) + `RG`(= the
  fill color)/`w`;
  (2) `Tz` has no named helper → `PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(pct)])`;
  (3) opacity reuses `page.maybeEmbedGraphicsState({opacity,borderOpacity})` (it's **private** → localized `(page as
  any)` cast, gated `advanced && alpha<1`); (4) justify distributes `Tw = (boxW−lineW)/spaces` on NON-last lines only
  (single/last line → normal alignment offset); (5) sub/super = 0.65× draw size + `Ts` rise (super +0.33×fontSize,
  sub −0.15×fontSize); (6) the popover super/sub buttons **toggle** — re-clicking the active one clears to baseline
  (reads `ctx.selectedText.baselineShift`); they stay mutually exclusive. UI: inline **J** button beside L/C/R
  (`formattingBinder` → `app.setAlign`) + 4 popover rows wired in `textOptionsPopover.ts` (outline **width** (no
  color — uses fill), letter-spacing, width%, x²/x₂); `uiController.updateFormattingToolbar` toggles `btn-active-fmt` + reflects values;
  i18n `formatting.{justify,stroke,charSpacing,horizontalScale,baseline,superscript,subscript}` in en/fr/ar (ar
  [Unverified]). No feature flag (additive). **Ceilings:** rotated element + advanced attr → `drawText` fallback
  (attrs ignored, consistent with the `!elemRot` decoration gating); the Arabic overlay path NOW applies stroke/Tc/Tz
  too (Feature 4, 2026-06-24 — see below); the **raster export path** (`exportPipeline.ts`, redaction pages +
  thumbnails) is code-reviewed for these attrs, NOT pixel-guarded — the vector bake IS. Spec/plan:
  (see git history). Guards: `tests/export/styledText.test.ts`
  (pure `hasAdvancedText`/`effectiveLineWidth`), `tests/core/formattingService.test.ts`, `tests/ui/{textOptionsPopover,
  uiController}.test.ts`, `tests/browser/text-toolbar-slice2.browser.test.ts` (real Chrome: pdf.js OPS-38
  `setTextRenderingMode` present in styled / ABSENT in plain → catches a silent regression to `drawText`).
  **Backlog (Slice 3+):** RTL direction-aware controls, per-run/multi-run rich text (ceiling), true-edit of these
  attrs. (find&replace on overlay text DONE `3b24c99`; bullet/numbered lists + overlay links + stroke/Tc/Tz on the
  Arabic overlay DONE — see below.)
  **Overlay bullet / numbered lists (Feature 2, 2026-06-24):** `TextElement.list?: 'bullet' | 'ordered'`
  (OPTIONAL, **no `SCHEMA_VERSION` bump**; `toJSON` omits when unset, `elementFactory` reads with a type
  guard → legacy blobs restore). One `\n`-line = one item (the overlay bake never auto-wraps). Pure
  `src/utils/listMarkers.ts` (`listMarker(kind,ordinal)` → `'• '` / `'N. '`; `applyListMarkers(text,kind)`
  prefixes each NON-EMPTY line, ordered ordinals count non-empty lines 1-based, blanks pass through). The
  EXPORT is a single edit in `pdfElementRenderer.renderText` — `const lines = te.list ?
  applyListMarkers(te.text, te.list) : te.text.split('\n')` — so markers ride through alignment/decoration/
  the advanced-operator path AND the redaction-raster path (both go through `buildPageOverlays`→`renderText`);
  **byte-identical when `list` unset**. The editor preview is a non-editable **marker gutter** (`.text-list-gutter`
  in `editor.css`, built in `textElement.render()` with the input's font metrics, `pointer-events:none`, input
  gets `padding-left`) — markers are kept OUT of `this.text` (no fragile prefix-and-strip that could eat a line
  the user typed as "3. foo"). Mutations: `FormattingService.setListType(kind|null)`/`toggleList(kind)`
  (`MoveResizeCmd`, undoable, in `clearFormatting` + format-painter set); UI = two toggle buttons in the Text ⋮
  popover (`#bulletListBtn`/`#numberedListBtn`), `uiController.updateFormattingToolbar` reflects `te.list`.
  i18n `formatting.{list,bulletList,numberedList}` (ar [Unverified]). No feature flag (additive). **Ceiling
  (v1):** nested/multi-level lists, custom marker styles (a/A/i, start-at-N), RTL/Arabic marker placement
  (the ASCII marker still prefixes the logical Arabic line → drawn within the RTL shaping), and DOCX export of
  overlay-text markers (overlay annotations aren't in the PDF→DOCX path). Guards:
  `tests/utils/listMarkers.test.ts`, `tests/elements/textElement.test.ts` (model + gutter),
  `tests/core/formattingService.test.ts`, `tests/ui/{textOptionsPopover,uiController}.test.ts`,
  `tests/browser/text-list.browser.test.ts` (real Chrome: bullet/ordered export → pdf.js text has `•`/`1.`/`2.`,
  plain control has none). Spec/plan: (see git history).
  **Overlay text links (Feature 3, 2026-06-24):** `TextElement.linkUrl?: string` (OPTIONAL, **no
  `SCHEMA_VERSION` bump**; `toJSON` omits when unset, `elementFactory` reads `typeof === 'string'`). The whole
  text box becomes a clickable hyperlink. **Security:** `src/utils/linkUrl.ts` `sanitizeLinkUrl(raw)` allows ONLY
  `http:`/`https:`/`mailto:` (a bare domain → `https://`); `javascript:`/`data:`/`vbscript:`/`file:`/empty → null
  (blocks `/URI`-action injection). Sanitised at BOTH the service (`FormattingService.setLinkUrl`) AND the bake
  (defence-in-depth vs a crafted saved blob). EXPORT: `pdfElementRenderer.renderText` appends a borderless `/Link`
  annotation (`/A << /S /URI /URI (url) >>`, the `incrementalSigner.ts` `/Annots` idiom via a static
  `@cantoo/pdf-lib` `PDFName`/`PDFArray`/`PDFNumber`/`PDFString` import + `addUriLinkAnnotation`) over the box rect
  (same rotation-safe `rectAnchor`+swap-dims AABB as the background fill). Survives BOTH export paths (raster path
  runs the same `renderText` on the same page object); byte-identical when unset/invalid; `pdfSanitizer` preserves
  `/URI` so a link survives sanitize-and-download. Editor: a 🔗 badge (`.text-link-badge`) + dotted-underline
  (`.text-element--linked` in `editor.css`) + the URL as the box `title`; text is NOT auto-restyled (user controls
  colour/underline). `setLinkUrl` is a `MoveResizeCmd` (undoable); it is **NOT** in the format painter or
  `clearFormatting` (a URL is per-element data, like `text`) — cleared via the popover's empty input. UI = a URL
  input (`#textLinkInput`) in the Text ⋮ popover; i18n `formatting.{linkLabel,linkPlaceholder}` (ar [Unverified]).
  No feature flag. **Ceiling (v1):** per-run/partial-text links (needs multi-run rich text), internal GoTo links,
  rotated-element link rect is the axis-aligned bbox (PDF `/Link` rects can't rotate), and the lossy
  "flatten-to-images" compress path drops the annotation (it drops text too). Guards: `tests/utils/linkUrl.test.ts`,
  `tests/elements/textElement.test.ts` (model + badge/title), `tests/core/formattingService.test.ts`,
  `tests/ui/textOptionsPopover.test.ts`, `tests/browser/text-link.browser.test.ts` (real Chrome: export → pdf.js
  `getAnnotations` has a Link with the sanitized `url`; a `javascript:` URL set directly → no annotation).
  Spec/plan: (see git history).
  **Stroke / Tc / Tz on the Arabic overlay (Feature 4, 2026-06-24):** the Slice-2 advanced attrs `strokeWidth`,
  `charSpacing` (Tc), `horizontalScale` (Tz) — previously Latin/WinAnsi-only — now apply to shaped RTL Arabic text
  in the export. `arabicOverlay.ts` gains a PURE `buildArabicRunOps(fontKey, hex, x, y, size, color, style)` that
  builds the per-run operator list mirroring `styledText.drawStyledTextLine`'s ordering — `q · BT · rg · [RG · w ·
  Tr(FillAndOutline)] · Tf · [Tc] · [Tz] · Tm · Tj · ET · Q` — so the **no-style path is byte-identical** to the
  prior CID emission (stroke colour = fill colour, the Slice-2 rule). PURE `effectiveArabicWidth(baseWidth,
  glyphCount, charSpacing, horizontalScale)` does RTL right-alignment from the shaped **glyph count**
  (`cidHex.length / 4`, the real 2-byte CID units — NOT `text.length`). Both `drawArabicLine` (pure-Arabic) and the
  RTL runs of `drawBidiLine` (mixed line) route through these; `renderText` passes `te.{charSpacing,horizontalScale,
  strokeWidth}` into `drawArabicLine`. **Ceiling:** `baselineShift`(super/sub) + `justify` stay Latin-only for
  Arabic; in a mixed line the **Latin runs** keep `page.drawText` (no Tc/Tz/stroke — documented partial, consistent
  with the Noto-vs-Helvetica per-run split); Tc width is approximated from the glyph count. Guards:
  `tests/export/arabicOverlay.test.ts` (jsdom: `buildArabicRunOps` op-sequence — no-style q/BT/rg/Tf/Tm/Tj/ET/Q,
  stroke→RG+w+Tr, Tc, Tz; `effectiveArabicWidth` math), `tests/browser/arabic-overlay.browser.test.ts` (real Chrome:
  stroke→pdf.js `setTextRenderingMode`, Tz→`setHScale`, Tc→`setCharSpacing` present, ABSENT for a plain control).
  Spec/plan: (see git history).
- **Tagged-PDF struct-tree fast path (#B1, 2026-06-25)**: a tagged PDF (`page.getStructTree()` with
  children) exports to DOCX/MD/TXT straight from the tags instead of the layout heuristics. `flowDoc.ts`
  `buildMarkedContentMap(items)` splits a `getTextContent({includeMarkedContent:true})` stream into
  `MCID→RawTextItem[]` (each text item attributed to the INNERMOST enclosing MCID; a no-MCID marked region
  — `Artifact`/untagged — pushes a `null` stack spacer so its text is DROPPED, which is correct: PDF/UA
  artifacts are non-content). `structTreeToFlow(tree, mcMap, fonts, w, h, redactions?)` walks the role tree in
  document reading order → `H1`–`H6`→heading / `P`/`Note`/`Caption`/`Quote`→body / `L`+`LI`→list (depth from
  nesting, ordered/bullet from the Lbl/inline marker via `detectListPrefix`) / `Table`+`TR`+`TH`/`TD`→`FlowTable`
  grid (`THead`/`TBody`/`TFoot` row-groups recursed); `Figure` skipped (the raster image path handles it). It
  **returns null** when the tree is absent or resolves ZERO text → caller falls through to the heuristic →
  **byte-identical for untagged PDFs (~85% of files)**. Run quality is shared: `buildRunsFromLines` was
  EXTRACTED from `buildParagraph` (same color/super-sub/underline/gap-space/coalesce logic) and is reused by
  both paths. `reconstructPage` gained an optional `struct?: {tree, markedItems}` param: when set and the flow
  resolves, it returns `{paragraphs, tables, tagged:true}` (margins still computed from `words`) and SKIPS the
  column/heading heuristic; `assignHeadings` skips `page.tagged` pages (all 3 loops) so tag levels aren't
  clobbered. `exportService._extractFlowDoc` fetches `getStructTree()` first, and ONLY when it has children
  requests the marked-content text variant (filtering markers out for the heuristic/font path via `!('type' in
  it)`) — an untagged page keeps the plain `getTextContent()` call (byte-identical extraction). **Non-obvious:**
  (1) struct-tree leaves `{type:'content', id}` and `beginMarkedContentProps {id}` share the SAME id string
  (verified 100% on the w3c fixture) — direct map lookup, no fuzzy correlation; (2) text items have NO `type`
  key, markers do — that's the discriminator; (3) `FlowDoc`/`FlowPage` are export-transient (never persisted to
  IndexedDB) so `tagged` needs no SCHEMA bump. **Ceiling:** a partially-tagged page drops its untagged
  (artifact-classed) text by design (exact-replace contract); alignment/indent/spacing are NOT tag-derived
  (left, or right for RTL); a multi-column tagged page's reading order rides the writer's y-sort (monotonic for
  normal top-down docs). Gated purely by struct-tree PRESENCE (no feature flag). Guards:
  `tests/utils/flowDocStructTree.test.ts` (10: map attribution/nesting, heading/body/list/ordered/table/null/
  redaction, assignHeadings tagged-skip) + `tests/browser/docx-structtree.browser.test.ts` (2: real tagged PDF →
  H1 + `<w:tbl>`; untagged → `reconstructPage` byte-identical with vs without the struct arg). Spec:
  (see git history).
- **Arabic support (Sprint Arabic, 2026-06-15)** — three parts:
  - **DOCX export**: pdf.js returns RTL text in VISUAL order (each string bidi-reversed) tagged `dir:'rtl'`;
    Word re-applies bidi to `w:rtl` runs → double-reversal. `reverseRtlText` restores logical char order
    **and NFKC-normalizes** (P2, 2026-06-17) — many PDFs encode Arabic as Unicode PRESENTATION FORMS
    (U+FB50–FDFF / U+FE70–FEFF, pre-shaped glyphs); emitted verbatim they render disconnected in Word, so
    NFKC folds them to base letters (and expands ligatures, e.g. U+FEFB lam-alef → ل+ا) AFTER the reversal so
    a ligature's logical order stays correct. Guard: `tests/utils/flowDocArabic.test.ts`;
    `orderLineWords` orders an rtl line right-to-left (logical); **AR-1 (2026-06-15)** it now applies the
    UAX#9 L2 run-reversal at WORD level — an RTL line is segmented into same-direction runs and emitted
    right→left, but an embedded LTR run (Latin word / number) keeps forward order (the old blanket
    descending-x sort reversed it). Word-level only; `bidi-js` is installed but unused (a dedicated lib
    isn't needed for word granularity — deeper char-level bidi stays a documented partial). The writer emits
    complex-script attrs (`font.cs=Arial`, `bold/italics/sizeComplexScript`). All in `flowDoc.ts`/`flowDocWriters.ts`.
  - **True-edit**: `replaceTextAt` REFUSES Arabic new-text before the Latin Path-3 redraw (it would emit '?')
    → routes to the overlay (mirrors the Type3/vertical refusals). Faithful Path-2 subset-glyph reuse still
    runs first for in-subset edits. Guard: `isArabicText()` (defined in `flowDoc.ts`, imported by `contentStreamEditor.ts`).
  - **Overlay rendering** (`src/export/arabicOverlay.ts`): pdf-lib `drawText` CANNOT place shaped glyphs RTL
    (fontkit shapes logical-only; drawText paints LTR → mirrored). Fix: `font.encodeText(logical)` shapes
    (fontkit GSUB) + emits 2-byte subset CIDs **already in VISUAL order → do NOT reverse the CID pairs** →
    raw `Tj` via `page.pushOperators` against **Noto Naskh Arabic** (vendored **`src/assets/fonts/NotoNaskhArabic-Regular.ttf`**,
    OFL — `src/assets/fonts/OFL.txt`, lazy `?url`-fetched, embedded Type0/CID via `@pdf-lib/fontkit`; the embedded
    W-array advances glyphs). **MUST be a TTF/OTF, NEVER a `.woff`/`.woff2`** — fontkit/@cantoo-pdf-lib mis-embeds
    the WOFF1 of this font: the subset keeps only the `ا` glyph outline, every other glyph renders blank + a
    spurious 6th glyph + broken ToUnicode (`U+0002`). Root-caused live 2026-06-17 (pdf-lib's own `drawText` fails
    identically → font container, not RTL code); the prior `@fontsource/noto-naskh-arabic` woff dep is REMOVED.
    The TTF embeds cleanly (5 glyphs, full word renders, correct logical ToUnicode). Deps: `@pdf-lib/fontkit`
    (0 vulns; a single RTL run needs no bidi lib — `encodeText` is already visual; mixed LTR+RTL line reorder
    is a documented ceiling). `getArabicFont` is shared by the searchable-OCR Arabic layer, so this fix covers both.
    Browser-only (font fetch); wired in `pdfElementRenderer.ts` text branch, guarded by `isArabicText`,
    right-aligned. Guards: `tests/utils/flowDocArabic.test.ts`, `tests/export/arabicOverlay.test.ts`,
    `tests/browser/arabic-overlay.browser.test.ts` (rasterized: now asserts multi-glyph ink **width**, not just
    presence — catches the single-alef WOFF regression).
- **Cornerstone QA 2026-06-17 — RTL text-layer selection/copy/search + multi-language DOCX**:
  - **Text-layer selection / copy / search (RTL)**: pdf.js v6 builds the selection layer as one PER-GLYPH
    span, visual order, PRESENTATION FORMS, no spaces. (#6 `a293639`) a `copy` listener (`textLayer.ts._onCopy`)
    rebuilds logical, spaced, base-letter text from selected-span geometry via `reconstructLogicalText`
    (`rtlClipboard.ts`). (#6b `6e35874`) `TextSearchHandler.search` adds a normalized fallback — on a raw miss
    it matches the NFKC'd query against `reverseRtlText(str)` (visual→logical) + a plain NFKC fold (single
    glyphs / Latin ligatures like ﬁ), with an item-box highlight; LTR matching is byte-unchanged. (#6c
    `df21a26`) `alignSpanOrderToVisual` (in `textLayer.ts`, called at the end of `render`) re-appends spans in
    visual (top, then left) order so an Arabic drag-selection highlights without holes — DOM order was
    non-monotonic in x (measured 17/72 backward on one real-PDF line → ~45% of the band was gaps); after,
    72/0 monotonic, gaps 114px→21px. Spans are absolutely positioned (reorder is visually invisible); copy
    re-sorts by geometry (unaffected); the app's own search/highlight don't use pdf.js's findController. Gated
    to RTL/Arabic-DOMINANT pages (LTR multi-column reading order preserved). Ceilings: sub-character RTL
    highlight position is item-level; mixed LTR+RTL single-line bidi; SR reading order becomes visual L→R.
    Guards: `tests/utils/rtlClipboard.test.ts`, `tests/handlers/textSearchHandler.test.ts` (Arabic #6b),
    `tests/browser/arabic-selection.browser.test.ts` (#6c, real layout — jsdom can't lay out spans).
    **Cross-item Arabic search + multi-char copy fix (2026-06-21, `9b6fa35`+`2cfbb0f`):** the #6b
    per-item fallback found ZERO real Arabic matches — pdf.js splits a word across MANY per-glyph items, so a
    multi-glyph query never fits one `item.str`. KEY (verified live): pdf.js emits SINGLE glyphs in VISUAL
    position order but MULTI-char items/spans in NATIVE (LOGICAL) char order (the trailing "لام" of "السلام"
    is one logical-order item). So correct reconstruction orders tokens by READING POSITION (RTL → x-descending)
    and folds each NFKC-ONLY — NEVER reverses a token's internal chars (the old blanket `reverseRtlText(visual)`
    scrambled multi-char tokens: "السلام"→"السمال"). `TextSearchHandler.buildLogicalLines` (pure, exported) does
    this per-line with an item→offset token map → match maps to the covering items' union box; the Arabic line
    pass is gated to `isArabicText(query)` (Latin stays per-item, no double-count). `reconstructLogicalText`
    (copy) got the SAME no-internal-reverse fix → embedded LTR words/numbers ("PDFturbo"/"100%") now stay intact.
    This OVERTURNS the original #6b assumption (visual-order multi-char items) — its synthetic single-item
    fixture was unrealistic and was corrected to logical order. Selection ordering was already correct
    (`alignSpanOrderToVisual`); residual striped highlight at large fonts = inherent per-glyph-span SEAMS
    (cosmetic, not fixed). Ceilings: neutral bracket mirroring "(RTL)"→")RTL(" (UAX#9 L4), "الله" ligature
    reorder, multi-token LTR run order. Guards: `tests/handlers/textSearchHandler.test.ts` (per-glyph spanning),
    `tests/utils/rtlClipboard.test.ts` (multi-char span + embedded-LTR), `tests/browser/arabic-search.browser.test.ts`
    + `tests/browser/arabic-copy.browser.test.ts` (real pdf.js items). Fixture+gen: `scripts/gen-arabic-fixture.mjs`.
  - **Shared char-level bidi engine (Feature 3 Slice 1, `11a3253`)**: `src/utils/bidi.ts` adopts
    **bidi-js@1.0.3 (MIT, full UAX#9)** — promoted transitive(jsdom)→**direct prod dep**; `src/types/bidi-js.d.ts`
    supplies types (none upstream). FOUR functions: `logicalToVisual(text,base)` (typed/user text → display order,
    brackets mirrored via `getReorderedString`); `visualToLogical(text,base)` (pdf.js visual order → logical;
    BOUNDED inverse: reverse line + re-reverse maximal LTR-type runs *trimming boundary WHITESPACE* + un-mirror
    RTL-context brackets — LTR-base input is identity); `visualRuns(text,base)` (logical → runs in visual L→R
    order, each run's text LOGICAL so fontkit shapes Arabic / Helvetica draws Latin); `logicalItemOrder<T>(itemsLToR,
    isRtl)` (item-level UAX#9 L2 — RTL-item runs reversed, embedded LTR-item runs forward, item internals untouched).
    **All four Arabic surfaces now route through it:** overlay `drawBidiLine`→`visualRuns` (the OLD hand-rolled
    `segmentBidiRuns`/`baseIsRtl` are DELETED — do not reintroduce); copy `reconstructLogicalText`→`logicalItemOrder`
    (SPAN-level); search `buildLogicalLines`→`logicalItemOrder` (ITEM-level, token→item map preserved); DOCX
    `reverseRtlText`→`visualToLogical` **only when the word is mixed-script** (pure-Arabic incl. presentation
    forms/ligatures keeps the blanket char-reverse — its contract). **Non-obvious (TDD-discovered):** (1) bidi-js is
    logical→visual ONLY — the 3 read surfaces need the inverse, which is an APPROXIMATION (perfect inversion from
    visual order alone is impossible). (2) a char-level reorder SCRAMBLES pdf.js multi-char tokens (`لام`/`PDF` arrive
    as ONE logical-order span) and breaks search's char offsets → copy/search MUST reorder at ITEM granularity, never
    char. (3) boundary whitespace must stay put when re-reversing an LTR run (else an inter-word space migrates →
    `مرحباWorld `). Every engine call falls back to the raw string on a bidi-js throw (never regress below prior
    behavior). **Ceiling:** overlay bracket display-mirroring (fontkit draws the logical glyph; the string surfaces
    DO mirror), tashkeel GPOS, shaped-ligature reorder → Feature 3 Slice 3 (evaluate-then-defer). Guards:
    `tests/utils/bidi.test.ts` (13) + the per-surface guards (`rtlClipboard`/`flowDocArabic`/`textSearchHandler`) +
    the extended `tests/browser/arabic-overlay.browser.test.ts`. Spec/plan:
    (see git history).
  - **RTL-aware text toolbar (Feature 3 Slice 2, `ebae519`)**: `TextElement.direction?: 'auto'|'rtl'|'ltr'`
    (default `'auto'`, OPTIONAL, **no `SCHEMA_VERSION` bump** — `toJSON` omits when auto, `elementFactory`
    reads `?? 'auto'`). `resolveDirection(direction, text)` (in `textElement.ts`) = `'auto'` → `baseDirection(text)`
    (first-strong UAX#9, exported from `utils/bidi`). The editor `<input>.dir` is set from the resolved
    direction in `_applyInputFormatting` (fixes Arabic typing/caret). Toolbar `⇋ rtlBtn` (in the align group) →
    `app.toggleDirection` → `FormattingService.toggleDirection` (overrides the resolved direction to the
    opposite explicit value) / `setDirection` — each a `MoveResizeCmd` whose `before` carries BOTH
    `{direction, align}`, and which defaults a still-`'left'` align to `'right'` when the result resolves RTL
    (so undo restores both). `uiController.updateFormattingToolbar` reflects `rtlBtn` active via
    `resolveDirection(te.direction, te.text) === 'rtl'`. **Export is UNCHANGED** — `pdfElementRenderer.renderText`
    already auto-RTLs `isArabicText` lines via `drawArabicLine`; `direction` is editor + alignment only in v1
    (forcing the Arabic font path on non-Arabic text mis-renders — declined). **Gotcha:** any test that builds
    the uiController refs from a partial DOM must seed `'rtlBtn'` (else `getElementById` → null →
    `r.rtlBtn.disabled` throws). i18n `formatting.rtlTitle` (ar [Unverified]). Spec/plan:
    (see git history).
  - **Multi-language DOCX (#2 `9cfc38a`)**: Cyrillic + CJK source text is preserved verbatim through
    PDF→DOCX/MD/TXT — they're LTR like Latin, so they take the same reconstructPage + writer path and the only
    script branch (`isArabicText` RTL reorder) must not fire. CONTENT is intact (verified, no prod change).
    CJK font-FACE (a `w:eastAsia` font) is a documented ceiling: no universal CJK font name (forcing one risks
    Han-unification mis-render), and Word's fallback renders the codepoints. Guards:
    `tests/utils/flowDocCjkCyrillic.test.ts` (jsdom writer/reconstruct), `tests/browser/cyrillic-docx.browser.test.ts`
    (real pdf.js extract embedded-font Cyrillic → DOCX).
  - **Test-infra**: jsdom `testTimeout` 5s→30s (`a214076`) — node-forge RSA-2048 keygen tests flaked under
    full-suite CPU contention; mirrors the browser config (`87180d1`).
- **OCR (Sprint 4, 2026-06-15; CSP/engine fix 2026-06-15)**: `src/ocr/*` wraps **tesseract.js@7**
  (lazily loaded). `src/handlers/ocrHandler.ts` renders the current source page to a canvas at scale 2,
  recognizes words, and inserts them as real `TextElement`s via ONE `MacroCmd` (undoable, selectable,
  DOCX/MD-exportable) — not a bespoke overlay. `ocrWordToTextElement` is the pure bbox→element map
  (top-left origin both sides → no Y-flip). Wired: `ocrBtn` + `ocrModal`.
  **CSP/engine fix (found by /qa-sweep)** — OCR was non-functional in production for THREE reasons, all
  now fixed (guards: `tests/browser/ocr-csp.browser.test.ts` real-engine e2e, `tests/ocr/ocrCore.test.ts`):
  (1) **Assets must be 'self'-served** — the app CSP (`connect-src 'self' blob:`) blocks tesseract's CDN.
  `scripts/prepare-ocr-assets.mjs` (npm `ocr:assets`, run via predev/prebuild + a CI step before tests)
  vendors the worker + LSTM core wasm (from node_modules) + **best** traineddata (downloaded) for ALL 8
  advertised languages (eng/fra/ara/deu/spa/ita/por/nld — O1 fix 2026-06-15; `LANGS` MUST stay in sync
  with `OCR_LANGUAGES`, enforced by `tests/blockers/ocr.blockers.test.ts`)
  into `public/tesseract/` (gitignored). `ocrAssetPaths(import.meta.env.BASE_URL)` builds the local
  `corePath`/`workerPath`/`langPath`; NEVER reintroduce a CDN path (the `ocrAssetPaths` test guards this).
  **PWA caching (#48, 2026-06-16):** the SW precache `globIgnores:['**/tesseract/**']` keeps the OCR worker +
  `*.wasm.js` cores (which match the `**/*.js` glob) + traineddata OUT of the install payload (precache 16.5→5.0 MB);
  they're served via the `ocr-assets` CacheFirst runtime route on first OCR use. Tradeoff: OCR needs one online
  use before working offline. Guard: `tests/infra/pwaOcrCaching.test.ts`. NEVER drop `globIgnores` back (re-bloats install).
  (2) **Literal dynamic import** — `import('tesseract.js')` (NOT the old `@vite-ignore` indirect form,
  which left a bare specifier the browser couldn't resolve → "Failed to resolve module specifier").
  (3) **Word geometry needs `blocks: true`** — the engine uses `createWorker` + `worker.recognize(img, {},
  { text: true, blocks: true })` (the `recognize` convenience hardcodes `{text:true}` → empty words). v7
  returns words ONLY nested under `data.blocks[].paragraphs[].lines[].words[]`; `flattenBlockWords`
  (tesseractMapper) flattens them. Without this OCR completed but added 0 elements (silent "no text").
  OCR targets SCANNED/image pages — clear large text recognizes well; tiny/thin vector text may yield 0.
  **Searchable-OCR layer (SHIPPED 2026-06-16)** — `src/ocr/searchableTextLayer.ts`:
  `wordToTextPlacement` (OCR-px top-left → PDF-pt bottom-left: `x0/scale`, `pageHeight−y1/scale`
  baseline, `(y1−y0)/scale` size) + `buildInvisibleTextLayerOps` (`BT·Tr(3)·Tf·Tm·Tj·ET` per word,
  `arabicOverlay` `pushOperators` pattern + `setTextRenderingMode(Invisible)`) +
  `partitionWordsByFont` (Arabic→Noto Naskh / WinAnsi-Latin→Helvetica / else skipped) +
  `applySearchableLayerToPdf` (loads pdf-lib doc, embeds fonts, pushes ops, returns rewritten bytes;
  throws `SearchableLayerError('ROTATED_PAGE')` on rotated pages — bbox space ≠ unrotated PDF coords).
  Wired: `ocrHandler.run(lang, mode, onProgress)` with `mode:'visible'|'searchable'` (default
  `'visible'`); `'searchable'` swaps source bytes via the existing `_applySourcePdfEdit`
  (`ReplaceSourcePdfBytesCmd`, undoable + persisted). UI: `ocrModeSelect` in `ocrModal` (default
  "Searchable layer"); toasts `ocrSearchableDone`/`ocrRotatedUnsupported` (3 locales).
  **OCR usability (2026-06-20)**: the `ocrModeSelect` "Output" now offers FOUR destinations — the
  default **searchable layer** (recommended), **`docx`** (export to editable Word), **`text`** (copy +
  download `.txt`), and **`visible`** (editable boxes, relabeled "for clean pages, not scans" — it was
  the un-masked overlay that made a scan look unreadable; it's no longer the trap-default since
  searchable is first). `OcrOutputMode` stays `'visible'|'searchable'` — the two READ-ONLY exports are
  NOT handled by `run()`; `pdfTurboApp.runOcr` branches on the raw select value and routes `text`/`docx`
  to `OcrHandler.recognizeCurrentPage(lang,onProgress)` (extracted shared private `_recognize`; `run()`
  byte-identical, same guards + single-flight) → `ExportService.exportOcrText` (best-effort
  `navigator.clipboard` + `.txt` download; clipboard rejection in insecure contexts falls back to
  download-only) / `exportOcrDocx` (pure `ocrTextToFlowDoc(text)` in flowDoc.ts → `flowDocToDocxBlob`).
  Empty recognized text → `ocrNoText`/`exportNoText` warn, never an empty file. **Non-obvious:**
  `main.ts` flag-off path now explicitly sets `ocrModeSelect.value='visible'` after removing the
  searchable option (else the new `docx`/`text` options would become the default when `searchableOcr` is
  off). OCR→DOCX is a LINEAR reading-order transcription — the scan's column/table layout is NOT
  reconstructed (ceiling). Guards: `tests/utils/ocrTextToFlowDoc.test.ts`, `tests/export/ocrExport.test.ts`
  (clipboard fallbacks + docx-unzip), `tests/browser/ocr-export.browser.test.ts` (real engine → real .docx).
  **Latin-7 (eng/fra/deu/spa/ita/por/nld) is exact-searchable.** **Arabic is a documented PARTIAL:**
  recovers as real Arabic Unicode (selectable + screen-reader-accessible) but full-word exact search
  is imperfect — fontkit GSUB shaping yields contextual glyphs with incomplete pdf-lib ToUnicode (same
  ceiling as the visible Arabic overlay). A clean-ToUnicode PoC (per-codepoint isolated encoding) was
  tried + REJECTED: it traded the artifact for RTL order reversal in pdf.js `getTextContent`. Rotated
  pages: NOT yet supported (warn + skip). Guards: `tests/ocr/searchableTextLayer.test.ts` (14 jsdom:
  transform/partition/apply/rotation) + `tests/browser/searchable-ocr.browser.test.ts` (Latin exact +
  Arabic honest contract + invisible-ink). Verdict: (see git history).
- **E-signing (Sprint 4, 2026-06-15)**: `src/signing/*` produces a single visible PKCS#12/CMS signature
  via **node-forge@1.3.1** (dynamically imported; pure-JS, runs in jsdom AND browser). `PdfSigner.sign`
  reserves a fixed `/Contents` hex slot + `/ByteRange`, serialises without object streams, then splices the
  detached CMS. **"Sign WITH edits"**: `signingHandler.ts` signs `app.assemblePdfBytes()` (the shared
  downloadPDF assembly — edits/annotations/redactions/form-fills baked in — exposed on `exportService`),
  NOT the raw source. Encryption is intentionally NOT applied to the assembled bytes (the signer needs a
  plain stream for its ByteRange; encrypt-then-sign is out of v1 scope). Output is **download-only**
  (`<base>-signed.pdf`) — NO auto-resign (rejected as a security/trust anti-pattern: re-editing a signed
  PDF must visibly invalidate the signature, never silently re-sign). **Re-signing an already-signed PDF
  is refused (S3, 2026-06-15)**: the exported `isPdfSigned(bytes)` detects a `/ByteRange` + sig SubFilter and
  `PdfSigner.preflight` throws a typed `ALREADY_SIGNED` SignError (pdf-lib's full re-save would otherwise
  corrupt the existing ByteRange with an opaque crash). `.p12` bytes are zeroed after signing;
  the password field is cleared on close. `buildSignOptions` is the pure 1-based-UI→0-based-signer map.
  **S-FLOW cert-free pre-flight (2026-06-15)**: `PdfSigner.preflight(bytes, page, rect)` runs the
  cert-INDEPENDENT checks (already-signed + page-index + rect-bounds) and is called by `pdfTurboApp.signPdf`
  **BEFORE** any certificate is generated/loaded — so an off-page rect or already-signed PDF shows the error
  and bails WITHOUT downloading an orphan generated `.p12`/`.pem` (the prior bug). `sign()` reuses `preflight`
  internally (DRY; standalone API stays safe). The generate-mode password is **no longer wiped in the
  `finally`** (only on `closeSignModal`) — wiping it made a naive retry silently bail at the `if (!genPw)`
  guard while a stale error stayed on screen. `signingHandler.sign(form, preassembled?)` accepts the
  already-assembled bytes so the app preflights and signs the SAME bytes (one assembly). Guard:
  `tests/signing/preflight.test.ts`.
  Wired: `signBtn` + `signModal`; `SignErrorCode`→`sign.error.<CODE>` i18n.
  **Generate-a-cert-on-the-spot (2026-06-15)**: the sign modal has a source toggle —
  "Use my .p12" vs "Generate one now". `src/signing/certGen.ts` `generateSelfSignedP12`
  (node-forge, lazy) makes an RSA-2048 key + self-signed X.509 (full subject: CN/O/email/C)
  packaged as PKCS#12, feeds the SAME `PdfSigner` (no signer change — it only wants
  `{p12,passphrase}`), and the app downloads the `.p12` + `.pem` for reuse/sharing. Self-signed
  ⇒ readers show "validity unknown" until trusted (surfaced via `modal.sign.genTrustNote`).
  Guards: `tests/signing/certGen.test.ts` (round-trip: generated p12 actually signs) +
  `tests/browser/cert-gen.browser.test.ts` (real-Chrome keygen+sign).
  **NOT yet supported**: TSA timestamp, LTV/DSS, multi-signature rounds, CA-issued/trusted certs (v1 scope).
  **PAdES (ETSI.CAdES.detached) is a ceiling** with node-forge: its pkcs7 `_attributeToAsn1` can't add the
  ESS signing-certificate-v2 signed attribute PAdES-BES requires, so we keep the valid ISO 32000-1
  `adbe.pkcs7.detached` rather than emit a malformed PAdES. A real PAdES needs hand-rolled CAdES ASN.1.
- **Approval caption + guided Signers panel (F-D D1/D2)**: a drawn `SignatureElement` carries an OPTIONAL
  caption (`signer`/`mention` default "Lu et approuvé"/`signedDate`); `buildSignatureCaptionLines` (pure) is
  shared by the DOM render and the export bake (`pdfElementRenderer`) — caption ABSENT ⇒ byte-identical, and
  `toJSON` omits the keys unset (NO schema bump). D2 = `src/ui/signersPanel.ts` (👥 `signersBtn`, gated
  `VITE_FEATURE_SIGNERS`; mirrors batesPanel — own focus-trap/Esc/backdrop, no preview) is a **guided wizard**:
  fill name+mention(+date) → `buildSignerCaption` → arms `pendingSignatureCaption` → `setMode('addSignature')`
  opens the pad → `commitPlacement` (placementManager.ts:196) reads/applies `{...caption}` then CLEARS it.
  Repeat per signer — the PAGE is the roster (no separate list). **Non-obvious leak guard:** the plain ✍ click
  (toolBinder) + `S` shortcut (keyboardBinder) + pad-cancel (`SignatureManager.closeModal`) ALL clear
  `pendingCaption` first, so a plain signature can NEVER inherit a panel caption (provable invariant; guards in
  `tests/ui/signersPanel.test.ts`, `placementSignatureCaption.test.ts`, `keyboardBinder.test.ts`,
  `signatureManager.test.ts`). **Remote round-robin**: each signer draws → exports (D1 bakes the sig into page
  content) → sends to the next, who opens it and adds theirs; the 🔏 crypto seal applies ONCE, LAST (re-export
  after sealing invalidates it — `ALREADY_SIGNED`). Visible sigs = approval-stamp grade, NOT tamper-evident.
  **D3 spike (2026-06-18) — true N-party CRYPTO co-signing is REACHABLE, NOT a structural ceiling.**
  `src/signing/incrementalSigner.ts` (EXPERIMENTAL, **unwired**, `ALREADY_SIGNED` guard untouched) proves a 2nd
  independent CMS signature can be appended via a hand-built **append-only incremental update**: read structure
  with pdf-lib (never re-save) → append new sig dict + field + new-revision page/AcroForm + classic incremental
  `xref`/`trailer << … /Prev >>` → reuse `byteRange.ts` primitives + `buildDetachedCms`. The prior "ceiling" was
  mis-attributed: pdf-lib's `save()` renumbers objects (kills sig-1), but that's the *tool's serialiser*, not the
  PDF format. Sig-1 survives because its `/ByteRange` ends at the original EOF (untouched by the append). Guarded
  by `tests/signing/incrementalSigner.test.ts` (append-only prefix byte-identical, BOTH `/ByteRange` digests
  validate, pdf-lib re-parses). **Caveat:** proves ByteRange-digest correctness + append-only preservation;
  Adobe/DSS acceptance is UNVERIFIED in-repo (no Acrobat) → keep `ALREADY_SIGNED` until manual verification.
  **In-repo hardening H1–H4 DONE (2026-06-18, still unwired, `ALREADY_SIGNED` untouched):** **H1** NEW
  `src/signing/cmsVerify.ts` `verifyAllSignatures(bytes)` cryptographically re-checks EVERY embedded sig via
  node-forge `rawCapture` (no brittle `p7.verify()`) — messageDigest authAttr === SHA-256(ByteRange span) AND
  the authAttrs RSA-verify against the **CMS-embedded** signer cert (`p7.certificates[0]`); the auth-attrs are
  re-DER'd wrapped in a **UNIVERSAL SET (0x31)**, NOT the `[0]` IMPLICIT tag (the classic forge-verify trap) —
  a tamper test (flip a covered byte → `digestMatches:false`) proves it's real, not rubber-stamp. Kept OUT of
  the `index.ts` barrel (mirrors `incrementalSigner`). **H2** `addIncrementalSignature` now preflights via the
  shipped `validatePageIndex`/`validateRect` (typed `INVALID_PAGE`/`INVALID_RECT`) but deliberately does NOT
  call `isPdfSigned` (it MUST accept an already-signed PDF — that's the point). **H3** exported
  `assertClassicXref(bytes, startxrefOffset)` refuses xref-STREAM / hybrid inputs (peek at the offset, require
  the literal `xref` keyword) with NEW typed `SignError('UNSUPPORTED_XREF')` (added to the union + 3 locales,
  ar [Unverified]; `signingHandler` maps `sign.error.${code}` dynamically so it's additive). **H4** coverage:
  two DISTINCT certs (each sig verifies against its own embedded cert), triple-sign N>2 (3 ByteRanges valid,
  append-only prefix preserved), multi-page. `beforeAll` gets 60s (two RSA-2048 keygens; hookTimeout ≠ the 30s
  testTimeout). Classic-xref + ASCII-object only remains the documented input contract. Verdict:
  (see git history). **Approval model B (D1/D2) stays the default**
  for the no-backend tool; D3 is now an opt-in productionisation candidate. Editable free-text caption date = v1b.
  **Arabic `mentionDefault`/labels are [Unverified]** — need native review.
- **Per-page crop (#G23)**: `DocumentPage.crop?` is a rect in **unrotated content space** (y-down, top-left,
  relative to the source `getPageCropBox()` box) — rotation-invariant, so `rotatePage` is untouched and it
  persists via `toJSON`'s `pages` with **no SCHEMA_VERSION bump** (`documentLoader` assigns `pages` wholesale).
  The drawn rect arrives in editor DISPLAY space; `PageService.cropPage` maps it via `redactionRectToContent`
  (the SAME tested helper redactions use) + `clampContentRect`. Export: `buildPageOverlays` draws every overlay
  in source-box space FIRST, then `page.setCropBox(effBox)` **last** (via `contentCropToPdfCropBox`) — so
  element/ink coords are unaffected and the thumbnail + export-preview inherit the crop (they re-read
  `getPageCropBox`). **The redaction rasterizer does NOT use setCropBox** (#QA-2026-06-23 leak fix): it passes
  `buildPageOverlays({ skipCropBox: true })`, renders the FULL page, draws the burn at full-page coords (the
  already-correct path), then **clips the rendered CANVAS** to the crop window LAST (effBox corners → canvas px
  via `viewport.convertToViewportPoint`, rotation-correct). Burn and content thus share ONE coordinate space, so
  a non-zero crop offset can no longer drift the burn off the secret (the old `setCropBox`-before-render path
  rendered a cropped canvas but drew the burn at full-page coords → **misplaced burn = redaction LEAK** on a
  cropped page). Guard: `tests/browser/redaction-crop.browser.test.ts`. Bates/watermark switch to the crop's
  **effective box** (else they'd anchor in the now-clipped original corner); `effBox === cropBox` when no crop →
  **byte-identical export** (the rasterizer's no-crop path embeds the full canvas unchanged).
  Undoable via `SetPageCropCmd` (clone of `RotatePageCmd`); apply-to-all = a `MacroCmd` whose canvas re-render
  rides the CURRENT page's command (fires on execute AND undo). Live editor preview is a **dimmed-margin SVG
  frame** (`pageRenderPipeline._renderCropFrame`, mapped via `contentRectToDisplay`), NOT a pdf.js sub-region
  render (Design β). Tool mode `'crop'` rides `DrawingHandler` (pointerdown gate + `_updatePreview` + pointer-up
  branches). Gated `VITE_FEATURE_CROP` (#28; `main.ts` removes the button + `#cropControls` when off).
  **Ceiling (v1b):** resizable crop handles / numeric margins; aspect-aware apply-to-all.
- **PDF compress (#60)**: HYBRID modal (`src/ui/compressPanel.ts`, ⇩ export-flyout `compressBtn`, gated
  `VITE_FEATURE_COMPRESS`). Two strategies over the **assembled** export bytes (`assemblePdfBytes()` — edits
  baked in), wired as `ExportService.compressAndDownload(opts)`: (1) **lossless** "quick optimize" — re-load
  `{updateMetadata:false}` (MUST — else pdf-lib re-stamps `/Info` Producer+ModDate at load, undoing the strip,
  see [[reference_pdflib_updatemetadata_restamp]]) → `stripDocMetadata` (drops `/Info` + XMP `/Metadata` +
  trailer `/ID`) → `save({useObjectStreams:true})`; keeps text/vectors/forms. (2) **lossy** "flatten to images"
  — pdfjs renders each page to a JPEG at `dpiToScale(dpi)` (viewport honours page rotation → correctly
  oriented), rebuilds an image-only PDF whose pages keep their **point** dimensions (`getViewport({scale:1})`),
  drops selectable text. Pure helpers (`dpiToScale`/`clampDpi`/`clampQuality`/`stripDocMetadata`/
  `compressLossless`) live in `src/export/compress.ts` (jsdom-testable); the canvas raster loop is in
  ExportService (real-Chrome). **Non-obvious:** the export password (when set) is applied to the **same**
  `save({useObjectStreams:true})` as the optimization — a re-load-to-encrypt would default `useObjectStreams`
  back to false and undo the size win. Defaults **lossless** / **200 DPI / 0.8 quality** (conservative). Toast
  reports before→after size + % saved (`formatBytes`). **Ceiling #60b:** true in-place image-XObject
  downsampling (shrink only embedded rasters, keep text) — pdf-lib has no XObject-replace API.
- **DOCX read+edit (#1, Track B)**: a SEPARATE editor from the PDF pipeline (it edits a Word doc, not a
  PDF) — `src/docx/*`, gated `VITE_FEATURE_DOCX_EDIT` (#28 seam). Entry: file-menu `fileMenuEditDocx` →
  `createDocxEditorController` (lazy-imported on first click; `main.ts` removes the menu item when the flag
  is off). The controller is **self-contained** — it creates its OWN hidden file input + modal overlay
  (`.docx-editor-*` in `modals.css`), never touching `documentModel`/`uiController`, so opening a Word doc
  can't disturb PDF editing. **Modal a11y (#QA-2026-06-23 P1):** the controller ships its OWN Esc-to-close,
  backdrop-click-close (target===modal), and `trapFocus(panel, prevFocus)` (initial focus + Tab trap + focus
  restoration) — it is NOT in the central `keyboardBinder` Esc chain (self-contained by design). **Silent
  table-discard guard (#QA-2026-06-23 P1):** keyboard table/row deletion is possible (prosemirror-tables nodes
  are editable, no transaction-filter) but the in-place reconcile keeps the ORIGINAL tables on a count
  divergence — so the controller counts tables (`countTables`, recursive) at load vs save and warns
  `docxEditor.tableStructureUnsupported` instead of the misleading "saved" toast (the save still succeeds with
  the original tables; genuine block-on-delete is deferred). **Cardinal rule (spike verdict
  (see git history)):** edit `word/document.xml` IN PLACE in the
  unzipped OPC and re-zip — NEVER rebuild via the `docx` writer (it drops every unmodeled part:
  tables/styles/numbering/headers). `opcEdit.ts` = fflate(MIT) unzip + platform DOMParser edit + re-zip;
  `docModel.ts` models TOP-LEVEL `w:body` paragraphs with per-run **bold/italic/underline/fontFamily/fontSize**
  (`w:sz` is half-points → pt×2) and per-paragraph **heading (1–3, `w:pStyle`) + list (`w:numPr`, ordered=decimal
  vs bullet)** (everything else — tables/styles/numbering/headers — passes through verbatim); `docxProseMirror.ts`
  maps the FLAT model ↔ a NESTED ProseMirror(MIT) doc (headings + bullet/ordered lists via
  **prosemirror-schema-list**, MIT) + `mountDocxEditor`.
  **Save preserves per-run formatting** via `applyParagraphRuns(xml, paras, ids?)`: it clones the original
  first run's `w:rPr` (so unmodeled color/spacing survive), strips the model-managed toggles (`MANAGED_RPR` =
  b/i/u/rFonts/sz/szCs), re-adds b/i/u/font/size, and `sortRPrChildren` re-orders them into canonical CT_RPr
  order (rFonts,b,i,u,sz,szCs — underline is AFTER sz per ECMA-376) — NOT the older text-level
  `applyParagraphTexts` (which flattened a paragraph to one run). Paragraph props (heading `w:pStyle` + list
  `w:numPr`, `w:pPr` inserted as first child) are written ONLY when the `ids` arg is passed → without it the
  output is byte-identical to the #1c runs-only path.
  **Rich-text toolbar (Phase 2 Slice A)**: `docxToolbar.ts` `buildDocxToolbar(view)` — B/I/U (toggleMark) +
  heading select (setBlockType) + font/size selects (a custom `setMarkAttr` Command) + bullet/ordered buttons
  (`inList ? liftListItem : wrapInList`); active-state reflects after every transaction via a hooked
  `dispatchTransaction`. It rides on `DocxEditorHandle.toolbarDom` (built inside the lazy chunk, so the
  controller mounts it above the editor with NO extra dynamic import). `docxSchema.ts` extends schema-basic
  with the u/fontFamily/fontSize marks + `addListNodes(...)`. **opcParts.ts (inject-if-missing)**:
  `ensureHeadingStyles`/`ensureListNumbering` REUSE existing Heading1–3 / bullet+decimal numbering defs when
  present, else INJECT minimal spec-valid `<w:style>`/abstractNum+num (abstractNum BEFORE num; ids floored at
  100) and `registerPart` adds the Override to `[Content_Types].xml` + a Relationship to `document.xml.rels`
  (creating styles.xml / numbering.xml if absent); `buildNumberingMap` resolves numId→bullet|decimal on read.
  `save()` resolves these ids ONLY when the edited model actually uses a heading/list. **Ceiling (Slice A):**
  run formatting beyond b/i/u/font/size (color/highlight/strike), nested-list depth beyond `w:ilvl` round-trip,
  a styles-gallery UI, and table-cell editing — all deferred to later slices. **Lazy split (verified in `vite build`):** the
  controller chunk (~2.5 KB) loads on first menu click, the ProseMirror+model editor (~213 KB) on first
  document open — neither is in the initial bundle. Deps all permissive: prosemirror-* + prosemirror-schema-list
  (MIT), fflate (MIT), docx (MIT). **#1d DOCX→PDF export DONE:** `src/docx/docxToPdf.ts`
  is a PURE flow→PDF renderer (the sibling of `flowDocWriters.ts`) — `docModelToPdfBytes(model, opts?)` lays
  out the editable model with @cantoo/pdf-lib Helvetica StandardFonts (run-level tokenization → preserves
  inter-run spaces AND mid-word font changes; greedy word-wrap; hard-break of over-wide tokens; pagination;
  per-run bold/italic via the 4 Helvetica faces). `DocxEditorHandle.getModel()` returns the live model; the
  editor modal's "Export PDF" button (`docModelToPdfBytes` **dynamically imported** to keep pdf-lib lazy)
  downloads `<base>.pdf`. **WinAnsi-only:** StandardFonts encode CP1252, so `sanitizeWinAnsi` maps non-WinAnsi
  codepoints (CJK/Arabic/emoji) → `?` and the controller warns (`docxEditor.pdfUnsupportedChars`); French/
  German/Spanish accents are in CP1252 → intact. The `notify` seam was widened to `'warn'` (+ `main.ts` lambda).
  **DOCX→PDF fidelity (Workstream A, 2026-06-21):** the renderer now also draws **heading sizes**
  (`headingFontSize(level, base)` — H1/H2/H3 × 1.7/1.4/1.18, bold), **list markers** (`listMarkerText(ordered,
  ordinal, level)` — bullet `•` vs decimal/lower-alpha/lower-roman cycling per 3 levels, `makeListState()` ordinal
  counter, indent `INDENT_PER_LEVEL` per `list.level`), per-run **underline** (`page.drawLine` at baseline) and
  per-run **color**. Color is a full vertical slice: `DocRun.color?` (`#rrggbb`) ↔ OPC `w:color@w:val`
  (`docModel.ts` parse/`buildRun`, added to `MANAGED_RPR`) ↔ ProseMirror `color` mark (`docxSchema.ts`
  `cssColorToHex` + `docxProseMirror.ts` map) ↔ a color picker in `docxToolbar.ts` ↔ `_hexColor` in the PDF render.
  **DOCX→PDF fidelity (Feature 5, 2026-06-24) — fonts + merged cells + images NOW rendered:**
  (a) **Real font faces** — `resolveStandardFontFamily(family)` maps `DocRun.fontFamily` → Times (serif) /
  Courier (mono) / Helvetica (sans/unknown); all 12 non-symbol StandardFonts embedded up-front, `fontFor(family,
  bold,italic)` picks the 4-way variant (was: everything Helvetica). (b) **Merged-cell tables** — pure
  `buildCellGrid(t)` resolves the existing `DocCell.colspan`/`rowspan` (the 3c/3d shape, continuation cells
  ABSENT) onto a grid (walks rows skipping rowspan-occupied columns); `tableLayout` computes equal column widths
  + per-row heights (rowspan cells top up their LAST spanned row), and the renderer draws colspan cells `N*colW`
  wide and rowspan cells spanning the summed row heights (was: equal `max(cells)` columns → merged tables
  misrendered). (c) **Images** — `src/docx/docxImages.ts` `extractDocImages(opc.files)` reads `word/media` via
  `w:drawing`→`a:blip/@r:embed`→rels, sniffs PNG/JPEG, base64s + reads `wp:extent` EMU→pt; **kept DECOUPLED from
  the editable model** (the in-place `buildRun` save rewrites runs as text `w:r` — routing image bytes through
  the model would corrupt the `w:drawing`), exposed read-only via `DocxEditorHandle.getImages()` and passed to
  `docModelToPdfBytes(model, { images })`, which embeds (`embedPng`/`embedJpg`) + interleaves each image after its
  top-level `blockIndex`. **The save path + PM round-trip are UNTOUCHED → zero cardinal-rule regression.** Default
  `images:[]` → byte-identical for image-less docs. **Ceiling:** per-column `w:tblGrid` widths (equal columns
  only), a rowspan cell straddling a page break, images nested in table cells / inline-with-text / non-PNG-JPEG,
  per-run formatting beyond b/i/u/size/color/font-family, image positional drift after heavy editing (index-based),
  non-WinAnsi scripts → `?` (true face embedding is the future path); Approach B (docx-preview raster) remains the
  documented high-fidelity future alternative. Spec/plan: (see git history).
  Guards: `tests/docx/docxImages.test.ts` + the `resolveStandardFontFamily`/`buildCellGrid` cases in
  `docxToPdf.test.ts` + the image/colspan/serif cases in `tests/browser/docx-to-pdf.browser.test.ts`. Spec/plan: (see git history). Guards:
  `tests/docx/{docxEditor,docxEditorController,docModelRichText,opcParts,docxSchema,docxMapping,docxToolbar,docxToPdf}.test.ts`
  (jsdom), `tests/browser/docx-editor.browser.test.ts` + `tests/browser/docx-to-pdf.browser.test.ts`
  + `tests/browser/docx-toolbar.browser.test.ts` (real Chrome: toolbar drives bold+H1+bullet via genuine
  commands → save → reopen → formatting survives AND an untouched table passes through; the cardinal in-place
  rule), confirming selectable text, reading order, French fidelity.
  **Paste-from-Word (Slice C #1)**: `src/docx/wordPaste.ts` `cleanWordHtml(html)` is a PURE MSO sanitiser
  (platform `DOMParser`; strips `mso-*` style decls, `<o:p>`/`<xml>`/`<style>`/`<meta>`/office-namespaced tags,
  BOTH conditional-comment forms — downlevel-hidden `<!--[if]…<![endif]-->` removed, downlevel-revealed
  `<![if]…<![endif]>` UNWRAPPED so list bullets survive — empty `MsoNormal` spacers, `file://`/src-less images;
  keeps `data:`/`http(s):` images) wired as the EditorView `transformPastedHTML` hook (`docxProseMirror.ts`); the
  default DOMParser then parses through the EXISTING schema parseDOM (b/i/u/font/size/H1–6/lists/links) — NO new
  schema, NO new dep, NO new flag (rides `VITE_FEATURE_DOCX_EDIT`). Ctrl+Shift+V arms a one-shot `_plainPasteArmed`
  flag (keydown on `view.dom`) → `handlePaste` does `tr.insertText` (NOT `view.pasteText` — pasteText builds a
  `ClipboardEvent` internally, which jsdom lacks; insertText is jsdom-safe and correctly "match destination style":
  drops SOURCE formatting, inherits the cursor context). **Ceiling:** pasted tables fall back to ProseMirror default
  (grid dropped, cell text → paragraphs — feature #3 upgrades this); colour/highlight/strikethrough dropped (no
  schema mark); link URL survives in the editor but NOT the OPC save (`DocRun` carries no `linkUrl`). Guards:
  `tests/docx/wordPaste.test.ts` (7 jsdom: MSO strip + format survival + totality), `tests/docx/docxPaste.test.ts`
  (wiring + plain-text via fake event), `tests/browser/docx-paste.browser.test.ts` (real Chrome: `view.pasteHTML`
  real pipeline → bold/underline/list through save→reopen; plain-text drops formatting).
  **Find/replace (Slice C #2)**: a Word-style find & replace bar in the DOCX editor — plain + case +
  whole-word + **regex** (with `$1` capture-group replacement). Three units + wiring, NO new dep, NO new flag
  (rides `VITE_FEATURE_DOCX_EDIT`): (1) `src/docx/findReplace.ts` PURE core — `findMatches(doc,query,opts)`
  searches **per textblock** over the flattened `textContent` (so a match spans runs/marks), mapping string
  offsets → PM positions (`pos+1+offset`); regex compiles in try/catch → typed `{ok:false,error:'invalid-regex'}`
  (never throws), zero-length matches guarded; `expandReplacement` does `$n` substitution. (2)
  `src/docx/findReplacePlugin.ts` PM plugin — state `{active,query,replacement,opts,matches,activeIndex,error}`
  recomputed on query/opts change OR `tr.docChanged` (activeIndex clamped); a `DecorationSet` paints `.fr-match`
  + active `.fr-match-active`; commands `open/close/setFindQuery/setReplacement/findNext/findPrev/replaceCurrent/
  replaceAll`. **Replace inherits the marks at the MATCH START** (first char) — `replaceCurrent` deletes+inserts
  with `doc.resolve(from+1).marks()`; **`replaceAll` applies matches RIGHT-TO-LEFT in ONE transaction** (one undo
  step; earlier positions stay valid mid-apply, marks read from the original doc). (3) `src/docx/findReplaceBar.ts`
  the UI (find/replace inputs, case/whole-word/regex toggles, ▲▼, "n of m" counter, Replace/Replace-all, ✕);
  `Enter`/`Shift+Enter` = next/prev, `Esc` closes; invalid regex → red `.fr-error` field. (4) Wiring in
  `docxProseMirror.ts`: `findReplacePlugin()` + a `Mod-f`/`Mod-h` keymap that opens the bar via a forward-declared
  `barRef` (the keymap is built at state-create, before the view/bar exist); `DocxEditorHandle.findReplaceBar?`
  mounted by `docxEditorController.ts` below the toolbar; a CENTRALISED `dispatchTransaction` supersedes the
  toolbar's own hook to refresh BOTH toolbar + bar (setProps merges, so paste props survive). **Non-obvious:**
  the bar's `run()` calls `update()` after each command so the counter refreshes even in unit tests with no
  view-level hook; the central hook covers external doc edits. **Ceilings (v1):** matches do NOT cross paragraph
  boundaries (regex `^`/`$` anchor per block); replace formatting = match-start marks only (mixed-format matches
  collapse); table-cell text is not searched (tables aren't in the PM model until feature #3); PDF find/replace
  is the separate follow-up ("DOCX first, PDF after"). i18n `findReplace.*` in en/fr/ar (ar [Unverified]). Guards:
  `tests/docx/findReplace.test.ts` (15 pure), `tests/docx/findReplacePlugin.test.ts` (11), `tests/docx/findReplaceBar.test.ts`
  (7), `tests/browser/docx-find-replace.browser.test.ts` (real Chrome: Mod-f opens, decorations paint+cycle,
  replace-all keeps bold through save→reopen, table passes through).
  **C#2 hardening (2026-06-20):** (a) **match cap** — `findReplace.ts` exports `MAX_MATCHES=1000`; `findMatches`
  stops the descend + bounds each `matchBlock(…, limit)` at the cap and returns `truncated?:true`, threaded through
  the plugin state (`FindReplaceState.truncated`) so the bar counter shows `"n of 1000+"`. A broad query (`.`, `\s`,
  a lone letter) over a large doc would otherwise build tens of thousands of decorations + a giant replace-all tx =
  frozen tab; `replaceAll` now acts on the first batch (re-run for the rest). **Residual ceiling:** catastrophic
  backtracking *inside one `re.exec()`* is uninterruptable in synchronous JS without a Worker/RE2 (both excluded by
  the no-new-dep rule) — NOT defended, documented. (b) **`Mod-f` override is intentional and already focus-scoped** —
  a `prosemirror-keymap` handler fires only on editor-focused keydown, so native browser Find works everywhere except
  inside the open editor (the in-app-editor norm: Docs/VS Code/Notion). No new locale key (counter reuses
  `findReplace.counter` with a string `total`). Guards: the 3 truncation cases above (core+plugin+bar).
  **Table editing (Slice C #3a)**: `src/docx/*` extends the DOCX model to recursive `blocks: (DocParagraph | DocTable)[]` (replacing the flat `paragraphs` array, which is now a derived view for back-compat). `DocTable = { rows: DocRow[] }`, `DocRow = { cells: DocCell[] }`, `DocCell = { blocks: ... }` — nested tables are supported. The in-place save uses a table-anchored recursive reconciler `applyBlocks` in `docxMapping.ts` (partitions a container's `w:p`/`w:tbl` children into table-delimited paragraph segments; tables zip 1:1 by order and recurse into cells; cell paragraphs are rewritten in place via `applyParagraphRuns`; `w:tblPr`/`w:tblGrid`/`w:tcPr` structural/grid/styling elements are preserved verbatim — zero reconstruction). The **cardinal rule is maintained**: no docx-writer rebuild, only position-addressed in-place text edits. Schema integration via `prosemirror-tables@1.8.5` (MIT) — `tableEditing()` plugin + node specs merged into `docxSchema` (`docxSchema.ts`) supply cell selection/nav only (add row/col/merge/split NOT bound — structure read-only in 3a; 3b/3c/3d deferred). `docModelToDoc`/`docToDocModel` emit/read table nodes recursively; PDF export (`docxToPdf.ts`) reads the top-level `paragraphs` view only (table structure not rendered in v1). Find/replace now reaches cell text (the C#2 scope was lifted — `findMatches` descendants() recurses into cells; zero code change post-3a). Deps: prosemirror-tables (0 vulns; shipping MIT + attr). Gated by existing `VITE_FEATURE_DOCX_EDIT` (no new flag). Guards: `tests/docx/docModelTables.test.ts` (recursive model + populated paragraphs), `tests/docx/docxTablesMapping.test.ts` (in-place reconcile + nested round-trip), `tests/browser/docx-tables.browser.test.ts` (real Chrome: cell edit+format → save → reopen, nested table survives, structure byte-identical).
  **Table editing — Slice 3b (add/del row & column, 2026-06-23)**: the 3a "structure read-only" limitation is LIFTED for SIMPLE (un-merged) tables. `docxToolbar.ts` wires four prosemirror-tables commands — `addRowAfter`/`deleteRow`/`addColumnAfter`/`deleteColumn` (data-act = the command name; `update()` toggles `button.disabled` from `isInTable(view.state)` so they're greyed outside a table). The real work is `writeTable` in `docModel.ts`: it now reconciles row & cell COUNTS in place (NOT just the 1:1-min overlap) — extra rows cloned from the last `w:tr` (inherits cell `tcPr`/column structure), extra cells per row cloned from the row's last `w:tc`, trailing rows/cells removed, and `w:tblGrid` kept in sync (`syncTableGrid`: clone last `w:gridCol` to widen, trim to shrink — **no-op when the count already matches**, so a non-structural cell-text edit stays byte-identical and the 3a verbatim-structure tests still pass). **Cardinal rule preserved** — still in-place OPC surgery, never a docx-writer rebuild. **REFUSE gate (the 3b ceiling):** `tableHasMerges(tbl)` (a direct cell carries `w:gridSpan` or `w:vMerge`) → fall back to the 3a text-only min-reconcile (structure verbatim) — restructuring a spanned grid is deferred to **3c/3d (merge/split)**, which still need `DocCell` colspan/rowspan + the gridSpan/vMerge round-trip. The controller's `tableStructureUnsupported` warning is unchanged and still correct: row/col edits keep the table COUNT equal → the `saved` toast fires AND the change now genuinely round-trips (the prior silent-discard for same-count structural edits is fixed). i18n `docxToolbar.{addRow,deleteRow,addColumn,deleteColumn}` (ar [Unverified]). Mid-column-insert may shift a cell's `tcPr` (text content + column count stay correct) — documented ceiling. Guards: `docModelTables.test.ts` (add/del row+col, grid sync, merged-table refusal, byte-identical non-structural), `docxToolbar.test.ts` (the 4 acts dispatch), `docx-tables.browser.test.ts` (real Chrome: add-row via the toolbar button → save → reopen → 3 rows; buttons disabled outside a table). Verified live (synthetic table .docx, `qa-shots/f2-table-3b/`).
  **Table editing — Slice 3c/3d (cell merge & split, 2026-06-23)**: `DocCell` gains OPTIONAL `colspan?`/`rowspan?`
  (the **PM shape** — covered grid positions are ABSENT, matching prosemirror-tables AND `docToDocModel`; `toJSON`
  not involved — docx model isn't persisted to IndexedDB). `parseTable` (docModel.ts) reads `w:gridSpan`→colspan and
  resolves a `w:vMerge restart`+`continue` run→rowspan on the restart cell, **dropping the continuation placeholder
  cells** (`colCursor` sums gridSpans so a `continue` matches the restart open at the same start column). The PM bridge
  (`docxProseMirror.ts` `cellToNode`/`cellOf`) passes colspan/rowspan through the `table_cell` attrs. Toolbar adds
  **Merge cells**/**Split cell** (`mergeCells`/`splitCell`; data-act = command name; `disabled` mirrors the command's
  own applicability — probed via `cmd(view.state)` with no dispatch). `writeTable` now has THREE paths: simple table →
  the 3b path (byte-identical for non-structural); **merged table, layout UNCHANGED** → `reconcileMergedContent`
  (content-only, merge structure verbatim — cells line up 1:1 because parse drops continuations identically); **merged
  table, layout CHANGED** (a merge/split, detected by `gridSignature` divergence) → `rebuildMergedTable`. The rebuild
  walks the grid row-by-row: a model cell emits a `w:tc` with `w:gridSpan` (colspan) / `w:vMerge restart` (rowspan),
  columns covered by a rowspan-from-above emit a fabricated `<w:vMerge/>` continuation placeholder (`makeMergeCell`);
  grid width = `sumColspans(rows[0])`; `w:tblGrid` resized. **Cardinal rule preserved** — scoped in-DOM `w:tr`/`w:tc`
  surgery (cell CONTENT carried over via `reconcileContainer`), NEVER a docx-writer rebuild. **Supersedes the 3b
  merged-table REFUSE** at the SAVE layer (the rebuild handles merged-table row/col too, latent defense-in-depth) — but
  the toolbar still DISABLES row/col on a merged table (`currentTableHasMerges`), so v1's merged-table UI op is
  merge/split only. **Ceiling:** per-cell box `tcPr` (shading/width) is regenerated minimal on the rebuild path (a
  merge/split resets cell-box styling — content preserved); a pure text edit on a merged table keeps everything verbatim
  (the UNCHANGED path). i18n `docxToolbar.{mergeCells,splitCell}` (ar [Unverified]). Guards: `docModelTables.test.ts`
  (parse gridSpan/vMerge→colspan/rowspan; emit colspan→gridSpan, rowspan→vMerge restart+continuation, split re-expand,
  unchanged-merged verbatim, add-row-on-merged rebuild), `docxTablesMapping.test.ts` (colspan/rowspan PM round-trip),
  `docxToolbar.test.ts` (merge via CellSelection, split, enabled-probes), `docx-tables.browser.test.ts` (real Chrome:
  merge via toolbar → save → reopen → gridSpan/colspan survive). Verified live (`qa-shots/f2-merge-3cd/`: 2 header
  cells → 1 colspan-2 cell; 0 console errs).
  **Image & hyperlink preservation + display (Sub-project C Phase 1, 2026-06-26):** the DOCX editor's `save()`
  was **data-lossy** — verified by probe: an image-bearing top-level `w:p` parsed to `{runs:[]}` and `setRunsOn`
  wiped its `w:drawing` (image DESTROYED); a `w:hyperlink` survived but `parseParagraph`'s DEEP
  `getElementsByTagName('w:r')` counted its nested run, so save APPENDED a duplicate plain run (link text TWICE).
  Fix = a third OPAQUE `DocBlock` variant `DocImageBlock {kind:'image', image?, linkText?}` (sibling of `DocTable`).
  **The preservation guarantee is DOM-structural, NOT model-based:** `isAnchorParagraphEl(p)` (deeply contains
  `w:drawing` OR `w:hyperlink`) is checked at reconcile time, and `reconcileContainer` treats anchor `w:p` as
  immutable BOUNDARIES (like tables) — segmenting around them and NEVER passing them to `setRunsOn`, in BOTH the
  main path AND the count-mismatch fallback (`reconcileParagraphsOnly` now filters `&& !isAnchorParagraphEl(c)`).
  So an anchor `w:p` is preserved byte-exact even if the PM doc diverges (e.g. user "deletes" the read-only atom →
  it persists on save; true delete is Phase-2 C2). `parseContainerBlocks` emits `DocImageBlock` for anchors
  (linkText read from XML; image bytes MERGED later in `mountDocxEditor` by block index from the existing
  read-only `extractDocImages` channel — indices align: both walk `body` children filtering `w:p`/`w:tbl` in order).
  `docxSchema` gains read-only atom nodes `docx_image` (renders the real PNG/JPEG via a `data:` URI) + `docx_link`
  (shows link text); the PM bridge maps `DocImageBlock`↔atom (`imageBlockToNode`/`emitBlockTo`). `docxToPdf` SKIPS
  image blocks in its text-flow loops (the image is drawn via its own `imagesByBlock` channel — never as a
  paragraph). **Byte-identical when no drawing/hyperlink present** (the boundary set is then just tables, as before
  — guarded by a no-regression control test). `parseDocModel`'s `paragraphs` view excludes image blocks too
  (`!isDocTable && !isDocImageBlock`). **Ceiling (Phase 1):** a paragraph mixing flowing text + an inline
  image/link is read-only (whole anchor is opaque); anchors are non-deletable/non-reorderable; an image INSIDE a
  table cell is still PRESERVED byte-exact (cell anchor `w:p` skipped during cell recursion) but renders as an empty
  atom, not the picture (image bytes are merged only for TOP-LEVEL blocks — `extractDocImages` skips nested-in-table,
  the same ceiling as the PDF export); image EDITING (move/resize/delete) + EDITABLE links (`w:hyperlink`↔link-mark+rels
  round-trip) are Phase 2 (C2/C3). Spec/plan:
  (see git history).
  Guards: `tests/docx/{docModelImagePreserve,docxImageBridge}.test.ts` (jsdom: parse→block, drawing survives,
  hyperlink single-occurrence, byte-identical control, atom round-trip) + `tests/browser/docx-image-preserve.browser.test.ts`
  (real Chrome: img renders inline, link shown once, save round-trips drawing+blip+single hyperlink, plain para intact).
  **Editable external hyperlinks (Sub-project C Phase 2a, 2026-06-26):** EXTERNAL `w:hyperlink` (`r:id`→http/https/
  mailto) are now EDITABLE — they SUPERSEDE the Phase-1 hyperlink-opaque rule. `DocRun.linkUrl?` ↔ the
  prosemirror-schema-basic `link` mark (`href`). `isAnchorParagraphEl` now returns opaque ONLY for `w:drawing` OR a
  `w:hyperlink` that `isInternalOnlyHyperlink` (has `w:anchor`, NO `r:id`) — so an external-link paragraph parses as
  an editable `DocParagraph`. `parseParagraph` walks DIRECT children IN ORDER (not the old deep `getElementsByTagName`
  that double-counted), reading a `w:hyperlink`'s runs ONCE with `linkUrl` resolved from a rId→Target `linkMap`
  (`opcParts.buildHyperlinkMap`). On save, `setRunsOn` removes existing `w:r` AND `w:hyperlink` and re-emits, grouping
  maximal consecutive same-`linkUrl` runs into ONE `w:hyperlink` whose `r:id` comes from `DocApplyIds.links` (url→rId,
  resolved reuse-or-create by `opcParts.ensureHyperlinkRel`, `sanitizeLinkUrl`-gated in `mountDocxEditor.save()` — an
  invalid scheme drops to plain text, no rel). **De-dup is now STRUCTURAL** (read once / emit once), not opaque-skip.
  **Byte-identical when no run has a linkUrl** (`ids.links` empty → grouping no-ops). Toolbar 🔗 button (`docxToolbar`)
  + inline URL input: caret-in-link removes; else reveal input, Enter sanitizes + applies the `link` mark.
  INTERNAL-anchor (`w:anchor`) links stay opaque/preserved (Phase-1 `docx_link` atom) — editing them is the ceiling
  (also: mixed external+internal paragraph stays opaque; Word `Hyperlink` char-style not re-applied; field-code
  `HYPERLINK` instructions unhandled). Spec/plan: (see git history).
  Guards: `tests/docx/{docModelLinks,opcPartsHyperlink,docxToolbar}.test.ts` + `tests/browser/docx-links.browser.test.ts`
  (real Chrome: external link editable `<a href>`, internal read-only, save round-trips `w:hyperlink`+rels, toolbar
  add-link creates a relationship). NB Phase-1 hyperlink fixtures were switched to internal-anchor (the now-opaque case).
  **Image DELETE + RESIZE + editor undo (Sub-project C Phase 2b, 2026-06-26):** a TOP-LEVEL image anchor is now
  resizable + deletable; untouched images (and hyperlink anchors, tables, cell-nested images) stay byte-exact.
  **Identity:** `DocImageBlock.anchorId?` (OPTIONAL, **no `SCHEMA_VERSION` bump** — the docx model isn't persisted)
  = 0-based index among TOP-LEVEL drawing anchors, stamped at parse (`parseContainerBlocks(..., stampAnchorIds)` —
  body level only, so cell images get none and stay opaque), carried on BOTH the `docx_image` AND `docx_link` node
  (`anchorId` attr, default -1). **The link also carries it** because an unsupported-format / unextracted image
  (`extractDocImages` skips EMF/WMF/missing-media) falls back to a `docx_link` node — keeping its `anchorId` means the
  save pre-pass PRESERVES it instead of treating it as deleted (would have been a data-loss regression). **Save
  pre-pass** `reconcileImageAnchors(body, blocks)` in `applyBlocks`, GATED behind `opts.editImages` (only the editor
  save passes it; `applyParagraphRuns` and every other caller omit it → byte-identical, images verbatim — else the
  paragraphs-only path would see `S=∅` and DELETE every image). It deletes the `w:p` for an absent anchorId and
  rewrites `wp:extent` (+ inner `a:ext`) cx/cy ONLY when dims differ (byte-exact when unchanged; EMU=pt×12700).
  **SAFETY GUARD:** if surviving anchorIds aren't a duplicate-free subset of `{0..m-1}` → skip the pre-pass entirely
  (Phase-1 verbatim, never corrupt). `S` is identity-only (any block with a numeric anchorId); RESIZE additionally
  requires `image` (dims). **UI:** `src/docx/docxImageView.ts` NodeView — corner SE drag handle (px→pt ×0.75; base
  on the node's stored widthPt NOT getBoundingClientRect, which `max-width:100%` clamps; aspect-locked, Shift = free
  tracks dy independently) dispatching `setNodeMarkup`, + a ✕ button (`docxEditor.deleteImage`, ar [Unverified]) and
  Delete/Backspace on the selected atom. **Undo:** `prosemirror-history` (NEW dep, MIT) + `Mod-z`/`Mod-y` — the
  editor had NO undo before; resize/delete (and now typing) are undoable, composing with findReplacePlugin's
  single-tx replace-all. **Ceilings (v1):** image MOVE/reorder + new-image INSERT → v2; cell-nested images opaque;
  a MIXED image+text paragraph deletes WHOLE (the Phase-1 atom = the whole `w:p`, hidden text too — undo recovers;
  stripping just the drawing leaves a model-less text para the reconciler removes anyway). Guards:
  `tests/docx/{docModelImageEdit,docxImageBridge,docxUndo}.test.ts` +
  `tests/browser/docx-image-edit.browser.test.ts` (real Chrome: handles render, drag resizes pixels, Shift=free,
  ✕/Delete removes, save round-trips wp:extent/w:drawing, undo reverts). Spec/plan:
  (see git history).
  **Export-PDF staleness FIXED (follow-up C, 2026-06-26):** `docxToPdf.docModelToPdfBytes` now renders each
  `DocImageBlock` from its OWN live `image` data (`dataB64`/`mime`/`widthPt`/`heightPt`, round-tripped through the PM
  node) in the `model.blocks` loop — so an in-session **resize** (live dims) and **delete** (block absent) show in
  the exported PDF immediately, NOT only after save+reopen. The stale `getImages()`/`opts.images` second channel +
  the positional `imagesByBlock` map are GONE (`DocxToPdfOptions.images` removed; controller calls
  `docModelToPdfBytes(model)` with no images arg); `getImages()` stays on the handle, unused by export, for phase-B
  insert/move. At mount, `extractDocImages` bytes are still merged into the model's image blocks, so an UNEDITED
  export is byte-equivalent (every supported image still embedded, same place/size). A block with `image: undefined`
  (unsupported format / link-fallback / cell-nested) draws nothing — unchanged ceiling. Guards:
  `tests/browser/docx-to-pdf.browser.test.ts` (render-from-block / delete→no paintImageXObject / resize→wider
  painted image, all real pdf.js) + the jsdom no-throw case in `tests/docx/docxToPdf.test.ts`. Live eyes-on:
  `qa-shots/c-export-resized.pdf` (resized image baked into the exported PDF). Spec/plan:
  (see git history).
  **New-image INSERT (Sub-project B, sub-slice 1 of 4, 2026-06-26):** the DOCX editor can now INSERT a
  PNG/JPEG (📷 toolbar button → hidden file input → sniff magic bytes → `createImageBitmap` for natural
  px → `widthPt = min(px×0.75, 468pt)` proportional → a `docx_image` PM node with `anchorId: -1`). It
  renders inline immediately (the C2 NodeView) and survives `save()` as a brand-new `w:drawing` + `word/media`
  part + Content-Types Default + image rel. **Engine:** `opcParts.ensureImagePart(opc, bytes, mime) → {rId,
  target}` mints a fresh `word/media/imageN.png|jpg` (N = 1 + max existing), adds the Content-Types `Default`
  for the extension **once** (images are typed by Default, not Override), and a `…/relationships/image` rel.
  `docModel.materializeNewImageAnchors(mintImage, body, blocks)` is a save pre-pass that inserts a DOM `w:p`
  anchor (`buildDrawingParagraph` → minimal spec-valid inline pic) for every NEW image block (`kind:'image'`,
  `image` defined, **no** `anchorId`), placed by a per-block parallel walk of `blocks` vs the body's block
  children so boundary order lines up and `reconcileContainer`'s segment-zip stays aligned. **Minting is a
  CALLBACK** (`opts.mintImage?: (bytes, mime) => string`), NOT `opcParts` directly — `docModel` must not
  import `opcParts` (cycle); the editor save passes `mintImage: (b, m) => ensureImagePart(opc, b, m).rId`.
  **Ordering is load-bearing (deviates from the original spec):** `reconcileImageAnchors` runs FIRST (it keys
  on parse-time anchor POSITIONS — inserting a new anchor before an existing one would shift those positions
  and make it delete/resize the wrong anchor = data loss), THEN `materializeNewImageAnchors`, THEN
  `reconcileContainer`. **Byte-identical when no image is inserted** (materialize no-ops without a new image;
  legacy `applyBlocks` callers omit `mintImage`). A new image carries no `anchorId`, so `reconcileImageAnchors`
  (identity-only on numeric `anchorId`) never touches it during the same save; on the NEXT open it parses as
  an existing anchor with a fresh parse-time `anchorId`. **Ceiling (later sub-slices):** image MOVE/reorder
  (slice 2 ▲▼+Alt), cut&paste (3), drag (4) — all sharing one save-side reorder built in slice 2; inline-
  with-text insert, cell-nested insert, non-PNG/JPEG, dedup-by-content all out of scope. The toolbar exposes
  `insertImage(bytes, mime, widthPt, heightPt)` for tests; an undecodable image (`createImageBitmap` throws,
  caught) still inserts at 0 dims. i18n `docxToolbar.insertImage` (en/fr/ar, ar [Unverified]). No new feature
  flag (rides `VITE_FEATURE_DOCX_EDIT`); no `SCHEMA_VERSION` bump. Guards: `tests/docx/opcImagePart.test.ts`,
  `tests/docx/docImageInsert.test.ts` (incl. the insert-BEFORE-existing data-loss case that proves the
  ordering), the insertImage cases in `tests/docx/docxToolbar.test.ts`, and
  `tests/browser/docx-image-insert.browser.test.ts` (real Chrome: file-pick → render → save mints
  `w:drawing` + media part + Default + rel into a doc that had none). Live eyes-on: `qa-shots/b-insert/`.
  Spec/plan: (see git history).
  **Image MOVE/reorder (Sub-project B, sub-slice 2 of 4, 2026-06-26):** the DOCX editor can move an
  existing image up/down — **any distance, including crossing tables / other images** — persisted through
  the in-place `save()` with **full fidelity** (no other content rebuilt). UI = ▲/▼ buttons on the selected
  image's NodeView (beside C2's ✕/resize) + **Alt+↑/↓** when an image is selected; each press moves it past
  one adjacent top-level block. **PM side:** `src/docx/docxImageMove.ts` — `moveImageAt(state, pos, dir) →
  Transaction | null` (delete the node, re-insert before the prev / after the next top-level block, keep it
  NodeSelected; null at a bound → no-op) + `moveImage(dir): Command` (gated on a `docx_image` NodeSelection),
  one undoable transaction via the wired `prosemirror-history`. **Save side (the engine):** `applyBlocks`'
  `editImages` branch builds an `anchorEl: Map<anchorId, Element>` **once, pre-mutation** (the DOM is parse
  order, so `D[i]` has `anchorId i`) and shares it across two passes: `reconcileImageAnchors` (C2 delete/resize,
  **refactored from positional to map-keyed** — behavior-identical, removes the old "ordering is load-bearing"
  footgun) → `placeImageAnchors` (move existing by `anchorId` + insert new — **absorbs the former
  `materializeNewImageAnchors`**). `placeImageAnchors` walks the model blocks with a cursor over the body's
  **non-image-anchor** block children (text + tables + hyperlink anchors = fixed reference points, never
  touched); an existing image is **moved** (`body.insertBefore` re-parents the element in place), a new image
  is **inserted** (mint via the `opts.mintImage` callback — `docModel` still must not import `opcParts`, the
  cycle). Then `reconcileContainer` runs **unchanged**. **Why full fidelity:** only image `w:p` elements
  relocate, so after placement the boundary order matches the model and the segment-zip is all in-place
  `setRunsOn` — a displaced paragraph's unmodeled `pPr` is **not** rebuilt (a strict improvement over a
  reorder-then-reconcile-shuffle approach). **`applyBlocks` always re-parses the pristine `originalXml`**, so
  multiple session moves compose and there's no mid-session `anchorId` churn (on the next open the doc
  re-parses and anchorIds are reassigned by the new order). **Byte-identical when nothing
  moved/inserted/deleted** (all passes no-op; legacy `applyParagraphRuns` omits `editImages`). C2 SAFETY GUARD
  (model image anchorIds ⊆ map keys, dup-free) still bails to verbatim. **Ceiling:** moving tables/paragraphs
  themselves, move-to-top/bottom, multi-select move; cell-nested images stay opaque/non-movable; cut&paste
  (slice 3) + drag (slice 4) reuse `placeImageAnchors`. No new dep, no `SCHEMA_VERSION` bump, rides
  `VITE_FEATURE_DOCX_EDIT`. i18n `docxEditor.moveImageUp`/`moveImageDown` (ar [Unverified]). Guards:
  `tests/docx/docImageMove.test.ts` (engine: move past text with `pPr` survival, cross-table, swap, move+insert,
  byte-identical, map-keyed delete/resize regression), `tests/docx/docxImageMove.test.ts` (command bounds +
  selection gate + undoable + NodeView ▲/▼ present), `tests/browser/docx-image-move.browser.test.ts` (real
  Chrome: move past a table round-trips through save). Live eyes-on: `qa-shots/b-move/move-controls.png`.
  Spec/plan: (see git history).
  **Image cut & paste (Sub-project B, sub-slice 3 of 4, 2026-06-26):** the DOCX editor supports
  Ctrl/Cmd+**X/C/V** on a selected image and **paste of an external image blob** (OS "copy image" /
  screenshot), persisted through the in-place `save()`. **Adds NO new save logic** — three small
  ProseMirror-layer hooks (new `src/docx/docxImagePaste.ts`) route a pasted image into the *existing*
  slice-1/2 `anchorId:-1 ⇒ mint-fresh` insert path. **The bug it fixes:** `docx_image` has a `toDOM`
  but had no `parseDOM`, and PM's native copy preserves attrs → an intra-editor COPY duplicates
  `anchorId` (two nodes both `anchorId:0`) → at save, `placeImageAnchors`' dup-free guard trips → the
  save **bails to verbatim** → the pasted copy is silently dropped. **Fix = every PASTED image arrives
  with `anchorId:-1`** so the save mints fresh OPC media instead. Three units: (1) `resetPastedImageAnchors(slice)`
  wired as the `transformPasted` PM prop — walks the pasted fragment and rebuilds every `docx_image` with
  `anchorId:-1`; PM runs `transformPasted` on the FINAL slice for BOTH the intra-editor slice path AND the
  HTML-parse path, so one hook covers copy/paste AND cut/paste; (2) a scoped `parseDOM` on the `docx_image`
  schema node — `img[data-docx-image]` with a `data:image/png|jpeg` src only (`priority:60` to win over
  prosemirror-schema-basic's inline `image` rule `img[src]`; `getAttrs` returns `false` for any non-data
  src so an arbitrary web `<img>` NEVER matches) → `{mime,dataB64,anchorId:-1}`; (3) a `handlePaste`
  image-blob branch (AFTER the existing Ctrl+Shift+V plain-text check) — `firstImageFile(clipboardData)`
  (files then items, png/jpeg) → `insertImageBlob` (slice-1 dims: `createImageBitmap`, `PT_PER_PX=0.75`,
  `CONTENT_WIDTH_PT=468`, catch→0 dims) → insert `docx_image` `anchorId:-1`. **Cut needs no new wiring** —
  it is PM-native copy+delete: the original's `w:drawing` is removed by `reconcileImageAnchors` (its anchorId
  vanishes from the model), the pasted copy re-mints → move-via-clipboard (old media part orphaned, same as a
  C2 delete). The shared image primitives (`sniffImageMime`/`imgBytesToB64`/`imageDimsPt` + the PT consts)
  were LIFTED from `docxToolbar.ts` into `docxImagePaste.ts` (toolbar now imports them — behavior-identical,
  the 📷 Insert button unchanged). No new dep, no `SCHEMA_VERSION` bump, rides `VITE_FEATURE_DOCX_EDIT`.
  **Ceiling:** `http(s)` `<img src>` from web HTML (CORS — can't read the bytes client-side, never matched);
  GIF/SVG/WebP (only PNG/JPEG minted, matches the slice-1 sniff); orphaned-media GC after a cut (no part GC
  in v1); mixed text+image HTML fragments (an embedded image embeds only if it is a `data:`-uri
  `<img data-docx-image>`). Guards: `tests/docx/docxImagePaste.test.ts` (jsdom: `resetPastedImageAnchors`
  reset + non-image untouched, `parseDOM` data-uri parse + http/no-attr rejection, `firstImageFile`,
  `transformPasted` wired) + `tests/browser/docx-image-cutpaste.browser.test.ts` (real Chrome: copy→paste →
  **two** `w:drawing` after save = no verbatim-bail; cut→paste → one relocated; eyes-on before/after shot).
  Live eyes-on: `qa-shots/b-cutpaste/{before-one-image,after-two-images}.png`. Spec/plan:
  (see git history).
  **Image drag-to-reorder (Sub-project B, sub-slice 4 of 4 — COMPLETES follow-up B, 2026-06-26):** drag an
  image with the pointer to reorder it among the document's **top-level** blocks, with a live drop-indicator
  line, persisted through the in-place `save()`. **Custom pointer drag** (NOT native HTML5 drag) on the
  `<img>` body — the `.se` resize handle / ✕ / ▲▼ children keep their own events, so image-body=move vs
  SE-handle=resize is a clean element-level hit-test. **No new save logic** — reuses the slice-2 path:
  `placeImageAnchors` already relocates a top-level `w:drawing` by `anchorId`. Two new PURE helpers in
  `docxImageMove.ts`: `moveImageToGap(state, pos, gap)` (generalizes `moveImageAt`'s ±1 to an arbitrary
  top-level block gap ∈ [0, childCount]; null on the image's own gap `g===ci||g===ci+1` or a non-top-level
  target; `moveImageAt` was **refactored to delegate** — `dir -1 → gap ci-1`, `dir +1 → gap ci+2` — so slice-2
  ▲▼/Alt stay byte-green) + `dropTargetIndex(view, clientY)` (nearest top-level gap, counting block midpoints
  above the pointer via `coordsAtPos` — top-level only, so a drop can never target a cell/inline position the
  save can't represent). `docxImageView.ts`: pointerdown on the `<img>` records start X/Y but does NOT
  preventDefault (a plain click must still select via PM); past a **5px threshold** it enters drag mode
  (`.docx-image-dragging` dims the image) and renders a single reused `.docx-image-drop-line` (2px accent line,
  `pointer-events:none`) at the gap; pointerup → `moveImageToGap(…, dropTargetIndex(…))` (no-op if it's the
  image's own gap) or, below threshold, nothing (a click). The drop-line is appended to `view.dom.parentElement`,
  which is set `position:relative` for the duration of the drag (restored on clear) so the absolute `top`
  anchors correctly. One `prosemirror-history` undo step (same as ▲▼/resize). No new dep, no `SCHEMA_VERSION`
  bump, rides `VITE_FEATURE_DOCX_EDIT`. **Ceiling:** drag into/out of a table cell (top-level only), drop at an
  arbitrary inline position, touch-drag auto-scroll on very long docs (drop still computes; no auto-scroll),
  multi-image drag-select. Guards: `tests/docx/docxImageMove.test.ts` (jsdom: `moveImageToGap` front/end/middle/
  own-gap/clamp, `moveImageAt` slice-2 regression, `dropTargetIndex` above/below/between with stubbed coords,
  NodeView sub-threshold-click no-move) + `tests/browser/docx-image-drag.browser.test.ts` (real Chrome: drag
  below a table → `w:drawing` relocated after save; sub-threshold click → unmoved; eyes-on dim + drop-line shot).
  Live eyes-on: `qa-shots/b-drag/{dragging,drop-indicator}.png`. Spec/plan:
  (see git history).

## Git & CI

- Single branch `master`; pushing to it triggers `.github/workflows/deploy.yml`:
  `npm audit --audit-level=high` → type-check → lint → test (jsdom) → `ocr:assets` +
  `playwright install-deps chromium` → test:browser (real Chrome) → build → GitHub Pages
  deploy. The workflow also declares a `pull_request: [master]` trigger, but the project
  is single-dev/single-branch so in practice every run is a push to `master` — there is
  **no human PR review gate** (the local pre-push hook is the safety net; see below).
- **Supply chain (#37)**: `npm audit --audit-level=high` runs first and is **deploy-blocking**
  (a high/critical advisory fails the build before anything deploys). It was briefly disabled
  (`e154540`, 2026-07-28) and **restored the same day** once the blocker was root-caused — keep it on.
  **What the blocker was, so it is recognised next time:** 8 "high" findings that were really ONE
  advisory counted at 8 levels of a single chain — `brace-expansion` (GHSA-mh99-v99m-4gvg, DoS/OOM)
  ← `minimatch` ← `filelist` ← `jake` ← `ejs` ← `@trickfilm400/rollup-plugin-off-main-thread`
  ← `workbox-build` ← `vite-plugin-pwa`. Only ONE vulnerable copy was installed
  (`filelist/node_modules/brace-expansion@2.1.2`; the hoisted copy was already patched), it is
  **devDependency-only**, and `npm audit fix` could not touch it: ERESOLVE, because
  `vite-plugin-pwa@1.2.0` peer-requires `vite ^3–^7` while this project is on `vite@8`.
  **The fix is the `overrides` block in `package.json`** (`"brace-expansion": "^5.0.8"`) — it pins the
  transitive dep without touching `vite-plugin-pwa`, so the peer conflict never arises. Result:
  one deduped copy at 5.0.8, `npm audit` clean, PWA build unaffected. **Do not remove that override**
  without re-checking the advisory; reach for the same pattern the next time a transitive dev-dep
  advisory is unfixable through the dependency that pulls it in. OCR traineddata stays SHA-256-pinned
  (`scripts/prepare-ocr-assets.mjs`); no other remote assets are fetched at build.
- **Pre-push gate**: `.githooks/pre-push` (auto-installed via the `prepare` script →
  `core.hooksPath`) runs type-check + lint + test locally before any push reaches the
  auto-deploy. Bypass in emergencies with `git push --no-verify`.
- Commit style: `feat:` / `fix:` / `refactor:` / `docs:` prefixes, imperative subject.
  No Co-Authored-By trailers.
- `git push` is always manual (run it yourself when asked).

## Claude config in this repo

- `.claude/settings.json` — pre-approved read-only/build commands + deny list + hooks
- `.claude/hooks/oxlint-on-write.sh` — lints any `.ts` file Claude edits with oxlint, feedback on fail
- `.claude/hooks/locale-sync-check.sh` — 3-way key diff on any `locales/*.json` write
- `.claude/settings.local.json` is gitignored — machine-local overrides go there
