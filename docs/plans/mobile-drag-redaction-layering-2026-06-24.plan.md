# Mobile drag + redaction layering Plan (2026-06-24)

## Decisions Log
- [2026-06-24] User report: on mobile, **dragging an element drags the screen** instead of the
  element; **resizing works**; "works at the beginning then lags". Separately: "I should be able to
  put **anything on top of a redaction**" (signature/shape currently render under the burn).
- [2026-06-24] Root causes **[Verified live in Chrome]**:
  - Inner `<textarea>`/`<input>` of a text/comment element computes `touch-action: auto` (the
    `.pdf-element` `none` is NOT inherited) → the surface under the finger initiates native scroll.
  - `rebuildElementLayer()` runs on **every** `pointermove` (8×/8-move drag) = full DOM teardown
    (`querySelectorAll('.pdf-element').forEach(el=>el.remove())`) → the lag.
  - That teardown removes the `setPointerCapture` node mid-drag → capture lost (`document.contains`
    → false). (Pointer move/up are on a `document` listener so drag *logic* still continues; the
    capture loss matters only for whether the browser scrolls.)
  - Redaction node is hard-coded `z-index:15`; every other `.pdf-element` is `z-index:2` → anything
    placed over a redaction renders under the burn.
- [2026-06-24] AGREED (user): fix scope = **all three** — drag-scroll, drag-lag/capture, redaction
  layering (editor **and** export). Export-order verification (user-requested) revealed the raster
  path (`rasterizePageWithRedactions`) bakes non-text overlays UNDER the burn; only text draws on top.
- [2026-06-24] DECISION: **sequence for safety** (one feature per commit; standing preference):
  1. Mobile-drag fix (Fix 1 + Fix 2) — low-risk, primary pain.
  2. Redaction editor layering (Fix 3a) — drop z-index:15.
  3. Redaction **export** reorder (Fix 3b) — security-sensitive raster-pipeline refactor, its own
     careful design + pixel guards. Interacts with the recent rotation/crop leak-fix coordinate code.
- [2026-06-24] 3C gate (Full 30/8) cleared for increment 1 after 1 reset (export fork → sequenced).

## Outcome (2026-06-24)
- **Increment 1 (mobile drag) — DONE, all gates green.** Fix 1 (touch-action:none on
  `.pdf-element input,textarea`) + Fix 2 (`_renderOne`/`rerenderElement` single-node re-render +
  capture re-acquire on each move; `_finish` does one reconcile rebuild). Verified live: textarea
  touch-action auto→none; full rebuilds/8-move drag 8→1; 8 single-node rerenders; element moves.
  Gate: type-check ✓ · oxlint ✓ · jsdom (targeted + full 2046+2) ✓ · full test:browser 137/137 ✓ ·
  build ✓. Screenshots `qa-shots/mobile-drag-2026-06-24/`.
- **Increments 2 (editor z-index) + 3 (export reorder) — NOW DONE (2026-06-24, after the rotation
  root-cause fix `4ad9811`).** The rect-anchor AABB fix made `renderRedaction` rotation-correct, so
  routing the redaction through the vector bake in array/stacking order no longer leaks on rotated
  pages. Re-applied: z-index removed (editor layering), rasterizer draws ALL elements in array order
  (overlays on top of the burn), redaction render is fail-closed, dead `rasterText` removed. Guards:
  `redaction-overlay-ontop.browser.test.ts` (shape on top of burn + source destroyed, at 0° AND 90°),
  `blockers-redaction`/`redaction-crop`/`redaction-rotation` all still green. Full suites: jsdom
  2046+2, real-Chrome 137, build. The original (first-attempt) revert note is kept below for history.

- **(historical, superseded above) Increments 2+3 — first attempt REVERTED.** The full browser
  suite caught a SECURITY regression: routing the redaction through `renderRedaction`
  (content-space transform) LEAKS on page-rotated pages (90/180/270 → 28800 red px), because the
  proven canvas burn draws in displayed/canvas space and `renderRedaction`'s rotation mapping does
  NOT round-trip the same way (latent — redaction never used that path before). Per Rule 4/14 the
  redaction-export reorder is NOT shipped. Editor z-index was reverted too, to avoid an
  editor/export mismatch (shapes/sigs would look on-top in editor but bury under burn in export).
  **Redaction layering needs its own rotation-safe redesign** (the burn must stay in the proven
  displayed/canvas space, which conflicts with vector-overlays-on-top without canvas renderers for
  every overlay type, OR requires a verified content-space redaction transform for rotated pages).

## Redaction redesign — root-cause CONFIRMED (2026-06-24, understand phase)
[Verified via temp browser probe, since deleted] The rasterizer's VECTOR overlay path
(`buildPageOverlays`→`renderElementToPdfLib`) mis-places **every** overlay type on rotated pages —
a green test shape at the secret's displayed-AABB coords fully covers at 0° (red=0) but MISSES at
90° (red=28560); content-space coords also miss. So it is NOT redaction-specific — it's a
**pre-existing latent bug**: shapes/images/highlights on a rotated page that also has a redaction
are already mis-placed in export today. The OLD canvas burn (displayed space, `el.x*SCALE` on the
rotated viewport) was the ONLY rotation-correct renderer in the rasterizer.

**Mechanism — CORRECTED [Verified, probe2]:** the earlier "rasterizer double-rotation" hypothesis is
WRONG. A second probe rendered the SAME green shape (at the secret's `inverseTransformPoint`
displayed-AABB) through the NORMAL `buildPageOverlays` path AND the rasterizer at 90° — BOTH gave
**identical** mis-placement (green=12648, red=28560). So the rasterizer is not the culprit;
`buildPageOverlays` itself mis-places. `transformPoint`/`inverseTransformPoint` ARE clean inverses
at 90° (both swap x/y), so the error is in `anchorForCenter` / the swapDims dimension handling for a
rotated rect — and it affects EVERY export path, suggesting a **general pre-existing "overlay on a
rotated page" placement bug**, not redaction-specific. (The old canvas burn sidestepped it by drawing
in displayed/canvas space directly.)

**Open question blocking the fix:** does the EDITOR's own export actually mis-place a shape a user
draws on a genuinely-rotated page, or is the `inverseTransformPoint`-based test placement an artifact
that only the canvas burn matched? `blockers-redaction` + `bates-rotation` pass, so SOME rotated
placement is correct. RESUME (dedicated session): establish ground truth — in the real app, load a
multi-page PDF (blank-page rotation didn't visibly apply), rotate a page, draw a shape over a known
mark, export via `assemblePdfBytes`, and check whether it lands where the editor showed it. If the
editor mis-places → fix `anchorForCenter`/swapDims in the shared path (broad rotation pixel guards).
If the editor is correct → the redaction reorder is production-correct and only `blockers-redaction`'s
placement convention (tuned to the old canvas burn) needs updating to match. Then re-apply the
reverted Increment-3 array-order reorder. Touches the shared path used by EVERY export — guard widely.

## Formal Plan

### Increment 1 — mobile drag fix (Fix 1 + Fix 2) — ONE commit
**Fix 1 (CSS):** `src/styles/editor.css` — add `touch-action: none;` to `.pdf-element input,
.pdf-element textarea` (the `.pdf-element input,.pdf-element textarea` block ~L80). Tap-to-edit still
works (touch-action doesn't block taps); only native pan/scroll is suppressed.

**Fix 2 (single-node re-render + capture):**
- `src/ui/elementLayerRenderer.ts`: extract `_renderOne(element): HTMLDivElement` (all current
  per-element wiring: render, a11y, pointer-events, rotation transform, selected class, click,
  pointerdown, code-edit, text/comment input listener, append). `rebuildElementLayer` loops
  `_renderOne`. Tag each node `data-element-id` for lookup. Add
  `rerenderElement(element): HTMLDivElement | null` — find existing node by id, render a fresh one,
  insert at the SAME DOM position (insertBefore original next sibling), remove old, return new.
- `src/core/appContext.ts` (IAppContext) + any other IAppContext-typed interfaces used by
  `InteractionHandler`: add `rerenderElement(el: PDFElement): HTMLDivElement | null`.
- `src/core/pdfTurboApp.ts`: delegator `rerenderElement(el){ return this._elementLayerRenderer.rerenderElement(el); }`.
- `src/handlers/interactionHandler.ts`: store `_activeDiv`. In `drag()`/`resize()`/`_rotate()`
  replace `this.app.rebuildElementLayer()` with
  `const d = this.app.rerenderElement(el); if (d){ this._activeDiv = d; try{ d.setPointerCapture(this._activePointerId!); }catch{} }`.
  `_finish()` keeps a single full `rebuildElementLayer()` (reconcile). startDrag/_commitTouchDrag/
  startResize/startRotation set `_activeDiv`.
- Test fakes implementing IAppContext (tests/) → add `rerenderElement` stub.

**Tests (TDD):**
- `tests/ui/elementLayerRenderer.test.ts`: `rerenderElement` replaces only the target node, preserves
  others + DOM order; re-rendered node still wired (dispatch pointerdown → handler invoked).
- `tests/handlers/interactionHandler.test.ts`: a multi-move drag calls `rerenderElement` (not full
  rebuild) per move + full rebuild once on finish; `_activeDiv` updated; capture re-acquired.
- `tests/browser/mobile-drag.browser.test.ts` (real Chrome, touch pointers): place text element,
  touch-drag body > threshold → element x/y change AND `document.scrollingElement.scrollTop`
  unchanged; assert inner textarea computed `touch-action === 'none'`.

### Increment 2 — redaction editor layering (Fix 3a) — ONE commit
- `src/elements/redactionElement.ts`: remove the hard-coded `zIndex:'15'` (or set to the shared
  default so stacking follows array/DOM order). Verify burn label + selection outline unaffected.
- Test: redaction + shape placed after → shape DOM node is after / not z-buried; jsdom z-order check.

### Increment 3 — redaction export reorder (Fix 3b) — ONE commit, own design
- Refactor `rasterizePageWithRedactions` (`src/export/exportPipeline.ts`): rasterize **source only**
  → burn redactions (source destroyed) → draw ALL overlays (shapes/images/signatures/text/ink) on
  top. MUST preserve the rotation/crop coordinate handling (#QA-2026-06-23 leak fixes) — design
  carefully; risk of double-applying rotation if a pre-rotated burned image is re-fed to
  `buildPageOverlays`. Pixel guard: `tests/browser/redaction-overlay-ontop.browser.test.ts` — a shape
  over a redaction shows the shape's color (not black) at its center in the exported raster, while a
  control point inside the bare burn stays black (redaction still destroys source).

## Gate (every increment)
`npm run type-check && npm run lint && npm run test` + (shared-surface) full `npm run test:browser`
+ `npm run build`. Visual: before/after screenshots. Push MANUAL. No Co-Authored-By.
