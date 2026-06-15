# Searchable-OCR Layer — Spike Verdict (2026-06-15)

**Verdict: PASS.** The invisible-text mechanism works. Proceed to the full feature.

## What was validated
The risky question — *does invisible (`3 Tr`) text emitted at OCR word bboxes become
selectable/searchable at the correct on-page position?* — is answered **yes**, proven
end-to-end in real Chrome.

- **Mechanism:** `src/ocr/searchableTextLayer.ts`
  - `wordToTextPlacement(bbox, scale, pageHeight)` — pure OCR-pixel (top-left) → PDF-point
    (bottom-left) transform: `x = x0/scale`, `baselineY = pageHeight − y1/scale`,
    `size = (y1−y0)/scale` (floored at 1pt).
  - `buildInvisibleTextLayerOps(words, {scale, pageHeight, font, fontKey})` — emits
    `BT · Tr(3) · Tf · Tm · Tj · ET` per non-empty word (same `pushOperators` pattern as
    `arabicOverlay.ts`, plus `setTextRenderingMode(Invisible)`).

## Evidence
- **jsdom unit** `tests/ocr/searchableTextLayer.test.ts` (7 tests): transform math, per-word
  op count, empty-word skipping, `3 Tr` mode on every word. Confirmed RED before the module
  existed, then green.
- **real-Chrome** `tests/browser/searchable-ocr.browser.test.ts` (1 test): build a page → lay
  invisible text → save → reopen with **pdf.js** → assert (a) both words recovered by
  `getTextContent()` [selectable], (b) `transform[4]/[5]` within 0.5 pt of the expected coords
  [correct position], (c) rasterized page has **0 dark pixels** [truly invisible].
- Full suite after: type-check ✓, oxlint ✓, jsdom 1056 + 2 expected-fail, browser ✓. No
  regressions; new files only.

## pdf.js coordinate convention (pinned by this spike)
`getTextContent()` returns each item's `transform` in PDF user space, y-up, origin at the text
matrix — so `transform[4] == x` and `transform[5] == baselineY` exactly as emitted (no viewport
flip applied at the content level). Future work can rely on this.

## Full feature SHIPPED (2026-06-16)
The spike was promoted to the full feature in the same session:
- `partitionWordsByFont` (Arabic → Noto Naskh / WinAnsi-Latin → Helvetica / else skipped) +
  `applySearchableLayerToPdf` (rewrites source bytes; `throw SearchableLayerError('ROTATED_PAGE')`).
- `ocrHandler.run(lang, mode, onProgress)`, `mode:'visible'|'searchable'` (default `'visible'`);
  searchable swaps bytes via the existing undoable `_applySourcePdfEdit`.
- UI `ocrModeSelect` (default "Searchable layer") + `ocrSearchableDone`/`ocrRotatedUnsupported` toasts ×3 locales.
- Tests: 14 jsdom + 2 browser; full suite 1063+2 jsdom, 36 browser — all green, no regressions.

### Arabic clean-ToUnicode PoC — tried & REJECTED (evidence)
- Default shaped encoding: `مرحبا` recovers as `مرحبا` (logical order, one stray control char
  from a fontkit GSUB contextual glyph whose pdf-lib ToUnicode is incomplete).
- PoC: per-codepoint *isolated* encoding (single-char `encodeText`, in-cmap glyphs) → cleaner codepoints
  BUT recovers REVERSED (`ابحرم`) — pdf.js applies RTL reordering in `getTextContent` — and still a stray
  ``. Two distinct hard problems (bidi reorder + residual non-cmap glyph) ⇒ not cleanly feasible
  without a custom ToUnicode CMap + bidi handling (rabbit hole).
- **Decision:** keep shaped logical-order (better for screen-reader / partial selection) and ship Arabic
  as a **documented partial** (selectable real Arabic Unicode; exact full-word search imperfect — same
  ceiling as the visible Arabic overlay). Latin-7 is fully exact-searchable.

## Future follow-ups (out of scope — feature itself is DONE)
1. **Rotated-page support** — map OCR bboxes through the page `/Rotate` (cardinal angles) into
   unrotated PDF coords; currently warn + skip.
2. **Arabic exact search** — custom ToUnicode CMap (+ bidi handling) so full-word Arabic search
   matches; today Arabic is a documented selectable-but-not-exact-searchable partial.
3. **Width-fit (Tz)** — horizontally scale each word to its bbox width so selection rectangles hug
   the glyphs tightly (today position is exact, width approximate — sized by height only).
