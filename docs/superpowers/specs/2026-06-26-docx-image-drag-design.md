# DOCX editor — image Drag-to-reorder (Sub-project B, sub-slice 4) — Design

> Follow-up B, the LAST of 4 sub-slices (INSERT ✓ · MOVE ✓ · CUT&PASTE ✓ · **Drag**). Reuses the
> slice-2 save path (`placeImageAnchors` relocates a top-level `w:drawing` by `anchorId`) — adds **no
> new save logic**. The only new engine code is a generalization of the slice-2 move primitive to an
> arbitrary target index; everything else is NodeView pointer handling + a drop indicator.

## Goal

Drag an image with the pointer to reorder it among the document's **top-level** blocks, with a live
drop-indicator line showing where it will land, persisted through the in-place `save()`.

## Approach (chosen: custom pointer drag, "B")

A custom pointer drag on the image `<img>` body — NOT native HTML5 drag-drop. Rationale (recorded in
the program Decisions Log): a custom drag emits only a **move** transaction so it can never duplicate
`anchorId` (the save-guard verbatim-bail hazard); it snaps drops to top-level block gaps only (the move
model's sole representable space — cell images stay opaque); and image-body=move vs `.se`-handle=resize
is a clean element-level hit-test that reuses the existing custom-pointer architecture.

## Architecture

### Engine — `moveImageToGap` (pure, new) + `moveImageAt` refactor

In `src/docx/docxImageMove.ts`, add a gap-based generalization and refactor the ±1 mover to call it:

```
// gap g ∈ [0, childCount]: insert the image BEFORE the original top-level child at index g
// (g === childCount → at document end). No-op (null) if g is the image's own gap (g === ci || g === ci+1).
export function moveImageToGap(state, pos, gap): Transaction | null
  - node = doc.nodeAt(pos); guard docx_image + resolve(pos).depth === 0
  - ci = $pos.index(0); childCount = doc.childCount; g = clamp(gap, 0, childCount)
  - if (g === ci || g === ci + 1) return null
  - gapPos = g >= childCount ? doc.content.size : Σ child(j<g).nodeSize   // ORIGINAL-doc position
  - tr = state.tr.delete(pos, pos + node.nodeSize)
  - tr.insert(tr.mapping.map(gapPos), node); tr.setSelection(NodeSelection at insertPos)
  - return tr.scrollIntoView()

// moveImageAt(state, pos, dir) becomes:  moveImageToGap(state, pos, ci + (dir < 0 ? -1 : +2))
//   dir -1 → gap ci-1 (before previous sibling); dir +1 → gap ci+2 (after next sibling).
//   Bound behavior is preserved: at ci=0 dir-1 → gap clamps to 0 === ci → null; at ci=last dir+1 →
//   gap clamps to childCount === ci+1 → null. So slice-2 moveImageAt/moveImage tests stay green.
```

### Drop-target math — `dropTargetIndex` (pure, new)

```
// Which top-level gap is nearest a viewport Y? Counts top-level block midpoints above clientY.
export function dropTargetIndex(view, clientY): number   // returns g ∈ [0, childCount]
  - p = 0; g = 0
  - for each top-level child i: mid = (coordsAtPos(p+1).top + coordsAtPos(p+child.nodeSize-1).bottom)/2
      if (clientY > mid) g = i + 1
      p += child.nodeSize
  - return g
```

Top-level only by construction → a drop can never target a table-cell/inline position the save can't
represent. (jsdom has no layout → tested with a stubbed `view.coordsAtPos`; real geometry is
browser-tested.)

### NodeView wiring — `src/docx/docxImageView.ts`

Pointerdown on the `<img>` body (the `.se` handle, ✕, and ▲/▼ children already capture their own
events via `stopEvent`, so they are unaffected):

- **pointerdown** on `img`: record `startX/startY`, add document `pointermove`/`pointerup` listeners,
  but do **not** start a drag yet. (Don't `preventDefault` yet — a plain click must still select.)
- **pointermove**: once movement exceeds a **5px threshold**, enter drag mode — add a
  `.docx-image-dragging` class (grabbing cursor + dim the image) and, on each move, position a single
  reused drop-indicator element (`.docx-image-drop-line`, a 2px horizontal line) at the gap returned by
  `dropTargetIndex(view, e.clientY)` (mapped to the editor's client rect). Below threshold: do nothing.
- **pointerup**: remove the listeners + indicator + dragging class. If a drag was active →
  `moveImageToGap(view.state, getPos(), dropTargetIndex(view, e.clientY))` and dispatch when non-null
  (no-op if the drop is the image's own gap). If the threshold was never crossed → it was a plain
  **click**; do nothing (PM's default already selected the node on pointerdown).

The drop-indicator line is appended to the editor's scrolling container (or `view.dom.parentElement`),
absolutely positioned, `pointer-events:none`, removed on pointerup/destroy.

### Save — UNCHANGED

A drag produces exactly the same kind of move transaction as ▲/▼. On `save()`, `placeImageAnchors`
already relocates the image's `w:drawing` to its new top-level position by `anchorId` (any distance).
No change to `docModel.ts`, `applyBlocks`, or `reconcileContainer`.

## Coexistence with resize / move buttons

- `.se` handle → resize (its own pointerdown, unchanged). `<img>` body → drag-move. Different elements.
- `stopEvent` continues to return true for `.se`/✕/▲▼. The `<img>` is NOT in `stopEvent`, so PM still
  handles selection on a plain click; the threshold guard prevents a click from moving anything.
- One `moveImageToGap` transaction → one `prosemirror-history` undo step (same as ▲/▼ and resize).

## Files

- **Modify** `src/docx/docxImageMove.ts` — add `moveImageToGap` + `dropTargetIndex`; refactor `moveImageAt`.
- **Modify** `src/docx/docxImageView.ts` — image-body pointer drag + drop-indicator.
- **Modify** `src/styles/modals.css` (alongside the existing `.docx-image-handle`/`.docx-image-del`/
  `.docx-image-move` rules) — `.docx-image-dragging` + `.docx-image-drop-line`.
- **Tests:** `tests/docx/docxImageMove.test.ts` (extend) + `tests/browser/docx-image-drag.browser.test.ts`.

## Testing

**jsdom (`tests/docx/docxImageMove.test.ts`):**
1. `moveImageToGap` moves the image to gap 0 (front), to `childCount` (end), and to a middle gap.
2. `moveImageToGap` returns null for the image's own gap (`g === ci` and `g === ci+1`) and clamps
   out-of-range gaps.
3. `moveImageAt` (refactored) still passes its slice-2 cases (±1 up/down, bound no-ops) — regression.
4. `dropTargetIndex` returns the right gap for a Y above/below/between blocks, with `view.coordsAtPos`
   stubbed (fakeRect pattern already used in this file).

**Real Chrome (`tests/browser/docx-image-drag.browser.test.ts`):**
1. Synthesize a pointer drag of the image from its block down past a table → on pointerup the
   `w:drawing` is relocated after the table in the saved `document.xml`.
2. A sub-threshold pointerdown+up (a click) does NOT move the image (still one drawing, original order).
3. During a drag the `.docx-image-drop-line` appears (eyes-on before/after screenshot to
   `qa-shots/b-drag/`).

## Global constraints (verbatim from program)

- Cardinal DOCX rule: edit `word/document.xml` in place, never rebuild via the docx writer.
- No new dependency; no `SCHEMA_VERSION` bump; rides `VITE_FEATURE_DOCX_EDIT` (no new flag).
- `docModel.ts` must NOT import `opcParts.ts`.
- oxlint: no non-null `!`, no `==`; avoid `as any` (localize casts).
- Per-item commit pre-authorized; **push is manual**. No `Co-Authored-By` trailer.
- i18n: any new user-facing string in en/fr/ar (ar [Unverified]). (Likely none — drag has no label.)

## Ceiling (v1)

Drag into/out of a table cell (top-level only); drop at an arbitrary inline position; touch-drag
auto-scroll on very long documents (the drop still computes correctly, there's just no auto-scroll
while dragging near the viewport edge); multi-image drag-select.

## Adversarial check

Worst failure = a plain click misread as a drag (image jumps on a simple select) → the 5px threshold
plus the "no move below threshold" test prevent it. Second = a drop resolved into a non-top-level
position → `dropTargetIndex` returns only top-level gap indices by construction, and `moveImageToGap`
guards `depth === 0`. Both survive.
