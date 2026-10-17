/**
 * The coordinate frames a page rect can be in (architecture step 3). Five frames, one `Rect` shape: the brand is a
 * SOFT phantom — an optional `__frame` that never exists at run time — so a plain `{ x, y, width, height }` literal
 * still fits every frame, while a converter's output handed to a parameter of another frame does not compile
 * (Decisions Log 2026-10-17). Types only: nothing here changes a byte of output.
 *
 * A brand survives only as far as a typed value flows; a rect stored in a plain-typed model field (a page crop, an
 * element) is unbranded again, so the check covers converter-to-converter chains, not the model.
 */

/** An axis-aligned rect: an origin corner plus a size. Which corner, and which way y runs, is the frame's. */
export interface Rect { x: number; y: number; width: number; height: number }

/** The phantom brand. Optional, so assigning a plain rect needs no cast; differing, so two frames never mix. */
export type InFrame<F extends string> = Rect & { readonly __frame?: F };

/**
 * Editor DISPLAY space: what the user sees — the page as rotated on screen, y down, origin at the top-left of the
 * rendered (crop) box. Every element's stored rect is in this frame.
 */
export type DisplayRect = InFrame<'display'>;

/**
 * UNROTATED content space: y down, origin at the top-left of the crop box, W×H = the unrotated crop dimensions. A
 * page crop is stored in this frame.
 */
export type ContentRect = InFrame<'content'>;

/** Crop-relative PDF user space: y UP, origin at the crop box's bottom-left corner. */
export type CropRect = InFrame<'crop'>;

/** Absolute PDF user space: y UP, the page's own coordinates — what a `/Rect` or a `/CropBox` is written in. */
export type AbsRect = InFrame<'abs'>;

/**
 * The frame pdf.js reports text items and image placements in, as `flowDoc.isItemRedacted` compares them: x in
 * ABSOLUTE user space, y measured DOWN from the crop box's top edge (pass `viewBox[3]` as its `pageTopY`). A hybrid,
 * and the one the crop-origin leak lived in (`redactionRectToPageSpace`).
 */
export type PageSpaceRect = InFrame<'pageSpace'>;
