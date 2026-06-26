# Sub-project C Phase 2b — DOCX editor image edit (delete + resize) + editor undo

**Date:** 2026-06-26
**Status:** Approved (design) → implementation plan next
**Program:** Max-fidelity (true-edit + PDF→DOCX + DOCX editor). Sub-project C = DOCX editor.
**Predecessors:** Phase 1 (image/hyperlink preservation + read-only display, `21aab3f`); Phase 2a
(editable external hyperlinks / C3, `17a4999`..`084492b`).

## Goal

Make a top-level inline/floating **image** in the DOCX editor **resizable** and **deletable**, while
every untouched image, every hyperlink anchor, every table, and every cell-nested image stays
**byte-exact** on save. Fold in **editor-wide undo** (`prosemirror-history`) so the new destructive
operations — and all existing typing — are recoverable.

This is the program's last item (DXE-2 / "C2"). Move/reorder and new-image insert are explicitly **v2**.

## Background (verified in code, 2026-06-26)

- `docx_image` is a leaf **atom** PM node carrying `{dataB64, mime, widthPt, heightPt}`
  (`src/docx/docxSchema.ts`). It renders the extracted PNG/JPEG read-only via a `data:` URI.
- `src/docx/docxImages.ts`: `extractDocImages` reads each top-level anchor's `wp:extent` `cx/cy` at
  `EMU_PER_PT = 12700` → `widthPt/heightPt` (0 when absent); keyed by `blockIndex` (position in
  `model.blocks`).
- Save path: `docToDocModel(view.state.doc)` → `applyBlocks(originalXml, blocks, ids)` →
  `reconcileContainer(dom, body, blocks, …)` (`src/docx/docModel.ts`).
- The reconciler treats a `w:p` containing `w:drawing` (or an internal-only `w:hyperlink`) as an
  **opaque boundary**: counted 1:1, segmented around, **left verbatim** (tables recurse; image/
  hyperlink anchors get nothing). On a boundary-count divergence it bails to `reconcileParagraphsOnly`
  which also skips anchors → images preserved even if the PM doc diverges (the Phase-1 invariant).
- **No `prosemirror-history` is wired** — the editor has *no* undo today (typing included). `history`
  is not installed (not even transitively). It is the canonical MIT ProseMirror package.

## Design

### Identity: `anchorId`

The reconciler must map an *edited* model image block back to the *specific* DOM `w:p`, surviving the
ProseMirror round-trip and a sibling delete (which shifts every later block index). `blockIndex` is not
stable across a delete; introduce a dedicated identity:

- **`anchorId`** = the 0-based index of a top-level **drawing** anchor (`w:p` containing `w:drawing`)
  among all top-level drawing anchors **in document order**, computed at parse time.
- Stamped onto the `DocImageBlock` for drawing anchors only (hyperlink anchors get none).
- Carried on the `docx_image` PM node as an attr (`default: -1` for safety), round-tripped by the
  bridge.

Document order is stable, and the save pre-pass is the **first** DOM mutation, so the i-th DOM drawing
anchor at save time still has implicit id `i` — matching parse-time `anchorId = i`.

### Save pre-pass: `reconcileImageAnchors`

A new step inside `applyBlocks`, **before** `reconcileContainer`:

1. `D[]` = top-level drawing-anchor `w:p` in document order (`drawingAnchorParas(body)`); `m = D.length`.
2. `S` = `Set` of `anchorId` over the model's top-level drawing image blocks (a `DocImageBlock` with an
   `image` and `anchorId >= 0`).
3. **Safety guard:** if `S` contains a duplicate, a value `< 0`, or a value `>= m`, **skip the entire
   pre-pass** → fall through to the unchanged `reconcileContainer` (full Phase-1 verbatim preservation;
   never corrupt). This covers reorder-by-cut/paste, stale ids, or any unforeseen divergence.
4. Otherwise, for each `D[i]`:
   - `i ∉ S` → **delete**: `D[i].remove()`.
   - `i ∈ S` → **resize if changed**: let `blk` be the block with `anchorId === i`; compute
     `cx = Math.round(blk.image.widthPt * 12700)`, `cy = Math.round(blk.image.heightPt * 12700)`.
     Read the anchor's current `wp:extent` `cx/cy`; if **either differs**, call `rewriteExtent(D[i],
     cx, cy)`. If unchanged, **touch nothing** (byte-exact).

After the pre-pass, the DOM drawing-anchor count equals the surviving model drawing-block count, so
`reconcileContainer`'s boundary matching realigns and the paragraph/table/hyperlink logic runs
unchanged.

### `rewriteExtent` (pure DOM helper)

Update the drawing's size operands, only the numeric attrs (no structural rewrite, cardinal rule held):
- `wp:extent` (the *first* `w:drawing` descendant's, inline or anchor): set `cx`/`cy`.
- the inner picture transform `a:ext` (under `pic:spPr/a:xfrm/a:ext`) **when present**: set `cx`/`cy`
  too, so Word scales the graphic, not just the layout box. (`wp:effectExtent` is decorative padding;
  leave it.)

### UI: `docx_image` NodeView (`src/docx/docxImageView.ts`)

`docx_image` stays a leaf atom (already selectable as a `NodeSelection` and deletable). Register a
NodeView so it can render handles and drive resize:

- Renders the `<img>` (data URI) sized to `widthPt/heightPt` (pt → CSS px at the editor's existing
  `pt` rendering, matching Phase-1).
- A selection chrome layer shown only while the node is the active `NodeSelection`: a ring + **corner
  drag handles** and a small **✕** button.
- Drag a corner: pointer math computes a new width from the cursor delta; **aspect-locked** to the
  node's original `widthPt/heightPt` ratio unless **Shift** is held (free); on pointer-up dispatch
  `tr.setNodeMarkup(pos, undefined, { …attrs, widthPt, heightPt })`. (One transaction = one undo step.)
- ✕ (and Delete/Backspace on the selected atom) → `tr.deleteSelection()` / delete the node at `pos`.
- `stopEvent`/`ignoreMutation` configured so the handle pointer interaction doesn't leak into PM
  editing or trip the atom's contentless mutation guard.

The drag listeners attach to `document` during a drag and detach on pointer-up (no dangling globals);
the NodeView's `destroy()` removes any in-flight listeners.

### Editor undo: `prosemirror-history`

- Add the dep (`npm i prosemirror-history`, MIT).
- Insert `history()` into the plugin list (before the keymaps) and a `keymap({ 'Mod-z': undo,
  'Mod-y': redo, 'Mod-Shift-z': redo })` (`prosemirror-history`'s `undo`/`redo`).
- Composition: `findReplacePlugin` already batches replace-all into one transaction (one undo step);
  `tableEditing` uses ordinary transactions (each its own step). A resize = one `setNodeMarkup` tr;
  a delete = one tr. Verified by tests below.

### Data flow

```
parse: drawingAnchorParas → stamp anchorId on DocImageBlock
     → imageBlockToNode(anchorId) → docx_image node (NodeView)
edit:  drag handle → setNodeMarkup(widthPt,heightPt)  |  Delete/✕ → deleteSelection   (undoable)
save:  docToDocModel → blocks (emitBlockTo reads anchorId back)
     → applyBlocks:
          reconcileImageAnchors(dom, body, blocks)   ← delete w:p / rewriteExtent (changed only)
          reconcileContainer(dom, body, blocks, …)    ← unchanged (paras/tables/links)
     → packOpc
```

## Files

- **`src/docx/docModel.ts`** — `DocImageBlock.anchorId?: number`; stamp `anchorId` in
  `parseContainerBlocks` (body level only — a running drawing-anchor counter); pure
  `drawingAnchorParas(container)` + `rewriteExtent(drawingPara, cx, cy)`; `reconcileImageAnchors`
  pre-pass called first in `applyBlocks`.
- **`src/docx/docxSchema.ts`** — `docx_image` gains `anchorId: { default: -1 }`.
- **`src/docx/docxImageView.ts`** *(new)* — the resize/delete NodeView.
- **`src/docx/docxProseMirror.ts`** — `imageBlockToNode` passes `anchorId`; `emitBlockTo` reads
  `anchorId` back into the block; register `nodeViews: { docx_image }`; add `history()` + undo/redo
  keymap.
- **`src/styles/modals.css`** — selection ring, corner handles, ✕ button.
- **`package.json`** — `prosemirror-history` dependency.

## Testing

**jsdom** (`tests/docx/`):
- `docModelImageEdit.test.ts`: `anchorId` stamped per drawing anchor (skips hyperlink anchors);
  pre-pass deletes the right `w:p` when an `anchorId` is absent; `rewriteExtent` sets `wp:extent`
  (+ `a:ext` when present) and is **byte-identical when dims unchanged**; the **safety guard** (dup /
  out-of-range id) → verbatim fallback; a delete + a resize together; hyperlink anchor, table, and
  cell-nested image all **untouched**; full round-trip (resize → save → reparse → new dims).
- `docxImageBridge` (extend): `anchorId` survives node↔block round-trip.

**real-Chrome** (`tests/browser/docx-image-edit.browser.test.ts`):
- Selecting the image shows handles + ✕; a corner **drag resizes** it (pixel-assert the `<img>` width
  grew); **Shift** drag changes aspect; **✕ / Delete** removes it. Save → reparse: the resized image's
  `wp:extent` changed; the deleted image's `w:drawing` is gone; an **untouched** image's `w:p` is
  byte-identical. **Undo** (`Mod-z`) reverts a resize and a delete. Screenshot → `qa-shots/c-phase2b/`.

**Gate:** full deploy gate (`npm audit` → `ocr:assets` → type-check → lint → test jsdom →
test:browser → coverage:export → build); the browser suite is deploy-blocking.

## Byte-exactness guarantees

- No image edited → pre-pass writes nothing (no delete; resize compares-then-skips) → untouched
  document byte-identical.
- Any identity inconsistency → pre-pass skipped entirely → Phase-1 verbatim preservation.
- `rewriteExtent` mutates only `cx/cy` numeric attrs on existing elements — no element add/remove/
  reorder (cardinal in-place rule).

## Ceilings (v1)

- **Move / reorder** an image and **insert** a new image → v2 (insert = new `word/media` part + rels +
  `[Content_Types]` Default, mirroring `opcParts` register-if-missing).
- **Cell-nested** images stay opaque/non-editable (Phase-1 ceiling — `extractDocImages` is top-level).
- **Unsupported-format** images (EMF/WMF, or a missing media rel) that `extractDocImages` can't read
  round-trip as a `docx_link` fallback; they keep their `anchorId` so the pre-pass **preserves** them
  verbatim (never deleted/resized) — but they are not displayed or editable in v1.
- A paragraph mixing **flowing text + an inline image** is whole-anchor opaque (Phase-1 ceiling): the
  whole `w:p` is one atom, so **delete removes the whole paragraph (its hidden text too)** — the only
  consistent behavior (stripping just the `w:drawing` leaves a text para with no model block, which the
  reconciler removes anyway). **Undo recovers it** (the safety net C2 adds). Resize only touches `cx/cy`.
- Resize keeps the image's **anchor position/wrap** (`wp:anchor` wrapping mode untouched); only size
  changes.
- The editor's **DOCX→PDF export** (`getImages()` → `docxToPdf`) reads the *originally extracted*
  images; an in-session resize/delete is reflected in the **DOCX save**, and in PDF export only after
  save + reopen (re-extract). Wiring the live model into the export is a v2 follow-up.

## Out of scope / hard walls

Image cropping, rotation via the editor, alt-text editing, OLE objects, SmartArt, charts.
