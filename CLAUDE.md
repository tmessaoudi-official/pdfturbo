# CLAUDE.md — PDFturbo

Client-side PDF editor (edit, annotate, sign, fill, redact, export) running 100% in the
browser — no backend, nothing uploaded. TypeScript + Vite + PWA, deployed to GitHub Pages.
Stack: pdfjs-dist (rendering), @cantoo/pdf-lib (export/encryption), i18next (EN/FR/AR with
RTL), IndexedDB (session persistence), bwip-js + qr-code-styling (barcode/QR tool).

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

**Before every commit**: `npm run type-check && npm run lint && npm run test` — this is
exactly what CI runs; a failure pushed to `master` blocks the deploy.

**Browser harness** (`vitest.browser.config.ts`): real-browser regression tests for things jsdom
cannot exercise — canvas/pdf.js rasterization, pointer drag, image (`commonObjs`/`VideoFrame`)
extraction, content-stream edits verified by pixels. Uses the system Google Chrome via Playwright's
`channel: 'chrome'` (no browser download). **CI runs it** (deploy.yml: after the jsdom suite, before
build, using the runner's system Chrome). Run it locally for any editor/export/DnD change. Guards
ISSUE-1..5 (see `KNOWN_ISSUES.md`).

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
docs/plans/                 # working plan files; docs/reviews/ — audit reports
```

- Undo/redo: every mutation goes through a Command object pushed to `historyManager` —
  never mutate `documentModel` directly from a handler without a command, or undo breaks.
- Handlers receive the concrete `PDFTurboApp`; its public surface is effectively the
  app-wide API. Adding handler↔app interactions widens this coupling — prefer extending
  an existing seam.

## Gotchas (verified by the 2026-06-11 craftsmanship review, refreshed 2026-06-14 — docs/reviews/)

- **Export paths are consolidated** (the historic triplication is RESOLVED): `downloadPDF`,
  `downloadPage`, `downloadPageAsImage` on `pdfTurboApp.ts` are now thin
  one-line delegators to `_exportService`; the shared rotation/cropbox/watermark/ink logic
  lives once in `src/export/exportPipeline.ts` (`buildPageOverlays`) + `exportService.ts`
  helpers (`_applyOverlaysToPage`, `_saveOrDownload`). Apply export fixes in
  `exportService`/`exportPipeline`, not in three places.
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
  enhancement). Only `downloadPDF` is rewired; `downloadPage`/sanitize/DOCX still plain-download.
  Open-via-picker + recent-files deferred (#54b).
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
  history stack by design). See `docs/reviews/2026-06-11-pdf-text-editing-verdict.md` for
  remaining limitations (cm transforms, XObjects, Helvetica fallback font — Phase B/C).
  **ISSUE-2 fix (2026-06-14):** `replaceTextAt` has 3 paths — (1) literal byte-swap, now GATED by
  `isByteSwapUnsafeFont()` so it NEVER runs for subset/CID/embedded fonts (byte≠glyph there → was the
  heading "data-loss" bug); (2) subset glyph reuse via ToUnicode (keeps original font for in-subset
  edits); (3) standard-font redraw emitted as in-stream text operators in ONE `writeBack` (do NOT use
  pdf-lib `page.drawText` after `setPageContent` — it orphans the redraw). XObject-embedded targets
  refuse before blanking (no delete-without-replacement). Guarded by
  `tests/browser/issue2-true-edit.browser.test.ts`. **Honest fallback (#1, 2026-06-17):** maximal
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
  (`detectListPrefix`) — see `docs/reviews/2026-06-11-pdf-to-docx-verdict.md`.
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
  **Fidelity scorecards** (honest done/reachable/ceiling): `docs/reviews/research-2026-06-15/scorecard-*.md`.
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
  **Latin-7 (eng/fra/deu/spa/ita/por/nld) is exact-searchable.** **Arabic is a documented PARTIAL:**
  recovers as real Arabic Unicode (selectable + screen-reader-accessible) but full-word exact search
  is imperfect — fontkit GSUB shaping yields contextual glyphs with incomplete pdf-lib ToUnicode (same
  ceiling as the visible Arabic overlay). A clean-ToUnicode PoC (per-codepoint isolated encoding) was
  tried + REJECTED: it traded the artifact for RTL order reversal in pdf.js `getTextContent`. Rotated
  pages: NOT yet supported (warn + skip). Guards: `tests/ocr/searchableTextLayer.test.ts` (14 jsdom:
  transform/partition/apply/rotation) + `tests/browser/searchable-ocr.browser.test.ts` (Latin exact +
  Arabic honest contract + invisible-ink). Verdict: `docs/reviews/2026-06-15-searchable-ocr-spike-verdict.md`.
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
  by `tests/signing/incrementalSigner.test.ts` (7: append-only prefix byte-identical, BOTH `/ByteRange` digests
  validate, pdf-lib re-parses). **Caveat:** proves ByteRange-digest correctness + append-only preservation;
  Adobe/DSS acceptance is UNVERIFIED in-repo (no Acrobat) → keep `ALREADY_SIGNED` until manual verification.
  Classic-xref + ASCII-object only; inputs unvalidated (spike). Verdict:
  `docs/reviews/2026-06-18-incremental-multisign-spike-verdict.md`. **Approval model B (D1/D2) stays the default**
  for the no-backend tool; D3 is now an opt-in productionisation candidate. Editable free-text caption date = v1b.
  **Arabic `mentionDefault`/labels are [Unverified]** — need native review.
- **Per-page crop (#G23)**: `DocumentPage.crop?` is a rect in **unrotated content space** (y-down, top-left,
  relative to the source `getPageCropBox()` box) — rotation-invariant, so `rotatePage` is untouched and it
  persists via `toJSON`'s `pages` with **no SCHEMA_VERSION bump** (`documentLoader` assigns `pages` wholesale).
  The drawn rect arrives in editor DISPLAY space; `PageService.cropPage` maps it via `redactionRectToContent`
  (the SAME tested helper redactions use) + `clampContentRect`. Export: `buildPageOverlays` draws every overlay
  in source-box space FIRST, then `page.setCropBox(effBox)` **last** (via `contentCropToPdfCropBox`) — so
  element/ink coords are unaffected and the redaction rasterizer + thumbnail + export-preview all inherit the
  crop (they re-read `getPageCropBox`). Bates/watermark switch to the crop's **effective box** (else they'd
  anchor in the now-clipped original corner); `effBox === cropBox` when no crop → **byte-identical export**.
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

## Git & CI

- Single branch `master`; pushing to it triggers `.github/workflows/deploy.yml`:
  `npm audit --audit-level=high` → type-check → lint → test (jsdom) → `ocr:assets` +
  `playwright install-deps chromium` → test:browser (real Chrome) → build → GitHub Pages
  deploy. The workflow also declares a `pull_request: [master]` trigger, but the project
  is single-dev/single-branch so in practice every run is a push to `master` — there is
  **no human PR review gate** (the local pre-push hook is the safety net; see below).
- **Supply chain (#37)**: `npm audit --audit-level=high` runs first and is **deploy-blocking**
  (a high/critical advisory fails the build before anything deploys). OCR traineddata is
  SHA-256-pinned (`scripts/prepare-ocr-assets.mjs`); no other remote assets are fetched at
  build. Periodically review `npm audit` output for advisories below the `high` threshold.
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
