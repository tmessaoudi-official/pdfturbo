# DOCX editor — new-image INSERT (phase B, sub-slice 1) — design

**Date:** 2026-06-26
**Program:** max-fidelity follow-up **B**, sub-slice **1 of 4** (Insert → Move-core → Cut&paste → Drag).
**Status:** approved — proceed to implementation plan.

## Goal

Let the user **insert a new image** (PNG/JPEG) into the DOCX editor. The image renders in the
editor, survives the in-place `save()` round-trip as a real `w:drawing` (new `word/media` part +
rels + Content-Types), and — via follow-up C — appears in the Export PDF.

## Background (verified)

- The `docx_image` PM node already carries `dataB64`/`mime`/`widthPt`/`heightPt`/`anchorId`
  (default `-1`). `emitBlockTo` maps a node with `anchorId < 0` → a `DocImageBlock` with **no**
  `anchorId` — so a freshly-inserted image is distinguishable from existing (parsed) anchors.
- The save reconciler (`reconcileContainer`) segments body children by **boundaries** (tables +
  image/hyperlink anchor `w:p`) and zips them 1:1 in order; it **bails** to
  `reconcileParagraphsOnly` when `domBoundaries.length !== modelBoundaries.length`. A new image
  adds a model boundary the DOM lacks → without new code the insert is dropped.
- `reconcileImageAnchors` (the C2 save pre-pass, gated by `opts.editImages`) handles
  delete/resize of EXISTING anchors by positional `anchorId`. It runs after the new pass below.
- `opcParts.ts` already has the register-if-missing pattern (`registerPart`, `ensureHyperlinkRel`)
  + `setPart`/`getPart`/`hasPart` over `OpcPackage.files: Record<string, Uint8Array>`.

## Approach

A new save pre-pass **materializes** new image anchors into the DOM (minting OPC parts) BEFORE
`reconcileImageAnchors` + `reconcileContainer` run — so by the time the boundary-zip executes,
every model image boundary has a matching DOM `w:p` and counts line up.

### 1. `ensureImagePart(opc, bytes, mime)` → `{ rId, target }` (opcParts.ts)

Mirrors `ensureHyperlinkRel`, but for a binary media part:
- Pick a fresh `word/media/imageN.png|jpg` name (N = 1 + max existing `image\d+` in `word/media/`).
- Write the bytes: `opc.files[`word/media/imageN.ext`] = bytes`.
- Ensure a Content-Types **`Default Extension="png|jpeg" ContentType="image/png|jpeg"`** exists
  (images are typed by Default, NOT a per-part Override); add it if absent.
- Add a `Relationship Type=…/image Target="media/imageN.ext"` (rId = 1 + max existing) to
  `word/_rels/document.xml.rels`; return its `rId`.
- Pure, no new dep. (No reuse-by-content — each insert mints a new part; dedup is out of scope.)

### 2. `buildDrawingParagraph(dom, rId, cx, cy, docPrId)` → `w:p` Element (docModel.ts)

Build a minimal spec-valid inline-image paragraph:
`w:p > w:r > w:drawing > wp:inline > (wp:extent cx cy) (wp:docPr id name) a:graphic >
a:graphicData(uri=…/picture) > pic:pic > (pic:nvPicPr) (pic:blipFill > a:blip r:embed=rId)
(pic:spPr > a:xfrm > a:ext cx cy + a:prstGeom prst=rect)`. EMU = pt×12700. `docPrId` unique.

### 3. `materializeNewImageAnchors(opc, body, blocks)` (docModel.ts) — the placement engine

A **parallel walk** of `blocks` and `body`'s block children, maintaining a DOM insertion cursor:
- Iterate `blocks` in order; keep `domChildren = containerBlockEls(body)` and an index cursor `c`.
- For an EXISTING boundary block (table, or image/hyperlink anchor with a DOM match) or a TEXT
  paragraph: advance `c` past the next corresponding DOM child (skip one DOM block child).
- For a NEW image block (`isDocImageBlock && b.image && b.anchorId === undefined`): call
  `ensureImagePart` → `buildDrawingParagraph`, `body.insertBefore(newP, domChildren[c] ?? null)`
  (null → append), and splice `newP` into the local `domChildren` array at `c`, then advance `c`
  past it. So a later new image's cursor stays correct.
- Tolerant cursor: when the model has more text paragraphs than the DOM (also-new text), `c`
  simply doesn't advance past a missing DOM child — the new image still lands after the
  available preceding blocks; `reconcileContainer` then reconciles the surrounding text.

After this pass the new `w:p` IS a DOM boundary, so `reconcileImageAnchors` (which keys on
`anchorId` and only touches blocks WITH a numeric anchorId — new ones have none, so they're
skipped by delete/resize) and `reconcileContainer` (boundary counts now equal) run correctly.

### 4. Wire into `applyBlocks` — via a minting CALLBACK (avoid an import cycle)

`docModel.ts` must NOT import `opcParts.ts` (cycle: `opcParts` already imports `NumberingMap`
from `docModel`). So `materializeNewImageAnchors` does NOT take `OpcPackage`; it takes a
**minting callback** `mintImage(bytes: Uint8Array, mime): string` (returns the `rId`). It decodes
each new block's `image.dataB64` → bytes, calls `mintImage` → `rId`, then `buildDrawingParagraph`.

`applyBlocks` gains `opts.mintImage?`. When `opts.editImages && opts.mintImage` it runs
`materializeNewImageAnchors(opts.mintImage, body, blocks)` before `reconcileImageAnchors`. The
editor save in `docxProseMirror.ts` (which holds `opc`) passes
`mintImage: (bytes, mime) => ensureImagePart(opc, bytes, mime).rId`. Legacy callers
(`applyParagraphRuns`, paragraphs-only) pass neither → byte-identical, no materialization.

### 5. UI — Insert image button (docxToolbar.ts)

An **Insert image** button (📷) + a hidden `<input type=file accept="image/png,image/jpeg">`.
On pick: read bytes → sniff PNG/JPEG (reject others with a notify) → `createImageBitmap(blob)`
for natural px → `widthPt = min(naturalW × 0.75, contentWidthPt≈468)`, `heightPt` proportional →
base64 → dispatch a transaction inserting a `docx_image` node (`anchorId: -1` + data attrs) as a
new block at the selection (replace selection / insert after the current block). The NodeView
(C2) immediately gives it resize/delete handles.

## Invariants

- **Byte-identical when no image inserted:** materialization no-ops when no model block is a new
  image; legacy callers never invoke it.
- A new image carries **no** `anchorId`, so `reconcileImageAnchors` (identity-only on numeric
  anchorId) never deletes or resizes it during the same save — its size comes from the built
  `w:extent`. (On the NEXT open it parses as an existing anchor with a fresh parse-time anchorId.)
- PNG/JPEG only; block-level insert (not inline-with-text); cell-nested insert out of scope.

## Testing (TDD)

**jsdom — `tests/docx/` (new `docImageInsert.test.ts` + extend `opcParts`/`docModelTables`):**
- `ensureImagePart`: writes `word/media/imageN.*`, adds the Content-Types Default (once), adds an
  image Relationship, returns a fresh rId; a second call mints image2 + rId(N+1).
- `buildDrawingParagraph`: emits `w:drawing`/`wp:extent`(cx,cy)/`a:blip @r:embed=rId`.
- `materializeNewImageAnchors`: a model `[P, newImg, P, existingImg]` against DOM `[P,P,existingImg]`
  inserts the new `w:p` BETWEEN the two P's (parallel-walk placement) and leaves boundary counts
  equal; `applyBlocks` with that model round-trips a valid doc with 2 `w:drawing`.
- **byte-identical**: `applyBlocks` with no new image (and without `editImages`) unchanged.

**real-Chrome — `tests/browser/docx-image-insert.browser.test.ts`:**
- toolbar Insert → fake a File pick (set the input's files + dispatch change, or call the exposed
  insert handler with bytes+dims) → the image renders in the editor (`[data-docx-image]`), save →
  reopen → the `w:drawing` + `word/media` part survive; the inserted image is selectable/resizable.

**Gate:** full deploy gate + a live screenshot of an inserted image in the editor.

## Out of scope (later sub-slices / ceilings)

- Move/reorder (sub-slice 2), cut&paste (3), drag (4).
- Inline-with-text images, cell-nested insert, non-PNG/JPEG, image dedup by content.
