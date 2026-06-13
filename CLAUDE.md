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
npm run lint         # eslint .
npm run test         # vitest run (jsdom)
npm run test:watch   # vitest watch mode
```

**Before every commit**: `npm run type-check && npm run lint && npm run test` — this is
exactly what CI runs; a failure pushed to `master` blocks the deploy.

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

## Gotchas (verified by the 2026-06-11 craftsmanship review — docs/reviews/)

- **Three duplicated export paths**: `downloadPDF`, `downloadPage`, `downloadPageAsImage`
  in `pdfTurboApp.ts` triplicate rotation/cropbox/watermark/ink logic. Any export fix
  must be applied to ALL THREE (or the long-term fix: extract the shared pipeline).
- **`renderElements()` destroys and recreates every element DOM node** on each call.
  Focus-restoration hacks depend on this; keyed identity is NOT preserved.
- **i18n**: every user-visible string goes through `t()`; `escapeValue: false` is set, so
  NEVER interpolate user-controlled data into a translation that lands in `innerHTML`.
  The three locale files must stay key-identical (a hook checks this on write). Arabic
  values still need native-speaker review before being treated as final.
- **Base path is `/pdfturbo/`** (vite.config.ts) — asset URLs and SW scope depend on it.
- **PWA is `registerType: 'autoUpdate'`** — every push to `master` deploys AND silently
  updates open client sessions. Treat pushes to master as production releases.
- **Tests run in jsdom**: canvas rendering, real PDF rasterization, and pointer gestures
  are not exercised. `pdfTurboApp.ts` has near-zero unit coverage — editor-level changes
  need manual browser verification (`npm run dev`) in addition to the test suite.
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
- **Private-method convention**: `_underscore` prefix throughout; eslint allows unused
  args only when `_`-prefixed.
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
  **Phase 4 roadmap** (still pending): images (`getOperatorList` OPS.paintImageXObject →
  canvas bitmap → `ImageRun` in DOCX; requires `FlowImage` node in FlowDoc model; canvas
  unavailable in jsdom — browser-QA only), lattice tables (vector path grid detection —
  complex, low priority).

## Git & CI

- Single branch `master`; pushing to it triggers `.github/workflows/deploy.yml`:
  type-check → lint → test → build → GitHub Pages deploy. There is no PR gate.
- Commit style: `feat:` / `fix:` / `refactor:` / `docs:` prefixes, imperative subject.
  No Co-Authored-By trailers.
- `git push` is always manual (run it yourself when asked).

## Claude config in this repo

- `.claude/settings.json` — pre-approved read-only/build commands + deny list + hooks
- `.claude/hooks/eslint-on-write.sh` — lints any `.ts` file Claude edits, feedback on fail
- `.claude/hooks/locale-sync-check.sh` — 3-way key diff on any `locales/*.json` write
- `.claude/settings.local.json` is gitignored — machine-local overrides go there
