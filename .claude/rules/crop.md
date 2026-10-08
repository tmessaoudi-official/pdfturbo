---
paths:
  - "src/core/pageService.ts"
  - "src/core/pageRenderPipeline.ts"
  - "src/utils/cropResize.ts"
---

# pdfturbo gotchas — crop

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: per-page crop, its handles and numeric margins — and why crop HIDES while redaction REMOVES. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### Per-page crop (#G23)

`DocumentPage.crop?` is a rect in **unrotated content space** (y-down, top-left,
relative to the source `getPageCropBox()` box) — rotation-invariant, so `rotatePage` is untouched and it
persists via `toJSON`'s `pages` with **no SCHEMA_VERSION bump** (`documentLoader` assigns `pages` wholesale).
The drawn rect arrives in editor DISPLAY space; `PageService.cropPage` maps it via `redactionRectToContent`
(the SAME tested helper redactions use) + `clampContentRect`. Export: `buildPageOverlays` draws every overlay
in source-box space FIRST, then `page.setCropBox(effBox)` **last** (via `contentCropToPdfCropBox`) — so
element/ink coords are unaffected and the thumbnail + export-preview inherit the crop (they re-read
`getPageCropBox`). **The redaction rasterizer does NOT use setCropBox** (#QA-2026-06-23 leak fix): it passes
`buildPageOverlays({ skipCropBox: true })`, renders the FULL page, draws the burn at full-page coords (the
already-correct path), then **clips the rendered CANVAS** to the crop window LAST (effBox corners → canvas px
via `viewport.convertToViewportPoint`, rotation-correct). Burn and content thus share ONE coordinate space, so
a non-zero crop offset can no longer drift the burn off the secret (the old `setCropBox`-before-render path
rendered a cropped canvas but drew the burn at full-page coords → **misplaced burn = redaction LEAK** on a
cropped page). Guard: `tests/browser/redaction-crop.browser.test.ts`. Bates/watermark switch to the crop's
**effective box** (else they'd anchor in the now-clipped original corner); `effBox === cropBox` when no crop →
**byte-identical export** (the rasterizer's no-crop path embeds the full canvas unchanged).
Undoable via `SetPageCropCmd` (clone of `RotatePageCmd`); apply-to-all = a `MacroCmd` whose canvas re-render
rides the CURRENT page's command (fires on execute AND undo). Live editor preview is a **dimmed-margin SVG
frame** (`pageRenderPipeline._renderCropFrame`, mapped via `contentRectToDisplay`), NOT a pdf.js sub-region
render (Design β). Tool mode `'crop'` rides `DrawingHandler` (pointerdown gate + `_updatePreview` + pointer-up
branches). Gated `VITE_FEATURE_CROP` (#28; `main.ts` removes the button + `#cropControls` when off, `exportPipeline`
gates both the vector CropBox and the raster clip, and since 2026-09-04 `_renderCropFrame` gates the live
frame too — it was the one surface where the feature outlived its own switch, painting a draggable frame
whose grips still committed `SetPageCropCmd` while the export ignored the crop).
**Ceiling:** none of the three originally listed remain. Numeric margins SHIPPED 2026-08-04 (§ Numeric crop
margins) and resizable HANDLES 2026-08-05 (§ Resizable crop handles).

### Crop HIDES, redaction REMOVES — and the obvious check gives a false negative (2026-08-04)

`buildPageOverlays` ends with `page.setCropBox(...)`: a **view directive**. The content stream and
MediaBox are untouched, so cropped-away content is still in the exported bytes and a recipient restores
it by deleting one key. Proven by a reviewer: export a crop over a `CONFIDENTIAL …` header, delete
`/CropBox`, the header is back.

**Two things make this worse than a plain limitation, and both are why it is now disclosed to USERS**
(`README.md`, `FEATURES.md`, and its own § in `SECURITY.md` — not only here):
1. **The user's own verification confirms the illusion.** `getTextContent()` respects the CropBox, so
   select-all/copy in a viewer shows the header gone while `getOperatorList()` on the same untouched
   file still returns it. Someone who checks the way a careful person would checks is reassured wrongly.
2. **Removal semantics differ PER PAGE.** A page carrying a redaction takes
   `rasterizePageWithRedactions`, which embeds only the clipped canvas — there the crop IS destructive.
   Same UI action, same toast, opposite guarantees. Do not generalise from a redacted page.

The docs already qualify removal-grade features ("Redaction — … text unextractable"), so crop sitting
unqualified four lines away read as an equal promise. Numeric margins raised the stakes rather than
creating them: a margin is exactly the affordance for a header banner, and typing `80` feels like a
measurement.

### Resizable crop handles (#G23 v1c, 2026-08-05)

Eight grips (4 corners + 4 edge midpoints) on `#cropFrameOverlay`. Pure geometry in
`src/utils/cropResize.ts` (`resizeDisplayRect` / `handlePositions` / `handleCursor`); the wiring lives in
`pageRenderPipeline._renderCropFrame` and commits via a new `IPageRenderContext.commitCropRect` seam →
`PageService.cropPage`. **The drag works in DISPLAY space**, which is exactly what `cropPage` takes, so a
resize reuses the drawn path's rotation mapping and its undoable `SetPageCropCmd` — no second coordinate
convention, which is the mistake the margins path made on its first attempt.

**The load-bearing detail is `pointer-events`.** The overlay must stay `none` or it would swallow every
drawing gesture; each grip re-enables `all` for itself. A naive `all` on the SVG breaks the crop, redact
and freehand tools at once, so the browser guard asserts BOTH halves and that each grip is the topmost
node at its own centre.

**Clamping is applied to the moving EDGE, not to the resulting width/height.** Dragging past the
opposite side stops at `MIN_CROP` instead of inverting the rect — an inverted rect is still valid
arithmetic and would silently crop a different region than the one under the pointer.

**Two things that cost me time and will cost the next person the same:**
1. **A grip can be BELOW THE FOLD.** The page canvas is taller than the viewport, so on a full-height
   page the `se`/`s`/`sw` grips sit outside it and `elementFromPoint` at their centre returns null. My
   first live drag targeted `se` and silently did nothing. Same family as the 375px reachability finding:
   *rendered* is not *reachable*. Drag `nw` (or scroll the region first) when driving this by hand.
2. **`#cropFrameOverlay`'s last `<rect>` is a GRIP, not the frame.** The outline now carries
   `data-crop-outline` so tests and the QA driver can address it; a `rect:last-of-type` selector measures
   a 9×9 grip and reads as "the drag did nothing".

Verified live: dragging `nw` inward 80px takes the frame 882×650 → 802×570 with the dimmed bands
following, and undo restores 882×650 exactly. Guards: `tests/utils/cropResize.test.ts` (7 pure — every
handle, both clamps, the no-invert cases, identity at zero delta) +
`tests/browser/crop-handles.browser.test.ts` (7 real-browser — hit-testability of all 8 grips through the
pass-through overlay, SE/NW drags, a press with no movement committing nothing, cursor, clamp, and
listener teardown so an in-flight drag cannot leak across the re-render that destroys the overlay).

### Numeric crop margins (#G23 v1b, 2026-08-04)

`✓ cropMarginApplyBtn` + four `#cropMargin{Top,Right,Bottom,Left}` number inputs in `#cropControls`
→ `PDFTurboApp.cropPageByMargins` → `PageService.cropPageByMargins`. Margins are typed in **points, in
unrotated content space**, [superseded 2026-09-28: they are typed in DISPLAY space and mapped through `redactionRectToContent` (`0c2629b`) — the paragraph below is right] converted by the pure `marginsToRect` (`utils/geometry.ts`).

**Margins are converted PER PAGE, which is a real improvement over the drag path's apply-to-all.**
"20pt off each edge" means the same thing on a mixed-size document; one drawn rect clamped to each page
does not. A page whose margins leave nothing to show is SKIPPED, not cropped to nothing, and an
all-pages-swallowed run warns `toast.cropMarginsTooLarge` instead of silently doing nothing.

**Both crop entry points now share `PageService._commitCrops`** — extracted in the same change so undo
grouping (`MacroCmd` vs a single `SetPageCropCmd`), thumbnail invalidation and which toast fires cannot
drift between the drag and margin paths. No new command, no `SCHEMA_VERSION` bump: it writes the same
`page.crop`.

**The margins are typed in DISPLAY space and mapped through the drag path's own
`redactionRectToContent`** — deriving a content rect from margins directly ignored `srcRot`/`p.rotation`
and cropped the WRONG VISUAL EDGE on any rotated page (measured: at 90° a typed top margin removed the
right-hand strip; a `/Rotate 90` scan hits this without the user rotating anything). Sharing the mapping
is what makes "top" mean the same thing in both entry points — pinned by a test that fails if rotation is
ignored. **A green Playwright click is NOT evidence of reachability:** the 5 controls overflowed the
375px viewport and `elementFromPoint` at the ✓ button's own centre returned null, yet the sweep scored it
PASS because Playwright scrolls programmatically where a finger cannot, and
`documentElement.scrollWidth` stays 375 because `.container` clips. Fixed by letting `.toolbar-group`
wrap at the mobile breakpoint (`.toolbar` already did — the QA-D F3 invariant did not reach inside a
group), guarded statically by `tests/ui/toolbarWrapInvariant.test.ts` because the live gate is blind to
this class twice over.

**Two more things that will mislead you when testing this by hand:**
1. **The canvas does NOT resize.** Per § Per-page crop the live preview is a dimmed-margin SVG frame
   (`#cropFrameOverlay`, Design β), not a pdf.js sub-region render — so `#pdfCanvas.width` is unchanged
   and the overlay's presence is the real observable. Measured live: no overlay before, 5 rects after.
2. **Ctrl+Z does not undo the crop while a margin input still has focus** — the number input's own text
   undo consumes it. That is ordinary browser behaviour, not a defect; the undo BUTTON works (verified
   live: overlay present → absent). Worth knowing because it reads exactly like a broken undo.

i18n: 6 new `toolbar.cropMargin*` keys + `toast.cropMarginsTooLarge` (ar accepted by the 2026-09-13 WS3
closure ruling, alongside `toolbar.exportXlsxTitle`, `badge.signRect`, the 3 re-worded crop/redaction strings,
the 2 #54b keys and the old `toolbar.sanitizeTitle` — 15 values pending, enumerated in § The hide-vs-remove audit). The inputs use `role="group"` +
`aria-labelledby` so a short field name is announced with its group label, the same pattern as
`signX/Y/W/H` (§ A CRITICAL a11y rule). Guards: `tests/utils/marginsToRect.test.ts` (8 pure —
zero margins, negatives, NaN from an empty input, refusal when nothing is left) +
`tests/core/pageService.test.ts` (5: inset, undo, per-page apply-to-all in one MacroCmd, the warn, the
all-pages toast).

**Aspect-ratio-aware apply-to-all — the last of these ceilings — SHIPPED 2026-09-04 (#G23 v1d).**
The DRAG path's apply-to-all reused ONE absolute content rect and clamped it to each page. On a
uniform document that is right; on a mixed-size one the same 200x100 rect at (50,50) frames a
different part of a smaller page, and on a page narrower than the rect it is silently truncated into
a different SHAPE. "Take the top third of every page" is a proportion, not a measurement.
`scaleCropToPageBox` (geometry.ts) maps the crop onto each page's own box.

**Two properties that can conflict, so the resolution is explicit.** SHAPE is preserved with a
UNIFORM scale `min(toW/fromW, toH/fromH)` — scaling each axis independently keeps the fractions but
stretches a portrait selection into a squat one on a landscape page. POSITION is preserved by keeping
the crop's CENTRE at the same fractional position, then clamping; anchoring the top-left drifts the
framing towards the bottom-right as pages shrink.

**Centre-vs-corner is invisible to almost every test, and that is worth knowing.** The two agree
EXACTLY whenever the source and target aspect ratios match — so a sabotage that anchored the corner
passed the entire file until a case with differing ratios was added (400x400 → 800x400 puts the crop
at x=250 centre-anchored and x=200 corner-anchored). A design claim no case can distinguish is not
pinned, however reasonable it reads.

**The equal-box identity is short-circuited rather than left to the arithmetic**: the centre
round-trip `((y + h/2) / H) * H - h/2` is not exact in floating point — it returned 59.999999999999986
for 60 — so without the short-circuit a uniform document's stored crop would drift in the last bits
on every apply-to-all and the byte-identical claim would simply be false.

Guards: `tests/utils/scaleCropToPageBox.test.ts` (8, including a swept in-bounds property and the
degenerate source box) + two wiring cases in `tests/core/pageService.test.ts` — the mixed-size one and
a UNIFORM control, because the helper can be correct and simply not called. Sabotage-verified:
per-axis scaling fails the shape case; corner anchoring fails it too once the position is asserted;
reverting the service to clamp one absolute rect fails exactly the mixed-size wiring case.
