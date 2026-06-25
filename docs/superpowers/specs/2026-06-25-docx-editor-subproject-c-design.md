# Sub-project C — DOCX editor: image & hyperlink preservation, display, and editing

> Part of the max-fidelity program (`docs/plans/maxfidelity-program-2026-06-25.plan.md`).
> Sibling specs: Sub-project A (true-edit), Sub-project B (PDF→DOCX).

## Problem (verified, not assumed)

The DOCX editor's `save()` round-trip is currently **data-lossy** for two common content
kinds. Verified 2026-06-25 with `vite-node` + `jsdom` probes against the real `src/docx/docModel.ts`:

- **Images are destroyed.** `parseParagraph` skips runs with no `w:t` (`if (!text) continue`),
  so an image-only paragraph parses to `{ runs: [] }`. On save, `setRunsOn` removes **every**
  direct-child `w:r` (including the one holding `w:drawing`) and appends a single empty text run.
  Probe result: `DRAWING_SURVIVES: false`, `BLIP_SURVIVES: false`.
- **Hyperlink text is duplicated.** `parseParagraph` reads runs via a **deep**
  `getElementsByTagName('w:r')`, so it counts runs nested inside `w:hyperlink`. On save,
  `setRunsOn` removes only **direct**-child runs (the `w:hyperlink` and its nested run survive),
  then appends the model's text as new direct-child runs → the link text appears **twice**.
  Probe result: a single "click here" link → `CLICK_HERE_OCCURRENCES: 2`.

The earlier project-memory note "images preserved through save" was **wrong** — it conflated the
read-only DOCX→PDF export channel (`extractDocImages`/`getImages()`, decoupled by design) with the
editor save round-trip. The export path is unaffected by this spec.

This is effectively a **P0 correctness defect** hiding under a feature label: anyone who opens a
DOCX containing a logo or a hyperlink and saves silently loses or corrupts content.

## Goal

Make the DOCX editor **non-destructive** for images and hyperlinks, **display** images inline, and
(Phase 2) enable **editing** them — without weakening the cardinal in-place-save rule (edit
`word/document.xml` in place, never rebuild via a docx writer).

## Approach: fix-first, then enrich (two phases)

Decided 2026-06-25 (`Decisions Log`): a standalone **preservation** phase with its own gate, then
enrichment on the now-safe base. Each phase boundary is a shippable, gated state.

---

## Phase 1 — Preserve + Display (correctness + read-only display)

### Model: a third opaque `DocBlock` variant

`docModel.ts` already discriminates anchor blocks: `DocBlock = DocParagraph | DocTable`, and the
reconciler segments paragraphs *around* non-paragraph blocks (tables are immutable anchors). Add a
third **opaque** variant:

```ts
export interface DocImageBlock {
  kind: 'image';              // discriminator (mirrors DocTable.kind)
  /** What this anchor holds, for display + future editing. Both optional. */
  image?: { dataB64: string; mime: 'image/png' | 'image/jpeg'; widthPt: number; heightPt: number };
  linkText?: string;          // hyperlink-anchor display text (read-only in Phase 1)
}
export type DocBlock = DocParagraph | DocTable | DocImageBlock;
```

`isDocImageBlock(b)` narrows it (mirror `isDocTable`). The block carries **only display data** — the
source XML is never stored in the model; preservation is guaranteed structurally at the DOM layer
(below), so the model and the DOM cannot drift into data loss.

### Detection (DOM-structural, the robustness invariant)

A top-level `w:p` is an **anchor** iff it (deeply) contains a `w:drawing` **or** a `w:hyperlink`.
Detection happens at **reconcile time on the DOM**, independent of the model/PM bookkeeping:

- `parseContainerBlocks` emits a `DocImageBlock` (not a `DocParagraph`) for an anchor `w:p`, filling
  `image` (via the same blip→rels→media resolution `extractDocImages` uses) and/or `linkText` (the
  concatenated text of its `w:hyperlink` descendants) for display.
- The reconciler (`reconcileContainer` / `reconcileSegment` / `reconcileParagraphsOnly`) **hard-skips
  any anchor `w:p`** — it is never passed to `setRunsOn`, in the main path **and** in the
  table-count-mismatch fallback. Today `reconcileParagraphsOnly` filters `c.tagName === 'w:p'` and
  would feed an anchor to `setRunsOn`; it must exclude anchors (`isAnchorParagraphEl(el)`) too.

This makes preservation a property of the DOM walk, not of model matching: even if the PM doc diverges
from the DOM (e.g. the user "deletes" the read-only atom), the anchor `w:p` is left **byte-exact**.

### Reconciler integration

Anchors join tables as immutable segment delimiters. `reconcileContainer` already partitions a
container's children by tables; generalize the partition to delimit on **anchors too** (table *and*
image/hyperlink `w:p`), zip them 1:1 positionally with the model's opaque blocks, and skip them
(tables still recurse into cells; image/hyperlink anchors do nothing). The "counts mismatch → bail to
paragraph-only" guard stays, and the paragraph-only fallback also skips anchors — so no path can reach
`setRunsOn` with an anchor.

### ProseMirror bridge: read-only atom

Add to `docxSchema`:

```ts
docx_image: {  // atom leaf; renders the real picture, not editable in Phase 1
  group: 'block', atom: true, selectable: true, draggable: false,
  attrs: { dataB64: {default:''}, mime: {default:'image/png'}, widthPt:{default:0}, heightPt:{default:0} },
  toDOM: n => ['img', { src: `data:${n.attrs.mime};base64,${n.attrs.dataB64}`,
                        style: `width:${n.attrs.widthPt}pt;height:${n.attrs.heightPt}pt`, 'data-docx-image':'1' }],
}
docx_link: {   // atom leaf for a hyperlink-anchor paragraph; shows link text read-only
  group: 'block', atom: true, selectable: true,
  attrs: { text: {default:''} },
  toDOM: n => ['p', ['a', { class:'docx-link-ro' }, n.attrs.text as string]],
}
```

- `docModelToDoc` maps a `DocImageBlock` with `image` → `docx_image`, with `linkText` → `docx_link`.
- `docToDocModel` maps the atom back to the same `DocImageBlock` (display data preserved; never emits
  runs for it).
- Atoms are **non-deletable in practice**: a deleted atom simply isn't in the PM doc, the model loses
  the block, but the DOM-structural skip preserves the source `w:p` anyway → the image/link **persists
  on save** (safe; true delete is a Phase-2 C2 feature, documented).

### Phase 1 acceptance

- A DOCX with an inline or floating image: open → image renders inline; save → `w:drawing` + blip +
  media byte-exact; round-trip stable.
- A DOCX with a hyperlink: open → link text shown once (read-only); save → exactly one occurrence,
  `w:hyperlink` + `r:id` preserved.
- **Byte-identical control:** a DOCX with no drawing and no hyperlink → save output unchanged from
  today (no regression to the existing text/table/list paths).
- Editing surrounding text/tables/lists still works and still saves in place.

### Phase 1 ceilings (documented)

- A paragraph mixing flowing text **and** an inline image/link is read-only in Phase 1 (the whole
  anchor paragraph is opaque). Per-run inline-image/link editing is out of scope (Phase 2+ / ceiling).
- Anchors cannot be deleted or reordered in Phase 1 (Phase-2 C2/C3 features).

---

## Phase 2 — Edit (C2 images, C3 links) — outline, planned after Phase 1 ships

Phase 2 lifts the opaque-passthrough restriction *selectively*, per edited block, and will get its own
refinement pass when reached. Sketch:

- **C2 image edit** — select the `docx_image` atom; move / resize / delete. Editing means the block is
  no longer pure passthrough: on save, a **changed** image anchor rewrites just that `w:p`'s
  `wp:extent` / position (resize/move) or removes the `w:p` (delete), in place, leaving the rest of the
  document verbatim. Unchanged image anchors stay on the byte-exact passthrough path (so non-edited
  docs remain byte-identical). New-image *insert* is a stretch goal (needs a new media part + rels +
  `[Content_Types]` Default — mirrors `opcParts.ts` register-if-missing).
- **C3 editable links** — the proper `w:hyperlink` ↔ a PM `link` mark (already in
  prosemirror-schema-basic) round-trip: parse `w:hyperlink` → runs carrying the resolved URL
  (`document.xml.rels` `r:id` → Target), re-emit on save as `w:hyperlink` with rels management
  (add/reuse a relationship). This lifts the Phase-1 read-only restriction on link-bearing paragraphs
  and makes link text editable inline. Touches `opcParts.ts`-style rels plumbing → its own gate.

Phase 2 ceilings (anticipated): floating-image precise reposition fidelity, image crop/rotation edits,
internal (GoTo) links, and link styling beyond the default mark.

---

## Constraints (inherited from the program)

- **Cardinal in-place rule:** edit `word/document.xml` in place; never rebuild via the `docx` writer.
- **Byte-identical when inactive:** any doc with no image/hyperlink saves exactly as today.
- **TDD + full deploy gate** per item (`npm audit` → `ocr:assets` → type-check → lint → test (jsdom) →
  test:browser (real Chrome) → test:coverage:export → build); the browser suite is deploy-blocking.
- **No new deps** expected (jsdom DOMParser, fflate, prosemirror-* already present).
- Gated by the existing `VITE_FEATURE_DOCX_EDIT` seam (no new flag).
- i18n: any new user-facing strings in en/fr/ar (ar [Unverified], native review pending).

## Files (Phase 1)

- `src/docx/docModel.ts` — `DocImageBlock` + `isDocImageBlock`; anchor detection in
  `parseContainerBlocks`; anchor hard-skip in `reconcileContainer`/`reconcileSegment`/
  `reconcileParagraphsOnly`; reuse blip→rels→media resolution (extract a shared helper with
  `docxImages.ts` or import it).
- `src/docx/docxSchema.ts` — `docx_image` + `docx_link` atom nodes.
- `src/docx/docxProseMirror.ts` — map `DocImageBlock` ↔ atoms in `blocksToNodes`/`emitBlockTo`.
- `src/docx/docxImages.ts` — possibly export the blip/rels/media resolution for reuse (avoid
  duplication; same logic).
- Tests: `tests/docx/docModelImagePreserve.test.ts` (parse anchor → block; save byte-exact;
  byte-identical control; hyperlink single-occurrence), `tests/docx/docxImageBridge.test.ts` (PM
  round-trip), `tests/browser/docx-image-preserve.browser.test.ts` (real Chrome: open image+link DOCX,
  render, save, reopen — image + link survive; no duplication).
