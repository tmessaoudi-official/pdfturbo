# DOCX→PDF export-staleness fix — design

**Date:** 2026-06-26
**Sub-project:** max-fidelity program, follow-up **C** (after C2 image edit shipped)
**Status:** approved — proceed to implementation plan

## Problem

The DOCX editor's **Export PDF** button (`docxEditorController.ts` `onExportPdf`) renders the
editable model to a PDF via `docModelToPdfBytes(model, { images })`, where `images =
handle.getImages()`. `getImages()` returns the **originally extracted** `DocImage[]`
(`extractDocImages`, run once at mount): original dimensions, original `blockIndex` positions,
and **deleted images still present**. `docModelToPdfBytes` keys those images positionally
(`imagesByBlock` by `DocImage.blockIndex`) and draws each at its original `widthPt`/`heightPt`.

After the C2 image-edit work (resize / delete), the **live model is the source of truth**:

- `getModel()` → `docToDocModel` → `emitBlockTo` (`docxProseMirror.ts:222-234`) reads
  `dataB64`/`mime`/`widthPt`/`heightPt` back from the `docx_image` PM node attrs into
  `DocImageBlock.image`. A NodeView **resize** updates those attrs, so the model carries the
  **new** dims.
- A **deleted** image's `docx_image` node is gone → its `DocImageBlock` is **absent** from the model.

So an in-session resize/delete is correct in the **model** and in the **Save .docx** output
(the C2 `reconcileImageAnchors` save pre-pass), but the **Export PDF** path ignores the model's
image data and uses the stale `getImages()` channel → the PDF shows the original size and still
contains deleted images. The edit only appears in the PDF after Save .docx + reopen.

## Approach (chosen: self-rendering image blocks)

Render each image directly from its `DocImageBlock.image` in the existing `model.blocks` loop,
at the block's own position. The model already holds live bytes + dims, and a deleted image's
block is absent — so resize and delete are reflected for free. Remove the redundant stale channel.

Rejected alternatives:
- **Reconcile `getImages()` by `anchorId`** — keeps two channels, more code, `anchorId` is
  positional and fragile.
- **Re-extract from a fresh `save()`** — correct but heavy (full OPC round-trip per export) and
  couples export to the save path.

## Changes

### 1. `src/docx/docxToPdf.ts`

- In the top-level render loop (currently `docxToPdf.ts:510-516`), for a block where
  `isDocImageBlock(block) && block.image`, draw the image from `block.image` via `drawImage`,
  at the block's position. A block with `image === undefined` (unsupported format,
  link-fallback, or cell-nested anchor) draws nothing.
- `drawImage` is refactored to take the image fields it needs (`dataB64`, `mime`, `widthPt`,
  `heightPt`) — same shape as the `DocImage` fields it already reads, now sourced from
  `block.image`. The fit-to-content-width and page-break logic is unchanged.
- **Remove** the `imagesByBlock` map (`docxToPdf.ts:502-507`), the `for (const im of
  imagesByBlock.get(bi))` draw (line 515), and the `images?: DocImage[]` field from
  `DocxToPdfOptions`. The `DocImage` type import is dropped if no longer referenced.

### 2. `src/docx/docxEditorController.ts`

- `onExportPdf` (lines ~200-203): drop `const images = handle.getImages()` and the `{ images }`
  argument — call `docModelToPdfBytes(model)`.
- `handle.getImages()` stays defined on the editor handle (unused by export; retained for
  phase B's insert/move work). No other production caller exists.

## Invariants / guarantees

- **Unedited export unchanged:** at mount, `extractDocImages` bytes are merged into the model's
  image blocks before the PM doc is built, so `getModel()` carries them for an untouched doc →
  the exported PDF still embeds every supported image. [Verified: Phase-1 mount merge + the
  round-trip in `emitBlockTo`.]
- **Resize reflected:** the model block's `image.widthPt`/`heightPt` are the NodeView-updated
  values → `drawImage` uses them.
- **Delete reflected:** the deleted block is absent → no draw.
- **Ceiling unchanged:** cell-nested images and non-PNG/JPEG media have no `block.image` → not
  drawn (same as today); move/insert is phase B.

## Testing (TDD)

Image-embed assertions live in the **browser** suite — the existing inline-image test is there,
and there is no in-repo evidence that pdf-lib `embedPng` runs under jsdom, so we do not depend on
it. jsdom covers the non-image regression (option removal must not break the text/table path).

**real-Chrome — `tests/browser/docx-to-pdf.browser.test.ts`** (embed + pdf.js both work here):
- rewrite the existing "embeds an inline image passed via `{ images }`" test to build a model
  with a `DocImageBlock` (image data on the block) instead of passing `{ images }` (the channel
  is gone) → pdf.js `getOperatorList` shows a `paintImageXObject`; proves render-from-block.
- **delete** case: the same model with the image block **removed** → no `paintImageXObject`;
  proves delete reflected.
- **resize** case: the same image block exported at a larger `widthPt` → the painted image is
  wider (pdf.js `paintImageXObject` transform / a pixel check); proves resize reflected.

**jsdom — `tests/docx/docxToPdf.test.ts`:**
- `docModelToPdfBytes(model)` with a `DocImageBlock` present does not throw and still produces a
  valid PDF (text/table content intact) — guards that removing `opts.images` and adding the
  image-block branch didn't break the no-image render path. (No image-XObject assertion here —
  that is the browser suite's job.)
- the existing text/heading/list/table/empty cases continue to pass with the `images?` option
  removed (call sites updated).

**Gate:** full deploy gate (`npm audit` → `ocr:assets` → type-check → lint → test → test:browser
→ test:coverage:export → build) + a live before/after Export-PDF screenshot from the dev server.

## Out of scope

- Image **move/reorder** and **new-image insert** (phase B; insert needs a new `word/media`
  part + rels + `[Content_Types]`).
- Cell-nested image rendering in DOCX→PDF (existing ceiling).
- Any change to the Save .docx path (`reconcileImageAnchors`) — already correct from C2.
