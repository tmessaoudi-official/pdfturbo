# Crop Tool Plan

Client-side per-page crop for PDFturbo (deferred gap G23 → now a feature). Non-destructive,
undoable, persisted, rotation-aware, applied at export via `page.setCropBox`.

## Decisions Log
- [2026-06-17] AGREED: build the **crop tool** as the top deferred feature (was G23).
- [2026-06-17] AGREED (size): **Large** task, full 8-phase workflow.
- [2026-06-17] AGREED (live preview): **dimmed-margin frame** in the editor (overlay only —
  no pdf.js sub-region re-render). Thumbnails + export show the true crop.
- [2026-06-17] AGREED (rotation): **full rotation support in v1** — the drawn rect maps through
  the page's effective rotation into an unrotated-user-space cropbox (reusing `redactionRectToContent`).
- [2026-06-17] AGREED (scope): **current page + "apply to all" toggle** (one undoable MacroCmd).
- [2026-06-17] AGREED (3C gate): **proceed fully autonomously** — convergence run, Phase 4/6
  ask-human gates suppressed. Git commit/push stays manual (repo rule).

## Design (converged, Verified against code)
- **Storage:** `DocumentPage.crop?: {x,y,width,height}` in **unrotated content space** (y-down,
  top-left, PDF points, relative to the source `getPageCropBox()` box). Rotation-invariant →
  `rotatePage` untouched. Persists automatically (documentLoader.ts:113 restores `pages` wholesale;
  no SCHEMA_VERSION bump — storage.ts:11 pattern).
- **Command:** `SetPageCropCmd(model, pageId, newCrop|null, onUpdate)` — clone of `RotatePageCmd`
  (stores prevCrop, sets `page.crop`, `onUpdate()`).
- **Service:** `PageService.cropPage(pageId, contentRect|null, applyToAll)` — builds 1 cmd (or a
  `MacroCmd` of per-page cmds clamped to each page's content box), executes, invalidates thumbnails,
  re-renders. Computes W_orig/H_orig/totalRot from the source page viewport (rotatePage precedent).
- **Handler:** extend `DrawingHandler` — add `'crop'` clause to the pointerdown gate (line 58), a
  crop branch in `_updatePreview` (rect + dimmed margins as SVG), and a pointer-up crop branch that
  maps the display rect → content rect via `redactionRectToContent` and calls `app.cropPage(...)`.
- **Live dimmed frame:** a persistent overlay (mirrors the ink-layer absolute-positioned canvas/SVG),
  drawn whenever `currentPage.crop` is set, mapping content→display via a new
  `contentRectToDisplay` (inverse of `redactionRectToContent`); redrawn on render/zoom; pointer-events none.
- **Export:** thread crop into `buildPageOverlays` — draw overlays in original space (unchanged), then
  if `docPage.crop` compute the user-space cropbox + `page.setCropBox(...)`; use the crop's effective
  box for Bates/watermark extent. Optional → byte-identical when no crop. Raster + thumbnail + export
  preview inherit it (all route through buildPageOverlays / getPageCropBox).
- **Feature flag:** `VITE_FEATURE_CROP` (#28 seam) — `features.ts` `'crop'` key + `vite-env.d.ts` +
  `main.ts` button removal when off. Default ON.
- **Mode:** add `'crop'` to `ToolMode`; `setMode` already disables element/overlay pointer-events for
  non-select modes (toolModeService.ts:43) — no special-casing.

## Files
- New: `src/handlers/` crop logic (extend `drawingHandler.ts`), crop overlay renderer, geometry helper
  `contentRectToDisplay` + `contentCropToPdfCropBox` in `utils/geometry.ts`, `SetPageCropCmd` in
  `core/commands/pageCmds.ts`.
- Modified: `core/documentModel.ts` (crop field), `core/pageService.ts` (cropPage), `export/exportPipeline.ts`
  (setCropBox + effective box), `types/tools.ts` ('crop'), `core/toolModeService.ts` (hint),
  `ui/uiController.ts` (button active), `ui/binders/toolBinder.ts` + `keyboardBinder.ts` (toggle/esc),
  `core/pdfTurboApp.ts` (cropPage delegator, overlay hook), `config/features.ts` + `src/vite-env.d.ts`
  (flag), `main.ts` (flag removal), `index.html` (crop button + apply-all + remove controls),
  `locales/{en,fr,ar}.json` (3-way), `KNOWN_ISSUES.md` (G23 done + v1b ceilings).
- Tests: `tests/utils/cropGeometry.test.ts`, `tests/core/setPageCropCmd` + `cropPage` (service),
  `tests/export/cropCropBox.test.ts`, `tests/browser/crop-tool.browser.test.ts` (drag→export pixels + rotated).

## Acceptance criteria
1. Drag a crop rect → page renders dimmed margins; export/thumbnail show the cropped page.
2. Undo restores the prior crop (incl. none); redo re-applies.
3. Crop persists across reload (IndexedDB) and survives page reorder/rotate.
4. Rotated page (90/180/270) crops to the correct region.
5. Apply-to-all crops every page (clamped to each page's box) in one undo step.
6. No crop set → export bytes unchanged vs today (optional param).
7. `VITE_FEATURE_CROP=false` removes the button; type-check + lint + jsdom + browser all green.

## v1b ceilings (documented, not built)
- Resizable crop-rect handles / numeric margin inputs (v1 = drag-to-set + re-drag + remove).
- Apply-to-all across heterogeneous page sizes uses identical content-space margins (clamped), not aspect-aware.
- A thin crop outline in non-crop modes (v1 dims margins; thumbnail always reflects crop).

## Risk / rollback
- Rollback: `VITE_FEATURE_CROP=false` (button gone) + crop field is optional/off → byte-identical export.
- Top risk: export cropbox math on rotated / pre-cropped source pages → mitigated by reusing the tested
  `redactionRectToContent` and testing both fixtures.
