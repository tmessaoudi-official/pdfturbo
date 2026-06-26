# DOCX editor — image MOVE/reorder (phase B, sub-slice 2 of 4) — design

**Date:** 2026-06-26
**Program:** max-fidelity follow-up **B**, sub-slice **2 of 4** (Insert ✓ → **Move-core** → Cut&paste → Drag).
**Status:** approved — proceed to implementation plan.

## Goal

Let the user **move an existing image up/down** within the DOCX editor — past text AND across tables /
other images — persisted through the in-place `save()`. The image keeps its bytes, size, and identity;
no other content is rebuilt. This sub-slice builds the **save-side reorder primitive** that cut&paste
(slice 3) and drag (slice 4) will reuse.

## Scope (decided)

- **IMAGE-only move, any distance** — an image may move past text and **cross tables / other images**.
- Tables and paragraphs themselves do **not** move (full arbitrary-block reorder is out of scope — it
  would need stable identity for every boundary + text). Images are tractable because they carry
  `anchorId`.
- **UI:** ▲/▼ buttons on the selected image's NodeView (beside C2's ✕/resize) + **Alt+↑/↓** keyboard when
  an image is selected. Each press moves the image past **one** adjacent top-level block.
- No new dependency, no `SCHEMA_VERSION` bump, rides `VITE_FEATURE_DOCX_EDIT`.

## Background (verified against the shipped code)

- The editor doc is a flat top-level block list; a `docx_image` is a selectable leaf atom (C2) with a
  numeric `anchorId` (parse-time index among TOP-LEVEL drawing anchors; `-1` for a freshly-inserted one).
- `reconcileContainer` (the save reconciler) segments body children by **boundaries** (tables + anchor
  `w:p`) and zips them **1:1 in order**, reconciling each text segment positionally. **Key consequence:**
  a reorder that changes *boundary order* (image crossing a table or swapping with another image) pairs
  the wrong DOM element with the wrong model block → corruption. A reorder among *text only* technically
  survives the existing reconcile, but at the cost of **rebuilding the displaced paragraph** (its
  unmodeled `pPr` is lost). MOVE-core must therefore physically relocate the image's `w:p` element by
  identity so the boundary order matches the model AND no text is rebuilt.
- C2's `reconcileImageAnchors(body, blocks)` (delete/resize pre-pass, gated by `opts.editImages`) keys on
  **position** (`drawingAnchorParas(body)[i]` ↔ `anchorId i`), valid only because the DOM was unchanged
  since parse. A move breaks that positional assumption — which is exactly why this design replaces the
  positional key with a once-built identity map.
- Slice 1's `materializeNewImageAnchors(mintImage, body, blocks)` already walks model blocks vs the body's
  block children with a per-block DOM cursor to place NEW image anchors. MOVE generalizes that same walk.

## Approach (unified placement keyed by an identity map)

### 1. Identity map (the footgun fix)

In `applyBlocks`' `editImages` branch, build **once, before any mutation**:

```
anchorEl: Map<number, Element>   // anchorId → its original DOM w:p
```

from `drawingAnchorParas(body)` (the original DOM is in parse order, so `D[i]` has `anchorId i`). Element
references survive both DOM deletion and reordering, so this single snapshot keys every later pass.

### 2. `reconcileImageAnchors` — refactored to be map-keyed

Delete/resize now look up `anchorEl.get(id)` instead of `D[i]`:
- **delete:** for every `anchorId` in `anchorEl` that is **absent** from the model's image blocks → remove
  that element.
- **resize:** for a surviving image block, rewrite `wp:extent` (+ inner `a:ext`) only when dims differ
  (EMU = pt×12700) — unchanged logic, just map-keyed lookup.
- Same C2 SAFETY GUARD, re-expressed on the map: if the model's image anchorIds aren't a duplicate-free
  subset of the map keys → skip the pre-pass entirely (leave every image verbatim). C2's behavior is
  preserved (its tests must stay green); this removes the "ordering is load-bearing" constraint.

### 3. `placeImageAnchors(mintImage, anchorEl, body, blocks)` — generalizes `materializeNewImageAnchors`

Walk the model blocks in order with a DOM cursor over `containerBlockEls(body)`. The cursor **skips image
anchor elements** — text paragraphs and tables are the only fixed reference points (images are the things
being repositioned). For each model block:
- **text / table block:** advance the cursor to the next non-image-anchor DOM child.
- **existing image** (`isDocImageBlock && image && typeof anchorId === 'number'`): let `el =
  anchorEl.get(anchorId)`; if missing → skip (verbatim, never throw); else `body.insertBefore(el, ref)`
  where `ref` = the DOM child at the cursor (or `null` → append). Moving an already-in-place element to
  its current spot is a no-op.
- **new image** (`image && anchorId === undefined`): the slice-1 path — `mintImage` → `buildDrawingParagraph`
  → `insertBefore(newP, ref)`.
- After placing/inserting an image, advance an insertion marker so consecutive images keep model order.

`materializeNewImageAnchors` is **absorbed** into this function (the `anchorId === undefined` branch);
slice-1's insert behavior and its tests are preserved.

### 4. Pass order in `applyBlocks` (`editImages` branch)

```
build anchorEl (once, pre-mutation)
reconcileImageAnchors(anchorEl, blocks)        // delete + resize, map-keyed
placeImageAnchors(opts.mintImage, anchorEl, body, blocks)  // move + insert
reconcileContainer(dom, body, blocks, ids, false)          // UNCHANGED
```

`applyBlocks` always re-parses the **pristine** `originalXml`, so every save replays from the original DOM
with the model carrying the net order + original anchorIds — multiple session moves compose, no
mid-session anchorId reassignment. **Byte-identical when nothing moved/inserted/deleted** (every pass
no-ops). Legacy callers (`applyParagraphRuns`) pass neither `editImages` nor `mintImage` → untouched.

### 5. PM-side `moveImage(dir: -1 | 1)`

A command operating on the selected `docx_image` at doc top level (depth 1): remove the node and
re-insert it before the previous / after the next **top-level** block, in ONE transaction (undoable via
the already-wired `prosemirror-history`). No-op at bounds (already first/last top-level block) and when
the selection is not a `docx_image`. Wired to:
- NodeView **▲/▼** buttons in `docxImageView.ts` (beside ✕/resize; hidden/disabled at the respective
  bound).
- An **Alt+↑/↓** keymap in `docxProseMirror.ts`, active only on a `docx_image` NodeSelection.

## Why full fidelity

Only image `w:p` elements relocate; text and tables are never removed or rebuilt. After placement the
boundary order matches the model, so `reconcileContainer`'s segment-zip is all in-place `setRunsOn` — no
displaced paragraph loses its `pPr`. This strictly beats the rejected "reorder-boundaries-then-let-
reconcile-shuffle-text" alternative.

## Invariants

- **Byte-identical** when no image moved/inserted/deleted (all passes no-op; legacy callers unaffected).
- A moved image keeps its `anchorId` for the session; on the NEXT open the doc re-parses and anchorIds are
  reassigned by the new order — consistent.
- The C2 SAFETY GUARD (anchorIds ⊆ map keys, dup-free) still bails to verbatim on any anomaly.
- `reconcileContainer` is not modified.

## Testing (TDD)

**jsdom — `tests/docx/docImageMove.test.ts` (+ extend `docModelImageEdit`/`docxImageBridge`):**
- `placeImageAnchors`: move an image past text → assert the **displaced paragraph's `pPr` survives**
  (full fidelity, not rebuilt) and the drawing landed at the new index; move crossing a table; swap two
  images; move + a new-image insert in one save; delete + move in one save; **byte-identical** when no
  move.
- map-keyed `reconcileImageAnchors`: existing C2 delete/resize cases still pass (regression).
- PM `moveImage(-1/+1)`: reorders the node, no-op at bounds, single undoable transaction.
- NodeView: ▲/▼ present and dispatch `moveImage`.

**real-Chrome — `tests/browser/docx-image-move.browser.test.ts`:**
- mount the editor on a doc with `[text, image, table, text]`; select the image; click ▲ (or Alt+↑) to
  move it; `save()` → reopen → the `w:drawing` is in its new position relative to the table; round-trips;
  the displaced text is intact. Eyes-on screenshot to `qa-shots/b-move/`.

**Gate:** full deploy gate (audit → ocr → type-check → lint → jsdom → browser → coverage:export → build),
all green; plus the C2 + slice-1 suites green (the refactor).

## Out of scope (later sub-slices / ceilings)

- Moving tables/paragraphs themselves; move-to-top/bottom; multi-select move.
- Cut&paste (slice 3) and drag-to-reorder (slice 4) — both reuse `placeImageAnchors`.
- An image nested inside a table cell stays opaque/non-movable (the standing cell-nested ceiling).
