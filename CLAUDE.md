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
│   ├── pdfTurboApp.ts      # app orchestration hub (~580 lines after Wave 0–10 refactor)
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
  `downloadPage`, `downloadPageAsImage` on `pdfTurboApp.ts` (lines ~570-572) are now thin
  one-line delegators to `_exportService`; the shared rotation/cropbox/watermark/ink logic
  lives once in `src/export/exportPipeline.ts` (`buildPageOverlays`) + `exportService.ts`
  helpers (`_applyOverlaysToPage`, `_savePdfDocAndDownload`). Apply export fixes in
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
  `tests/browser/issue2-true-edit.browser.test.ts`. **Text modes are SEPARATE (Sprint 3, reverted the
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
  `isVerticalWritingFont` + `renderMode` on `TextOpInfo`.
- **Private-method convention**: `_underscore` prefix throughout; oxlint's `no-unused-vars`
  allows unused args/vars only when `_`-prefixed (`argsIgnorePattern`/`varsIgnorePattern`).
  `no-underscore-dangle` is deliberately OFF in `.oxlintrc.json` so it doesn't fight this convention.
- **PDF→DOCX/MD export (beta)**: `src/utils/flowDoc.ts` reconstructs a flow model
  (lines→paragraphs→headings/styles/RTL/lists/2-column) from pdf.js text items;
  `flowDocWriters.ts` emits DOCX (via `docx` npm, **dynamically imported** — keep it that
  way, it's a ~395 KB lazy chunk) + Markdown + TXT. Source-PDF text only — overlay
  annotations are NOT exported. Heuristic thresholds are font-size-relative.
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
  **export-path dedup** — extracted `_applyOverlaysToPage` + `_savePdfDocAndDownload` helpers
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
  **Reachable, still queued** (file:line + fix in `research-2026-06-15/01-docx-gaps.md` / `02-trueedit-matrix.md`):
  underline/strike (geometric), super/subscript, spot-color/Separation black-collapse, rotated-image sizing,
  list marker→continuation merge; true-edit Path-3 fill-color canvas-sample, number-tokenizer exponent.
  **Ceiling** (genuinely hard client-side): lattice/borderless tables, vector→raster, recursive 3-col
  XY-cut, RTL logical reorder, exact subset-font faces; true-edit cm-rotation Path-3 redraw, Type3, Arabic.

## Git & CI

- Single branch `master`; pushing to it triggers `.github/workflows/deploy.yml`:
  type-check → lint → test → build → GitHub Pages deploy. There is no PR gate.
- Commit style: `feat:` / `fix:` / `refactor:` / `docs:` prefixes, imperative subject.
  No Co-Authored-By trailers.
- `git push` is always manual (run it yourself when asked).

## Claude config in this repo

- `.claude/settings.json` — pre-approved read-only/build commands + deny list + hooks
- `.claude/hooks/oxlint-on-write.sh` — lints any `.ts` file Claude edits with oxlint, feedback on fail
- `.claude/hooks/locale-sync-check.sh` — 3-way key diff on any `locales/*.json` write
- `.claude/settings.local.json` is gitignored — machine-local overrides go there
