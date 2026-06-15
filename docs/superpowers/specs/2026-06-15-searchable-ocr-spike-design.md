# Searchable-OCR Layer — Validation Spike (design + plan)

**Date:** 2026-06-15
**Topic:** searchable-ocr-spike
**Status:** Designed — approved, pre-implementation
**Type:** Spike (validate the risky mechanism before committing to the full feature)

## Decisions Log
- [2026-06-15] AGREED: Next-work item #1 = Searchable-OCR layer; start with its validation spike (per the recorded sequence in `docs/plans/qa-fixes-2026-06-15.plan.md`).
- [2026-06-15] AGREED: Spike scope = **pure mechanism only** — one pure function + tests; NO app/UI wiring, NO SourcePdf swap, NO toggle. (User picked "Pure mechanism only".)
- [2026-06-15] AGREED: Design approved as written — baseline = bbox bottom, font = standard Helvetica/ASCII, both a jsdom coordinate-math unit test AND a real-Chrome pdf.js round-trip test. (User picked "Approve — write spec & build".)

## The risky question this spike answers
Does invisible PDF text (text render mode `3 Tr`) emitted at the OCR word bounding boxes
over a scanned page become **selectable / searchable at the correct on-page position**
when a PDF reader re-parses the document?

Everything else in the eventual feature (visible-vs-invisible toggle, undo, DOCX export
wiring, UI) is plumbing the codebase already does. The coordinate transform + render-mode
mechanism is the only genuinely unproven part — so it is validated first, cheaply.

## Feasibility already confirmed (pre-spike)
- `@cantoo/pdf-lib` exports `setTextRenderingMode` and `TextRenderingMode.Invisible` (= 3).
  [Verified: `node -e` printed the enum + function types.]
- `src/export/arabicOverlay.ts:106` already emits raw text via
  `page.pushOperators(beginText, setFontAndSize, setTextMatrix, showText, endText)` —
  the spike adds `setTextRenderingMode(Invisible)` to that exact sequence.
  [Verified: read the file.]
- The recognition half (per-word bboxes via `flattenBlockWords` / `mapWord` → `OcrWord`)
  already exists in `src/ocr/`. [Verified: read `tesseractMapper.ts`, `ocrHandler.ts`.]

## Component 1 — pure function `src/ocr/searchableTextLayer.ts`

```
buildInvisibleTextLayerOps(words, { scale, pageHeight, font }) → PDFOperator[]
```

- **Input:** `words: { text, bbox: { x0, y0, x1, y1 } }[]` (the existing `OcrWord` shape —
  image-pixel coords, top-left origin, captured at render `scale`); `scale` (the OCR render
  scale, e.g. 2); `pageHeight` (PDF page height in points); `font` (an embedded `PDFFont`).
- **Output:** a flat `PDFOperator[]` to hand to `page.pushOperators(...)`. Per word:
  `beginText · setTextRenderingMode(Invisible) · setFontAndSize(font, size) ·
   setTextMatrix(1, 0, 0, 1, x, baselineY) · showText(font.encodeText(text)) · endText`.
- **Coordinate transform** (the part most likely to be wrong → unit-tested):
  - `x = bbox.x0 / scale`
  - `baselineY = pageHeight - (bbox.y1 / scale)`  (bbox bottom ≈ baseline; descenders negligible)
  - `size = (bbox.y1 - bbox.y0) / scale`  (floored at a small minimum, matching existing style)
- **Font:** standard base-14 **Helvetica**; OCR words are ASCII for the spike. Non-Latin is a
  documented later concern, consistent with the rest of the codebase.
- Words with empty/whitespace text are skipped (same rule as the visible path).

## Component 2 — tests (TDD: failing first)

1. **jsdom unit** `tests/ocr/searchableTextLayer.test.ts` — the coordinate transform math.
   Given known bboxes / scale / pageHeight, assert `x`, `baselineY`, `size` (and that empty
   words are skipped). Written and failing before the function exists.
2. **real-Chrome** `tests/browser/searchable-ocr.browser.test.ts` — the round-trip proof:
   build a 1-page PDF with pdf-lib → embed Helvetica → `page.pushOperators(...build...)` →
   `save()` → reopen with **pdf.js** → `getTextContent()` → assert each word string is present
   AND its `transform[4]/[5]` is within tolerance of the expected PDF coords. This is the
   faithful "reader selects the invisible text at the right place" check and regression-fails
   if the transform breaks.

## Out of scope (next task — only if the spike passes)
`ocrHandler` changes · visible-vs-invisible toggle · `SourcePdf.bytes` swap + undo
(`ReplaceSourcePdfBytesCmd`) · DOCX/MD export wiring · UI / i18n strings.

## Acceptance
- Spike **passes**: both tests green; write a short verdict note; queue the full-feature build.
- Spike **fails**: verdict documents *why* (wrong coords / reader won't select mode-3 text /
  pdf.js round-trip issue) and we re-approach before spending effort on UI.

## Verification
- `npm run type-check && npm run lint && npm run test` (jsdom unit green)
- `npm run test:browser` (pdf.js round-trip green)
