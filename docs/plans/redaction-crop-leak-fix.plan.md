# Redaction-on-cropped-page leak — fix plan

## Decisions Log
- [2026-06-23] AGREED: Fix the P1 redaction-crop burn-misplacement leak found in the 2026-06-23 QA sweep.
- [2026-06-23] AGREED: Approach = **render full page, clip the canvas last** (not crop-origin subtraction, not refuse). Leak-safe by construction: redaction burn and page content share ONE coordinate space (the full-page render), so the burn can never drift off the secret; the crop is a final canvas clip. Rotation handled via `viewport.convertToViewportPoint` on the effBox corners.

## Root cause [Verified — exportPipeline.ts:170-351]
`rasterizePageWithRedactions` lets `buildPageOverlays` call `setCropBox(effBox)` (line 221) before pdf.js renders, so the canvas is the **cropped window** (origin = crop top-left). But the redaction `fillRect` (305-310) and overlay-text draw (323/336) use `el.x*SCALE`/`el.y*SCALE` — **full-page** display coords. A non-zero crop offset misplaces the burn → underlying text in the crop window is exposed.

## Formal Plan
1. **Failing test first** (`tests/browser/redaction-crop.browser.test.ts`, real Chrome): green "secret" band + black redaction over it + a crop with non-zero offset that includes the band. Render the cropped output; sample the secret's location in crop-window space → must be BLACK. Pre-fix: GREEN (leak) → test fails. Plus a no-crop regression case (still BLACK) and an output-dimensions assertion (crop actually applied).
2. **Implement** in `exportPipeline.ts`:
   - Add optional `skipCropBox?: boolean` to `BuildPageCtx`; when true, `buildPageOverlays` skips ONLY the `page.setCropBox` call (everything else — elements at full coords, watermark/Bates at effBox — unchanged).
   - `rasterizePageWithRedactions`: call `buildPageOverlays({ skipCropBox: true })`; render the FULL page; draw redaction/text fillRects at full-page coords (unchanged, today's correct path); THEN if `docPage.crop`, map effBox corners via `vp.convertToViewportPoint` → canvas-px clip rect, extract that sub-region onto a second canvas, embed it, and size the new page to the crop window (effBox dims, rot-swapped). No crop → embed full canvas (byte-identical to today).
3. **Verify**: new test green; existing `redaction-rotation` + `blockers-redaction` + `crop-tool` browser tests green; jsdom suite green; type-check + lint.

## Ceiling / notes
- Safety property means even an imperfect rotated-crop clip window can't leak (burn shares the content space). Aim for exact via convertToViewportPoint.
- Watermark/Bates-on-rotated-page mis-anchor is a SEPARATE P2 (out of scope here).
