# QA — Shapes / Highlight / Redaction / Comment / Ink / Eraser (2026-06-23)

Reviewer: skeptical senior code review. Files actually read:

- `src/elements/redactionElement.ts`, `highlightElement.ts`, `shapeElement.ts`, `commentElement.ts`, `annotationElement.ts`
- `src/export/exportPipeline.ts`, `pdfElementRenderer.ts` (redaction/highlight/shape/text branches), `exportService.ts` (570–790, 1020–1080)
- `src/infra/inkLayer.ts`, `src/handlers/inkLayerHandler.ts`, `eraserHandler.ts`, `drawingHandler.ts`
- `src/core/historyManager.ts`, `src/core/commands/inkCmds.ts`
- `src/utils/eraserGeometry.ts`, `src/infra/storage.ts`
- `tests/browser/redaction-rotation.browser.test.ts`, `tests/browser/blockers-redaction.browser.test.ts`
- `locales/{en,fr,ar}.json` (redaction keys)

## Headline: redaction actually removes content (no export leak)

The export pipeline is correct and the historic rotated-page leak is fixed.

- `_assemblePdfDoc` (exportService.ts:591/610) routes **any page with a redaction element** through
  `rasterizePageWithRedactions`. That function (exportPipeline.ts:227–351) renders the source page to a
  canvas via pdf.js, paints opaque fill rects over the redaction regions, and embeds the **flattened PNG**
  as the only page content. The original content stream (and therefore the extractable text under the box)
  is discarded. ALL PDF byte-export entry points share `_assemblePdfDoc` — `assemblePdfBytes`,
  `downloadFlattened`, `sanitizeAndDownload`, `compressAndDownload`, signing — so the burn is universal.
- Rotated-page leak (the memory blocker CORE-P0-1) is FIXED and guarded by
  `blockers-redaction.browser.test.ts` (0 red pixels at 0/90/180/270°, with a control proving the test can
  see leakage) and the element-own-rotation case by `redaction-rotation.browser.test.ts` (G2).
- Flow export (DOCX/MD/TXT) drops redacted source text via the redaction-aware extraction at
  exportService.ts:1029–1038 + `reconstructPage`'s `totalRot` un-rotation — also guarded for 0/90/180/270°.

The only place redaction draws a non-destructive vector rect (`renderRedaction`, pdfElementRenderer.ts:386,
opaque rectangle over still-present text) is the `_applyOverlaysToPage` path used by **image export**
(`downloadPageAsImage`) and **thumbnails**. Both rasterize the whole page to a flat image afterward, so the
text underneath is destroyed in the output anyway. No PDF byte path reaches `renderRedaction`. Not a leak.

---

## Findings

### P2 — Redacted source bytes persist UNREDACTED & unencrypted in IndexedDB (data-at-rest)
- **Category**: data-safety / security
- **File**: `src/infra/storage.ts:15,71-87` (`SavedState.sourcePdfs[].bytes`, `saveState`)
- **Evidence**: autosave persists `sourcePdfs: Array<{ id; name; bytes: Uint8Array }>` — the ORIGINAL source
  PDF, including any text a user has covered with a redaction box. Redaction is an export-time burn (the
  `element.burnLabel` "⚠ Burn on export" makes that clear for the export), but the persisted session keeps
  the secret in plaintext in IndexedDB with no encryption and no warning. A user who draws redactions, then
  closes the tab (or shares a profile / kiosk machine), leaves the secret recoverable from
  `pdf-editor` → `state` → `current.sourcePdfs[].bytes`. The encryption feature (`encryption.ts`) applies
  only to *export*, never to the at-rest session blob.
- **Recommendation**: document this explicitly as a known tradeoff, and/or offer "burn redactions now"
  (replace the persisted source bytes with the rasterized output) so a saved session does not retain the
  original. At minimum surface a one-time note that the local session retains unredacted source data.

### P2 — Eraser surviving-segment test uses the erase polyline's BBOX, not the stroke
- **Category**: bug / correctness
- **File**: `src/utils/eraserGeometry.ts:93-99` (`splitFreehandAtErase`)
- **Evidence**: after splitting a freehand stroke at crossings, each segment's survival is decided by
  `_pointInBbox(centroid, _polylineBbox(erasePoints))`. The erase polyline's bounding box can be far larger
  than the actual swept area (a long diagonal erase gesture has a big AABB). A freehand sub-segment whose
  centroid lands inside that AABB but nowhere near the erase stroke gets deleted even though the user never
  swept over it. Manifests as "the eraser deleted part of a drawing I didn't touch."
- **Recommendation**: test the segment centroid (or sample points) against proximity to the erase polyline
  itself (distance-to-polyline ≤ erase radius), not against its bounding box.

### P2 — Ink-layer strokes are not erasable by the eraser tool (two disjoint erase mechanisms)
- **Category**: ux / bug
- **File**: `src/handlers/eraserHandler.ts:76-114` vs `src/handlers/inkLayerHandler.ts:34`
- **Evidence**: `EraserHandler._applyErase` only iterates `this.app.elements` (i.e. `ShapeElement`
  freehand + other annotation elements). Freehand drawn through `InkLayerHandler` lives in a SEPARATE store
  (`InkLayer._strokes`, infra/inkLayer.ts) and is never visited by the eraser. The ink layer has its own
  `drawErase` mode that paints a `type:'erase'` destination-out stroke. So there are two unrelated "erase"
  concepts: the eraser tool (deletes/splits element-array freehand) and the ink-erase stroke (masks ink-layer
  pixels). A user who drew with the freehand *ink* tool and then picks the *eraser* tool will find it does
  nothing to that stroke. Confusing and undocumented.
- **Recommendation**: unify, or at least document which freehand path each tool produces and make the eraser
  also operate on ink-layer strokes (or hide the eraser when only ink-layer content exists).

### P3 — No toast/feedback confirming a redaction was placed (only the in-box "burn on export" label)
- **Category**: ux
- **File**: `src/handlers/drawingHandler.ts:228-241`
- **Evidence**: highlight (210), shape (287), and redaction (237) creation execute `AddElementCmd`, switch to
  `select`, and select the element — but emit NO toast. For most shapes that's fine, but redaction is a
  security-sensitive operation whose effect is deferred to export; the only signal that it is NOT yet applied
  is the small `burnLabel` span inside the box. A momentary toast ("Redaction added — applied on export")
  would reduce the risk of a user believing the content is already removed.
- **Recommendation**: emit an info toast on first redaction placement (or a one-time hint).

### P3 — `isBlack` warning style keys on exact `'#000000'` string
- **Category**: ux / bug
- **File**: `src/elements/redactionElement.ts:16`
- **Evidence**: `const isBlack = this.color === '#000000';` drives the red dashed warning border. The color
  comes from `colorInput.value` (drawingHandler.ts:234). If the picker ever returns uppercase (`#000000` vs a
  theme that yields `#000`), or the user picks a near-black, the distinct "this is a redaction" red-dashed
  affordance silently degrades to the muted `#888` style — making a redaction look like a benign filled box.
- **Recommendation**: normalize/compare luminance or treat the affordance as redaction-type-based, not
  color-equality-based.

### P3 — Element resize/rotate handles are pointer-only; no keyboard a11y; delete button lacks aria-label
- **Category**: a11y
- **File**: `src/elements/annotationElement.ts:38-71`
- **Evidence**: `createResizeHandle()` / `createRotationHandle()` are plain `<div>`s with no `tabindex`,
  `role`, or keyboard handlers — resize and rotate are unreachable without a pointer. `createControls()`
  delete is a real `<button>` (focusable) but its accessible name is only `title` (`element.deleteTitle`),
  no `aria-label`; its visible text is the glyph `×`. This is a broad cross-element a11y gap (applies to
  every annotation element including shapes/redaction/comment), not unique to this domain.
- **Recommendation**: add `aria-label` to the delete button and keyboard affordances (arrow-key
  move/resize, or numeric size/rotation inputs in the formatting toolbar) for element manipulation.

### P3 — `renderComment` silently truncates exported comment text to 200 chars
- **Category**: export-fidelity
- **File**: `src/export/pdfElementRenderer.ts:382` (`ce.text.slice(0, 200)`)
- **Evidence**: the comment element's on-screen `<textarea>` accepts unlimited text, but the export bakes
  only the first 200 characters with no overflow indication. A long sticky-note comment is silently clipped
  in the exported PDF. (Editor shows everything; export loses it.)
- **Recommendation**: wrap to multiple lines within the box height, or at least append an ellipsis / warn
  when truncation occurs.

---

## Checked and found CLEAN / correctly handled

- Redaction destructive burn on all PDF export paths (see headline) — solid.
- Undo/redo: shape/highlight/redaction creation → `AddElementCmd`; ink stroke → `InkStrokeCmd`; eraser
  delete/split → `BulkDeleteCmd`/`SplitStrokeCmd` wrapped in `MacroCmd`. All mutations go through the
  history manager. `InkStrokeCmd.undo()` uses `removeLastStroke(pageId)` (a per-page pop) — initially
  looked suspect, but the global undo stack is strict LIFO and per-page commands keep their relative order,
  so the per-page append/pop invariant holds across page switches and redo. No undo bug found.
- `SplitStrokeCmd` redo/undo re-finds by element id (inkCmds.ts:44-58) — correct, survives array churn.
- History overflow (50 cap) and redo invalidation dispose evicted commands (historyManager.ts:30-41).
- Comment uses `textarea.value`/`textContent` (commentElement.ts:53) — no innerHTML XSS surface.
- Highlight RGBA parse guards NaN hex (`parseHexCh`, highlightElement.ts:19).
- Redaction i18n keys present and translated in en/fr/ar (`element.burnLabel`, tool `redaction`).
- Eraser/drawing pointer capture + pinch-cancel state reset (drawingHandler.ts:299-313, BUG-32) is handled.
- Element-own-rotation burn (G2) and page-rotation burn (CORE-P0-1) both pixel-guarded in real Chrome.
