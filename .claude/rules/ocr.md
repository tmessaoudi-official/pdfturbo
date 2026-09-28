---
paths:
  - "src/ocr/**"
  - "src/handlers/ocrHandler.ts"
---

# pdfturbo gotchas — ocr

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: OCR engine, CSP and assets. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### OCR (Sprint 4, 2026-06-15; CSP/engine fix 2026-06-15)

`src/ocr/*` wraps **tesseract.js@7**
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
**"Visible" words on a user-rotated page (A3, 2026-09-26):** the OCR canvas is rendered at the page's
INTRINSIC `/Rotate` only, while elements live in display space at `/Rotate + docPage.rotation`. A plain
`bbox / scale` is therefore right only at user rotation 0 (kept exactly there). Otherwise
`ocrWordToTextElement` takes the reading size from the bbox, maps the bbox CENTRE through `_recognize`'s
`toDisplay` — the exact inverse of the redaction burn (`viewport.convertToPdfPoint` → subtract the
CropBox origin → `inverseTransformPoint`) — and sets `rotation = userRot`. Two test traps: the oracle
must be the TRUE turned box, because `rotatedElementFootprint` is the grow-only leak-filter union and
cannot equal it at 90/270; and on a `/Rotate 90` source the fixture's target must be drawn TALL in user
space so it is a horizontal word on the canvas the engine reads (a vertical "word" at 64pt overruns the
page and pdf.js truncates it). Guards: `tests/browser/ocr-visible-rotation.browser.test.ts` (10 + 2
visual; intrinsic 0/90 × user 0/90/180/270 + two CropBox-origin cases). Sabotage: user-rotation term
dropped → 8 (the two user-0 controls stay green); rotation negated → exactly the six 90/270 cases (180
is sign-blind); CropBox origin dropped → exactly the two crop cases. **Bound:** the engine still reads the
canvas at the intrinsic `/Rotate`, so a page the user turned upright is recognised sideways.
**Searchable-OCR layer (SHIPPED 2026-06-16)** — `src/ocr/searchableTextLayer.ts`:
`wordToTextPlacement` (OCR-px top-left → PDF-pt bottom-left: `x0/scale`, `pageHeight−y1/scale`
baseline, `(y1−y0)/scale` size) + `buildInvisibleTextLayerOps` (`BT·Tr(3)·Tf·Tm·Tj·ET` per word,
`arabicOverlay` `pushOperators` pattern + `setTextRenderingMode(Invisible)`) +
`partitionWordsByFont` (Arabic→Noto Naskh / WinAnsi-Latin→Helvetica / else skipped) +
`applySearchableLayerToPdf` (loads pdf-lib doc, embeds fonts, pushes ops, returns rewritten bytes;
remaps a cardinal `/Rotate` (90/180/270) into unrotated PDF coords and throws
`SearchableLayerError('ROTATED_PAGE')` only when `/Rotate` is not a multiple of 90 — a malformed page).
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
pages ARE supported for a cardinal `/Rotate`; only a non-multiple of 90 warns and skips (corrected by
limits row 30 — this line said "NOT yet supported" long after the remap shipped, and so did the toast). Guards: `tests/ocr/searchableTextLayer.test.ts` (32 jsdom:
transform/partition/apply/rotation) + `tests/browser/searchable-ocr.browser.test.ts` (Latin exact +
Arabic honest contract + invisible-ink).
