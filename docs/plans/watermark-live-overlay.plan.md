# Watermark live editor overlay Plan

## Decisions Log
- [2026-06-25] AGREED: Watermark works on all export surfaces (modal preview, export preview, exported bytes — verified 3× per page). The reported "not working" is the missing LIVE watermark on the editor canvas; user chose to add it.
- [2026-06-25] AGREED: Approach = a dedicated `#watermarkOverlay` canvas appended over the page canvas during `renderCurrentPage` (mirrors the export-preview ghost + `#cropFrameOverlay` patterns), z-index 1 (above page raster, below annotations), pointer-events:none. NOT painted onto the pdf.js page canvas (avoids polluting true-edit color sampling / thumbnails).

## Formal Plan
1. `IPageRenderContext` (`pageRenderPipeline.ts`): add `drawWatermark(ctx, w, h)` to the interface (app already implements it).
2. `PageRenderPipeline`: add `_renderWatermarkOverlay()` — removes any existing `#watermarkOverlay`; if `documentModel.watermark.enabled && text`, create an overlay canvas sized/positioned to `ui.canvas`, call `drawWatermark`, append to `ui.container`. Call it at the end of `renderCurrentPage`. Guard for missing/non-DOM container (mirrors `_renderCropFrame`).
3. `IWatermarkContext` (`watermarkPanel.ts`): add `renderCurrentPage()`; call it in `apply()` so enabling/disabling updates the live view immediately.
4. Tests: jsdom `pageRenderPipeline.test.ts` (overlay created when enabled / removed when disabled, drawWatermark called) + `watermarkPanel.test.ts` (apply triggers renderCurrentPage) + browser `watermark-live.browser.test.ts` (real Chrome: overlay has red pixels when enabled).
5. Verify: full deploy gate + before/after editor screenshots.

## Follow-up (2026-06-25): wider watermark ranges
- [2026-06-25] AGREED (user: "all of them"): extend watermark ranges. Angle (−180→180) and opacity (1–100%) are already full → no change. Implement: Density 1–5 → **1–10 with 0.5 steps**; font-size max 200 → **400**.
- Plan: shared pure `src/utils/watermarkDensity.ts` `densitySpacingFactor(d)` — interpolated table that preserves the old 1–5 factors (2.0/1.5/1.0/0.7/0.5) exactly and extends to 10; used by the export path (`exportPipeline.drawWatermarkOnPage`). Live/preview path (`watermarkPanel.drawOnCanvas`) just widens its `count` clamp to `MAX_WM_DENSITY` (its `screenW/(count+0.5)` already handles fractional). `apply()`/`_updatePreview()` switch `parseInt`→`parseFloat` for density (else 1.5→1). index.html slider min/max/step + fontSize max; densityHint i18n 5→10 (3 locales).

## Acceptance
- Enabling the watermark + Apply → watermark visible on the editing canvas immediately.
- Disabling → disappears.
- Export bytes unchanged (still 3× per page).

## STATUS — 2026-06-25
- ✅ DONE + VISUALLY VERIFIED (before/after/density-9 screenshots) + FULL DEPLOY GATE GREEN
  (audit 0 vuln · type-check · oxlint · jsdom 2134+2 · browser 155 · coverage:export 8 · build).
- Live watermark overlay + export-preview de-dup + density 1→10/0.5-steps + font max 400 all shipped.
- 16 files staged. User commits + pushes MANUALLY, then compacts.
- Watermark fix complete — plan can be deleted after the next task below ships.

## NEXT TASK (resume after compaction) — FULL WHOLE-APP VISUAL QA SWEEP
User's ORIGINAL request part 2: "test the whole app — absolutely EVERYTHING — before/after screenshots,
assert visually it works." This is still PENDING. Run after the user commits/pushes/compacts.
- Use the dev server (`npm run dev` → http://localhost:5173/pdfturbo/), drive via claude-in-chrome.
- Load a PDF by fetching `/pdfturbo/test.pdf` and injecting into `#fileInput` (file_upload tool rejects host paths).
- `window.app` exposes the app (assemblePdfBytes, watermark, exportPreviewOpen, renderCurrentPage…). `window.pdfjsLib` for re-parsing exports.
- GOTCHA: do NOT call `app.renderCurrentPage()` re-entrantly via JS — concurrent pdf.js render on the same canvas HANGS (45s CDP timeout). Trigger renders via real UI (apply/zoom/nav) and WAIT ~1.5s for settle before screenshotting (toolbar greys while rendering).
- Feature groups to sweep with screenshots: text/shape/ink draw + formatting toolbar (B/I/U/align/stroke/Tc/Tz/lists/links), image insert, signatures (drawn + cert e-sign), redaction (incl. cropped page), forms fill+flatten, OCR (visible/searchable/text/docx), crop, Bates, watermark (done), export formats (PDF/PNG/DOCX/MD/CSV/XFDF/sanitize/compress/flatten), DOCX editor (open/edit/tables/find-replace/paste/export-pdf), Arabic/RTL (overlay/copy/search/toolbar), undo/redo, session restore, i18n EN/FR/AR.
- Consider the `/qa-sweep` skill for structure. Capture before/during/after screenshots per the user's visual-confirmation preference.
