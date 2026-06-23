# Export pipeline + positioning — deep QA (2026-06-23)

Files read (actual source):
- `src/export/exportPipeline.ts`
- `src/export/exportService.ts`
- `src/export/pdfElementRenderer.ts`
- `src/utils/geometry.ts` (transformPoint, redactionRectToContent, contentCropToPdfCropBox)
- `src/export/styledText.ts`
- `src/export/batesStamp.ts`
- `tests/browser/blockers-redaction.browser.test.ts` (page-rotation redaction contract)
- `KNOWN_ISSUES.md` (G2/G23/crop ceilings), locale parity check (en/fr/ar)

Overall: the pipeline is mature and well-factored. Coordinate flips (display top-left/y-down → user-space bottom-left/y-up) are centralized in `transformPoint`/`tp()`. FS-Access transient-activation ordering is correct everywhere (`pickSaveTarget` is the FIRST await in every byte-export path I checked). Byte-identical-when-off guarantees hold (effBox===cropBox no-crop, bates guard, advanced-text gate). Locale keys for every toast used here are at parity across en/fr/ar. The findings below are genuine gaps, not documented ceilings.

---

## P1 — Redaction burn is misplaced on a CROPPED page (crop + redaction interaction)

**File:** `src/export/exportPipeline.ts:220-222` (crop applied in `buildPageOverlays`) + `:286-313` (redaction burn) + `:269-270, 349-350` (canvas/newPage sized from cropped box).

**Evidence:**
`rasterizePageWithRedactions` calls `buildPageOverlays`, which when `docPage.crop` is set executes:
```ts
if (docPage.crop) { page.setCropBox(effBox.x, effBox.y, effBox.width, effBox.height); }
```
on the `tempPage`. The page is then serialized and rendered by pdf.js (`tempBytes → getDocument → getViewport`). pdf.js honours the CropBox, so `offscreen` is the **cropped sub-region** at SCALE, and `cropBoxR = getPageCropBox(tempPage)` returns the cropped box → `newPage` is `[w_eff, h_eff]` of the *cropped* size.

But the redaction burn uses raw full-page display coords with **no crop-origin offset**:
```ts
ctx.fillRect(
  Math.round(el.x * SCALE),
  Math.round(el.y * SCALE),
  Math.round(el.width  * SCALE),
  Math.round(el.height * SCALE),
);
```
`el.x/el.y` are stored relative to the full (un-cropped) page top-left. The canvas origin is now the crop window's top-left. On any page where `crop.x !== 0 || crop.y !== 0`, the burn is offset by `(cropOriginX, cropOriginY) * SCALE` — it covers the wrong region. The overlay TextElement canvas draw (`:316-339`) has the identical defect (`te.x * SCALE`).

Note: the *vector* redaction path (`renderRedaction` in pdfElementRenderer) goes through `tp()` which adds `cropOriginX/Y`, so it is crop-correct — but the redaction-bearing page is ALWAYS routed to the raster path (`hasRedaction → rasterizePageWithRedactions`), so the broken path is the one that runs.

**Severity rationale:** this is a redaction (data-safety) feature — a misplaced burn means the secret is NOT covered and leaks into the exported PDF. Crop is gated `VITE_FEATURE_CROP` (default ON). No test combines crop + redaction (`tests/browser/blockers-redaction.browser.test.ts` only varies rotation; no `docPage.crop` case). Holding at P1 rather than P0 only because it requires both crop AND redaction on the same page.

**Recommendation:** in the redaction + text canvas loops, subtract the crop origin in display space before scaling. The crop is stored in unrotated content space (`docPage.crop`), so map it to display space (`contentRectToDisplay`) and subtract its top-left, OR pass the crop offset through and use `(el.x - cropDisplayX) * SCALE`. Add a `crop + redaction` browser test (red secret under a crop window) mirroring blockers-redaction.

---

## P2 — Watermark & Bates draw in raw user space → wrong orientation/corner on a rotated page

**File:** `src/export/exportPipeline.ts:106-136` (`drawWatermarkOnPage`), `:140-166` (`drawBatesOnPage`), called at `:201-203, 213-215`.

**Evidence:** elements are placed via `tp()` = `transformPoint(px,py,Wo,Ho,totalRot)`, so they map editor-display coords to the correct on-page position for a `/Rotate`d page. The watermark and Bates do NOT: they tile/anchor in raw unrotated user space (`effBox.width/height`, `batesPosition(...)`) and the page carries `/Rotate totalRot` (set at `:175`). A PDF viewer rotates ALL page content, so:
- the Bates stamp anchored "br" (`batesPosition` bottom-right in user space) appears in a visually different corner after the viewer applies `/Rotate`;
- the watermark tiling fills the unrotated box, then the whole thing is rotated by the viewer — text angle = `watermark.angle + pageRotation`, and the tiled coverage can leave the visible (rotated) page partially uncovered because `stepX/stepY` were computed against unrotated dims.

This is consistent for the raster path too (watermark/Bates ride `buildPageOverlays` on the temp page before rasterization, so they're baked at the unrotated-space position and then the rotated viewport bakes them rotated).

**Recommendation:** for `/Rotate`d pages, either compute Bates anchor in displayed space and map back via `tp()` (so "bottom-right" is the user's bottom-right), or draw the stamp with a compensating `rotate: degrees(-totalRot)` and a rotated anchor. At minimum document this as a known ceiling in KNOWN_ISSUES (currently undocumented — the crop note covers Bates/watermark for crop but not for page rotation).

---

## P2 — `downloadPageAsImage` uses `documentModel.pageCount` as Bates total, but reports the page's full-doc index — inconsistent with range/extract semantics is fine, but the JPEG quality clamp lower bound silently raises tiny values

Two sub-points; the first is minor, the second is the real one:

**File:** `src/export/exportService.ts:683-685`.
```ts
const scale  = clamp(opts?.scale ?? IMG_DEFAULTS.scale, IMG_SCALE_MIN, IMG_SCALE_MAX);
const quality = clamp(opts?.quality ?? IMG_DEFAULTS.quality, IMG_QUALITY_MIN, IMG_QUALITY_MAX);
```
`IMG_QUALITY_MIN = 0.5`. A caller passing `quality: 0.2` (deliberately tiny JPEG) is silently bumped to 0.5 with no feedback. This is a documented clamp in the JSDoc, so it's a P3-ish design choice — flagging only because there's no toast telling the user their requested quality was overridden. Not a bug.

**Recommendation:** none required; documented. Listed for completeness so it isn't re-flagged.

---

## P2 — Per-element render failure is swallowed into an aggregate count; the user cannot tell WHICH annotation was dropped, and a partially-rendered export still "succeeds"

**File:** `src/export/exportPipeline.ts:188-199`.
```ts
for (const element of elements) {
  try { await renderElementToPdfLib(...); }
  catch { exportErrors.push(`${element.type} (id ${element.id})`); }
}
if (exportErrors.length > 0) {
  reportError.warn('toast.elementRenderFailed', { count: exportErrors.length });
  reportError.silent(undefined, `Export render failed: ...`);
}
```

**Evidence:** if an element throws during bake (e.g. a corrupt image data URL, an embedFont failure for a TextElement), it is silently skipped and the export proceeds to download a PDF **missing that annotation**, with only a `warn` toast showing a count. The user gets a file they believe is complete. For a redaction element specifically, a thrown render in the *vector* path would be a data-safety issue — but redactions go through the raster path, so this is the overlay-annotation case (signatures, stamps, text). Still, a dropped signature in a "signed-looking" export is meaningful.

**Recommendation:** acceptable as resilience (one bad element shouldn't abort the whole export), but the warn should be more prominent for security-relevant types, and consider including the element type in the toast (not just a count) so the user can find and re-add it. At minimum, keep — but verify the `silent(undefined, …)` call matches `IErrorReporter.silent(err, msg)` signature (here `err` is `undefined`, message is 2nd arg — confirm that's the intended contract, since elsewhere `silent(err, msg)`).

---

## P3 — `renderInkForExport` early-returns the first non-empty alpha row's data URL but the loop name implies a full-transparency check; correctness OK, readability trap

**File:** `src/export/exportPipeline.ts:97-101`.
```ts
const data = ctx.getImageData(...).data;
for (let i = 3; i < data.length; i += 4) {
  if (data[i] > 0) return c.toDataURL('image/png');
}
return null;
```
This is a "does the ink layer have any visible pixel?" guard (returns the PNG if any alpha>0, else null to skip embedding an empty image). It's correct but reads like it might return on the first pixel mid-computation. No action needed; noted so a future reader doesn't "fix" it.

---

## Things checked and found CORRECT (not findings)

- **FS-Access transient-activation ordering:** `pickSaveTarget` is the first await in `downloadPDF`, `downloadPageRange`, `downloadFlattened`, `sanitizeAndDownload`, `compressAndDownload`, `downloadPage`, `downloadPageAsImage`, `exportAsDocx`, `exportTableCsv`. Heavy assembly always follows. Matches CLAUDE.md #54 contract.
- **Page-rotation redaction burn:** proven correct by `blockers-redaction.browser.test.ts` — the burn is placed at the element's DISPLAYED AABB, and pdf.js renders the rotated page into a rotated-viewport canvas whose coordinate frame matches the display space. 0 red pixels at 0/90/180/270.
- **Bates full-document numbering:** `pageNumber = documentModel.pages.indexOf(docPage) + 1` (`:592`) and `docTotal = documentModel.pages.length` (`:588`) — range/extract exports correctly read "5 / 10". `downloadPage` passes `pageIdx + 1` / `documentModel.pageCount`. Correct.
- **Byte-identical-when-off:** `effBox === cropBox` with no crop; `bates?.enabled` guard; `hasAdvancedText(te) && !elemRot` gate keeps plain text on `drawText`; `updateMetadata:false` only on opt-in cleanMetadata paths.
- **`_compressLossy` rotation:** renders via pdf.js viewport (honours `/Rotate`) and sizes pages from `getViewport({scale:1})` (also rotation-honoured) — orientation consistent.
- **pdf.js worker leak:** `_compressLossy` and `renderThumbnailWithOverlays` both destroy via `loadingTask.destroy()` (matches the v6 "doc.destroy() is a no-op" memory note). NOTE: `downloadPageAsImage` (`:713`) and `rasterizePageWithRedactions` (`:275`) create a pdf.js `renderDoc`/`renderPage` and do NOT destroy the loading task — minor worker-memory leak on every image/redaction export (see below).
- **Locale parity:** all export toast keys present in en/fr/ar.

---

## P2 — pdf.js render docs not destroyed in `downloadPageAsImage` and `rasterizePageWithRedactions` (worker memory leak)

**File:** `src/export/exportService.ts:713` (`renderDoc = await pdfjsLib.getDocument(...)`, never destroyed) and `src/export/exportPipeline.ts:275` (`renderDoc` in the redaction rasterizer, never destroyed).

**Evidence:** `_compressLossy` (`:399-401`) and `renderThumbnailWithOverlays` (`:805-807`) both wrap render in try/finally and call `loadingTask.destroy()`, with a CLAUDE.md note that this is required because `doc.destroy()` is a v6 no-op. The single-page image export and the redaction rasterizer create the same kind of `renderDoc` but never destroy it. Each redaction-bearing page exported (and each image export) leaks a pdf.js worker document. Over a multi-page redacted export this accumulates one leaked doc per redacted page within a single `_assemblePdfDoc` run.

**Recommendation:** mirror the `finally { loadingTask?.destroy() }` pattern in both sites.
