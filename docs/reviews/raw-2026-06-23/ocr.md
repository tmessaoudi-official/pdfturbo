# OCR domain QA — raw findings (2026-06-23)

Reviewer: skeptical senior code review pass.

## Files read

- `src/ocr/ocrEngine.ts` (the prompt's "ocrCore" — actual name is ocrEngine)
- `src/ocr/tesseractMapper.ts`
- `src/ocr/searchableTextLayer.ts`
- `src/ocr/languages.ts`
- `src/ocr/ocrTypes.ts`
- `src/ocr/index.ts`
- `src/handlers/ocrHandler.ts` (contains the `ocrAssetPaths` fn the prompt named separately)
- `src/core/pdfTurboApp.ts` (`runOcr`, `openOcrModal`, `closeOcrModal`)
- `src/main.ts` (flag-off reset, lines 123–129)
- `index.html` (ocrModal markup, lines 634–669)
- `scripts/prepare-ocr-assets.mjs` (LANGS + SHA-256 pins)
- `tests/blockers/ocr.blockers.test.ts` (LANGS sync invariant)
- `src/export/exportService.ts` (`exportOcrText` / `exportOcrDocx`)
- `src/core/pageRenderPipeline.ts` (rotation composition)
- `src/ui/binders/{toolBinder,modalBinder}.ts`

## Verdict: domain is clean. No P0/P1. Two P2/P3 observations only.

All the prompt's specific concerns check out as CORRECT:

### CSP — assets self-served, no CDN reintroduced  [Verified — clean]
- `index.html:5` CSP is `connect-src 'self' blob:` — no `tessdata`/`jsdelivr`/`projectnaptha`
  host in `index.html` or `vite.config.ts`.
- `ocrEngine.ts` forwards `corePath`/`workerPath`/`langPath` verbatim (lines 145–153) and the
  loader is a literal `import('tesseract.js')` (line 101) — the `@vite-ignore` indirect form that
  broke module resolution is gone, documented inline.
- `ocrAssetPaths(base)` (ocrHandler.ts:82) builds only same-origin `${base}tesseract/...` paths.
- The one remote ingress (traineddata download) is build-time only and SHA-256-pinned
  (`prepare-ocr-assets.mjs:53–80`), with cached-copy re-verification each run.

### LANGS in sync with OCR_LANGUAGES  [Verified — clean]
- `prepare-ocr-assets.mjs:44` `LANGS = ['eng','fra','ara','deu','spa','ita','por','nld']`
  exactly matches `OCR_LANGUAGES` (languages.ts:24–33), the `ocrLangSelect` options
  (index.html:640–647), and `TESSDATA_SHA256` keys.
- `tests/blockers/ocr.blockers.test.ts` enforces `advertised ⊆ vendored` AND
  `advertised === vendored` (no orphan) AND `length === 8` — a real drift guard, not theatre.

### 4-output-mode select routing  [Verified — clean]
- `runOcr` (pdfTurboApp.ts:666–706): `text`/`docx` → `recognizeCurrentPage` (read-only, no doc
  mutation) → `exportOcrText`/`exportOcrDocx`; `visible`/`searchable` → `run(mode)`.
- `mode = (sel === 'visible' || !isEnabled('searchableOcr')) ? 'visible' : 'searchable'`
  (line 686) — defence-in-depth: even if the flag-off `<option>` removal failed, a stale
  `searchable` value still routes to `visible`.

### Flag-off default reset  [Verified — clean]
- `main.ts:123–129`: removes the `searchable` option AND explicitly sets
  `ocrModeSelect.value = 'visible'`. Without that explicit set, the browser would auto-select
  the next option (`docx`) as default — the comment calls this out exactly. Correct.

### Rotated-page handling (warn + skip)  [Verified — clean]
- `applySearchableLayerToPdf` (searchableTextLayer.ts:297–299) refuses ONLY non-cardinal
  `/Rotate` via `SearchableLayerError('ROTATED_PAGE')`; cardinal 90/180/270 are remapped to
  unrotated user space (`rotateBBoxToUnrotated`, lines 158–187 — corner-mapped then
  re-min/max-normalized). `runOcr` catches the typed error and shows
  `toast.ocrRotatedUnsupported` (line 696–697), else generic `toast.ocrFailed`.

### Empty-text → no empty file  [Verified — clean]
- Read-only path: `if (!result || !result.text.trim()) warn('toast.ocrNoText'); return`
  (pdfTurboApp.ts:681). `exportOcrText`/`exportOcrDocx` also independently guard
  `if (!body) warn('toast.exportNoText'); return` (exportService.ts:876, 900).
- `run()` paths return word count; `runOcr` warns `ocrNoText` when `n === 0` (line 692).

### Single-flight guard  [Verified — clean]
- `OcrHandler._running` gate at the top of BOTH `run` (line 149) and `recognizeCurrentPage`
  (line 256), set/cleared in `try/finally`. UI also disables `runOcrModal` + `ocrBtn`
  (pdfTurboApp.ts:673–674) and re-enables in `finally`. The comment (lines 127–130) explains
  the WASM-worker-doubling + double-commit risk it prevents. Authoritative backstop is correct.

### Silent no-op (recognize completes, 0 elements)  [Verified — clean]
- The historic "blocks:true missing → 0 words silently" trap is fixed:
  `worker.recognize(image, {}, { text: true, blocks: true })` (ocrEngine.ts:167) +
  `flattenBlockWords` (tesseractMapper.ts:60) flattens the v6 nested geometry, with a legacy
  flat-`words` fallback (line 131). 0 words → `ocrNoText` toast, never a false success.

### Worker lifecycle  [Verified — clean]
- A fresh worker per run, `terminate()` in `finally` (ocrEngine.ts:172–179) wrapped so a
  terminate failure can't mask the result. No persistent-worker leak.

### Undo / data-safety  [Verified — clean]
- Visible mode: one `MacroCmd` of `AddElementCmd`s through `historyManager.execute` (ocrHandler.ts:205) — single undo.
- Searchable mode: byte-swap via `_applySourcePdfEdit` (`ReplaceSourcePdfBytesCmd`, undoable +
  persisted); if the swap is discarded it returns 0 placed so the toast doesn't lie (lines 196–197).
- No destructive-without-backup path.

---

## P2 — Visible-mode OCR misplaces words on a USER-rotated page (DOCUMENTED ceiling, but worth surfacing)

**File:** `src/handlers/ocrHandler.ts:99–121` (`ocrWordToTextElement`) + `_recognize` (line 226).

**Evidence:** `_recognize` renders with `pdfPage.getViewport({ scale })` — NO `rotation:` arg, so
pdf.js uses only the page's *intrinsic* `/Rotate`, ignoring the user's in-app `docPage.rotation`.
But the element layer is composed at the FULL effective rotation
(`pageRenderPipeline.ts:128` `effectiveRotation = page.rotate + (docPage.rotation ?? 0)`).
So if the user rotates a scanned page 90° in-app, visible-mode OCR boxes land rotated/offset.

The code comment (lines 99–106) explicitly documents this:
> "Aligning the visible path with a non-zero USER rotation is a follow-up (G15b)."

**Why only P2:** This is a documented, tracked ceiling (G15b), not an undocumented defect, and the
common case (no user rotation) is correct. Searchable mode is unaffected (it writes unrotated source
coords). Recommendation: surface a one-line `toast` (or disable visible mode) when
`docPage.rotation` is non-zero, so the user gets feedback rather than silently-misplaced boxes —
the silent-misplacement is the only UX gap.

---

## P3 — `exportOcrText` clipboard write can silently land outside transient activation

**File:** `src/core/pdfTurboApp.ts:679–682` → `src/export/exportService.ts:873–889`.

**Evidence:** `runOcr` does `recognizeCurrentPage(...)` (multi-second, with progress) THEN
`exportOcrText(result.text)` which calls `navigator.clipboard.writeText`. By then the transient
user activation from the "Run OCR" click has typically expired, so on some browsers
`writeText` rejects. This is HANDLED — the try/catch (exportService.ts:884) falls back to
`copied = false` and the `.txt` download still happens, with `toast.ocrTextExported` instead of
`toast.ocrTextCopied`. So the user still gets the file; only the "copied to clipboard" convenience
silently degrades.

**Why only P3:** No data loss, no broken core; the `.txt` download is guaranteed, and the toast
honestly reflects which outcome occurred. Genuinely minor. Recommendation: none required; if
clipboard reliability matters, the copy could be moved to a fresh user gesture (a "Copy" button on
the result toast), but that is gold-plating for a no-backend tool.

---

## Things explicitly checked and found NOT to be issues
- Locale parity: all 9 OCR toast keys + 4 `modal.ocr.mode*` keys present in en/fr/ar (Arabic
  values flagged [Unverified] for native review per project convention, not a parity bug).
- Modal a11y: `ocrModal` has `role="dialog" aria-modal="true" aria-labelledby`; `openOcrModal`
  installs `trapFocus` and `closeOcrModal` cleans it up; Esc handled in `keyboardBinder.ts:35`.
- XSS: recognized text becomes `TextElement.text` (DOM `textContent`, not innerHTML) and DOCX
  via the `docx` writer — no innerHTML sink. OCR text is user/page data, not interpolated into i18n.
- Supply chain: tesseract.js dynamic-imported; traineddata SHA-256-pinned and re-verified.
