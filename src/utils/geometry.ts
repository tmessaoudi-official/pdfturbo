/**
 * Pure geometry utilities for coordinate-space transforms between
 * PDF content space (bottom-left origin, Y-up) and canvas space
 * (top-left origin, Y-down) across page rotation angles.
 */

/** Canvas space → PDF content space for a given rotation (0/90/180/270). */
export function transformPoint(px: number, py: number, W: number, H: number, totalRot: number): { x: number; y: number } {
  switch (((totalRot % 360) + 360) % 360) {
    case 90:  return { x: py,     y: px     };
    case 180: return { x: W - px, y: py     };
    case 270: return { x: W - py, y: H - px };
    default:  return { x: px,     y: H - py };
  }
}

/** PDF content space → canvas space for a given rotation (inverse of transformPoint). */
export function inverseTransformPoint(pdfX: number, pdfY: number, W: number, H: number, totalRot: number): { x: number; y: number } {
  switch (((totalRot % 360) + 360) % 360) {
    case 90:  return { x: pdfY,     y: pdfX     };
    case 180: return { x: W - pdfX, y: pdfY     };
    case 270: return { x: H - pdfY, y: W - pdfX };
    default:  return { x: pdfX,     y: H - pdfY };
  }
}

/** Re-project a canvas-space point from one page rotation to another. */
export function transformCanvasPoint(cx: number, cy: number, W: number, H: number, fromRot: number, toRot: number): { x: number; y: number } {
  const pdf = transformPoint(cx, cy, W, H, fromRot);
  return inverseTransformPoint(pdf.x, pdf.y, W, H, toRot);
}

/** A rect that may carry the element's own rotation, in degrees about its centre. */
export interface RotatableRect { x: number; y: number; width: number; height: number; rotation?: number }

/**
 * The upright box that is guaranteed to contain everything a (possibly rotated) element covers —
 * the UNION of its stored box and the AABB of that box rotated about its own centre.
 *
 * WS4-B. An element's `rotation` is applied when it is DRAWN (`elementLayerRenderer` sets a CSS
 * `transform: rotate()`, `renderRedaction` passes `rotate: pdfRotVal`) but was never applied when
 * its box was tested against a redaction. The two shapes are not nested — a rotated rectangle
 * sticks out of its own upright box along the long axis — so a rotated redaction burned an opaque
 * box over content that every filter then left fully extractable.
 *
 * UNION, not replacement, and the difference matters: at 90 degrees a 120x20 box becomes 20x120,
 * i.e. NARROWER on x. Substituting the rotated AABB would stop dropping things that are dropped
 * today, and for a leak filter the tested footprint may only ever GROW. Taking the union keeps
 * every existing drop and adds the missing ones, so the change is additive by construction.
 *
 * Also normalises a negative width/height, which `interactionHandler.resize` can produce and which
 * makes raw comparisons FAIL OPEN — the same trap `dropElementsUnderRedactions` and
 * `annotationRectRedacted` already guard against.
 *
 * Exact identity when `rotation` is absent, 0, or a multiple of 360, so the ~all of pages that
 * never rotate an element are byte-for-byte unaffected. Pure; exported for direct testing.
 */
export function rotatedElementFootprint(rect: RotatableRect): { x: number; y: number; width: number; height: number } {
  const x0 = Math.min(rect.x, rect.x + rect.width), x1 = Math.max(rect.x, rect.x + rect.width);
  const y0 = Math.min(rect.y, rect.y + rect.height), y1 = Math.max(rect.y, rect.y + rect.height);
  const upright = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const deg = ((rect.rotation ?? 0) % 360 + 360) % 360;
  if (deg === 0 || !Number.isFinite(deg)) return upright;

  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rad = (deg * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const xs: number[] = [x0, x1], ys: number[] = [y0, y1];
  for (const px of [x0, x1]) {
    for (const py of [y0, y1]) {
      const dx = px - cx, dy = py - cy;
      xs.push(cx + dx * cos - dy * sin);
      ys.push(cy + dx * sin + dy * cos);
    }
  }
  const ux0 = Math.min(...xs), ux1 = Math.max(...xs);
  const uy0 = Math.min(...ys), uy1 = Math.max(...ys);
  return { x: ux0, y: uy0, width: ux1 - ux0, height: uy1 - uy0 };
}

/**
 * Map a redaction rectangle from editor DISPLAYED space (the on-screen rotated
 * orientation the user placed it in — y-down, top-left origin, dims = rotated page)
 * into UNROTATED content space (y-down, top-left origin, W×H = unrotated dims).
 *
 * Flow-export (DOCX/MD/TXT) drops text items whose boxes intersect a redaction rect,
 * but pdf.js reports text items in unrotated content space, so the rect must be
 * un-rotated to match (see flowDoc.isItemRedacted). Reduces to identity at rotation 0.
 * `W`/`H` are the UNROTATED content dimensions; `totalRot` is `(page.rotate + userRotation) % 360`.
 */
export function redactionRectToContent(
  rect: RotatableRect,
  W: number, H: number, totalRot: number,
): { x: number; y: number; width: number; height: number } {
  // WS4-B — take the element's OWN rotation into account first, then the page's. Doing it here
  // rather than at each caller is the point: five of the six sites that turn a redaction element
  // into a filter rect reach this function (`redactionRectToPageSpace` delegates to it), so a
  // partial normalisation across them is unexpressible. Identity when `rotation` is absent, which
  // is every crop rect and every unrotated redaction.
  const r = rotatedElementFootprint(rect);
  const corners: Array<[number, number]> = [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x, r.y + r.height],
    [r.x + r.width, r.y + r.height],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [dx, dy] of corners) {
    const c = transformPoint(dx, dy, W, H, totalRot); // displayed → content (y-up)
    const cy = H - c.y;                               // content y-up → content y-down (top-left)
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Map a redaction rect from editor DISPLAY space into the frame pdf.js reports TEXT ITEMS and
 * IMAGE placements in, given the page's `viewBox` (its CropBox, `[x0, y0, x1, y1]`).
 *
 * ── Why this exists, and why {@link redactionRectToContent} alone is not enough ───────────
 * pdf.js reports `item.transform[4]/[5]` in ABSOLUTE PDF user space, but a redaction element's
 * rect is relative to the RENDERED page box — i.e. the CropBox. The two frames differ by exactly
 * `(x0, y0)`. On the near-universal `/CropBox [0 0 w h]` page they coincide, so comparing them
 * directly appears to work and every fixture agrees; give the page a non-zero origin and the
 * intersection test silently matches nothing and the redacted text is handed back by the flow
 * (DOCX/MD/TXT) and table (CSV/XLSX) exports. This is the same class as the `/Rotate 90|270`
 * leak fixed earlier on these paths — rect and items compared in different frames.
 *
 * The two paths that BAKE pixels already got this right (`pdfElementRenderer`'s
 * `cropOriginX/Y`, and the OCR burn's `unrot.viewBox[0]/[1]`); only the two that EXTRACT text
 * were missing it.
 *
 * Returns a rect whose **x is absolute user-space** and whose **y is measured DOWN from the
 * crop box's top edge**. That is precisely the frame `flowDoc.isItemRedacted` compares in when
 * it is given `viewBox[3]` as its `pageTopY` — pass the two together, from the same viewBox.
 *
 * Identity-preserving: with `viewBox = [0, 0, W, H]` this returns exactly what
 * {@link redactionRectToContent} returns, so ordinary pages are byte-for-byte unaffected.
 */
export function redactionRectToPageSpace(
  rect: RotatableRect,
  viewBox: readonly number[],
  totalRot: number,
): { x: number; y: number; width: number; height: number } {
  const x0 = viewBox[0], y0 = viewBox[1], x1 = viewBox[2], y1 = viewBox[3];
  // Rotation acts on the RENDERED box, so un-rotate within the crop dimensions first, then
  // translate. Composing the other way round would rotate the origin offset too.
  const c = redactionRectToContent(rect, x1 - x0, y1 - y0, totalRot);
  // y needs no term: it is already measured down from the crop TOP, which is what `pageTopY`
  // (= y1) makes `isItemRedacted` measure an item's glyph box against.
  return { x: c.x + x0, y: c.y, width: c.width, height: c.height };
}

/**
 * Inverse of {@link redactionRectToContent}: map a rect from UNROTATED content
 * space (y-down, top-left, W×H = unrotated dims) back into editor DISPLAYED space
 * (the on-screen rotated orientation, y-down, top-left). Used to draw a persisted
 * page crop's dimmed frame at the page's current rotation. Identity at rotation 0.
 * `W`/`H` are the UNROTATED content dimensions; `totalRot` is `(page.rotate + userRotation) % 360`.
 */
export function contentRectToDisplay(
  rect: { x: number; y: number; width: number; height: number },
  W: number, H: number, totalRot: number,
): { x: number; y: number; width: number; height: number } {
  const corners: Array<[number, number]> = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [cx, cyDown] of corners) {
    const cyUp = H - cyDown;                                  // content y-down → y-up
    const d = inverseTransformPoint(cx, cyUp, W, H, totalRot); // content y-up → displayed (y-down)
    if (d.x < minX) minX = d.x;
    if (d.x > maxX) maxX = d.x;
    if (d.y < minY) minY = d.y;
    if (d.y > maxY) maxY = d.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Convert a page crop stored in UNROTATED content space (y-down, top-left,
 * relative to the source content/CropBox) into a pdf-lib `/CropBox` in user space
 * (y-up, bottom-left). The crop is rotation-invariant — the page's `/Rotate`
 * rotates the view around this box — so no rotation term is needed here.
 */
export function contentCropToPdfCropBox(
  crop: { x: number; y: number; width: number; height: number },
  srcCropBox: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: srcCropBox.x + crop.x,
    y: srcCropBox.y + (srcCropBox.height - (crop.y + crop.height)),
    width: crop.width,
    height: crop.height,
  };
}

/**
 * F-C C2 — map a rect drawn in editor DISPLAY space (rotated, y-down, top-left)
 * to a signature appearance rect in PDF USER space (y-up, bottom-left origin),
 * clamped to the page. Composes {@link redactionRectToContent} (display→unrotated
 * content, y-down) + {@link clampContentRect} + a y-flip into user space. NOTE this function's box
 * origin is implicitly (0,0) — i.e. CROP-relative, which is NOT the frame the e-signer validates
 * against: a `/Rect` is ABSOLUTE user space and both signers bounds-check it against
 * `getMediaBox()`. For the absolute user-space rect a signature `/Rect` needs, use
 * {@link displayRectToPageUserSpaceRect} below, which adds the origin.
 * `W`/`H` are the UNROTATED page point dimensions; `totalRot = (page.rotate + userRotation) % 360`.
 */
export function displayRectToUserSpaceRect(
  rect: { x: number; y: number; width: number; height: number },
  W: number, H: number, totalRot: number,
): { x: number; y: number; width: number; height: number } {
  const c = clampContentRect(redactionRectToContent(rect, W, H, totalRot), W, H);
  return { x: c.x, y: H - (c.y + c.height), width: c.width, height: c.height };
}

/**
 * Map a drawn DISPLAY-space rect into ABSOLUTE PDF user space, honouring the CropBox origin.
 *
 * The sibling of {@link redactionRectToPageSpace}, and it exists for the same reason. A
 * signature annotation's `/Rect` is defined in absolute user space, but
 * {@link displayRectToUserSpaceRect} maps into a box whose origin is implicitly (0,0) — i.e.
 * relative to the RENDERED (crop) box. Those two frames coincide only when the CropBox origin
 * is (0,0), which is true of almost every page, which is exactly why the mismatch shipped
 * undetected: on a page with an inset CropBox the visible signature landed displaced by the
 * origin, and with a deep enough inset outside the visible area entirely.
 *
 * `viewBox` is pdf.js's `[x0, y0, x1, y1]` for the page (rotation-invariant); `totalRot` is
 * `(page.rotate + userRotation) % 360`.
 */
export function displayRectToPageUserSpaceRect(
  rect: { x: number; y: number; width: number; height: number },
  viewBox: readonly number[],
  totalRot: number,
): { x: number; y: number; width: number; height: number } {
  const x0 = viewBox[0], y0 = viewBox[1], x1 = viewBox[2], y1 = viewBox[3];
  // Un-rotate and flip within the CROP dimensions first, then translate — composing the other
  // way round would rotate the origin offset too. Same ordering as redactionRectToPageSpace.
  const c = displayRectToUserSpaceRect(rect, x1 - x0, y1 - y0, totalRot);
  return { x: c.x + x0, y: c.y + y0, width: c.width, height: c.height };
}

/**
 * Inset a W×H box by per-edge MARGINS in points (#G23 v1b — the numeric companion to drag-to-crop).
 *
 * DELIBERATELY SPACE-AGNOSTIC. It is called with the page's *display* dimensions, because the user types
 * what they SEE — "100pt off the top" means the visual top — and the caller then maps the resulting rect
 * into unrotated content space with the very same `redactionRectToContent` the drag path uses. An earlier
 * version took content dims directly and so cropped the WRONG VISUAL EDGE on any page with `/Rotate ≠ 0`
 * (measured: at 90° a typed top margin removed the right-hand strip). Rotation belongs to the caller,
 * once, shared with the drag path — not re-derived here.
 *
 * Returns null when the margins leave under 1pt, so a caller never special-cases a degenerate crop —
 * mirroring the drag path's own guard. A NEGATIVE margin is clamped to 0 (it would mean OUTSETTING the
 * page, which a crop box cannot express); NaN is treated as 0 (an empty number input parses to NaN);
 * but a non-finite POSITIVE margin is left as-is so it refuses, rather than silently meaning "no margin"
 * — `1e999` parses to Infinity and must behave like the `1e9` next to it.
 */
export function marginsToRect(
  margins: { top: number; right: number; bottom: number; left: number },
  W: number,
  H: number,
): { x: number; y: number; width: number; height: number } | null {
  const nn = (v: number) => (Number.isNaN(v) ? 0 : Math.max(0, v));
  const left = nn(margins.left);
  const top = nn(margins.top);
  const rect = {
    x: left,
    y: top,
    width: W - left - nn(margins.right),
    height: H - top - nn(margins.bottom),
  };
  if (rect.width < 1 || rect.height < 1) return null;
  return clampContentRect(rect, W, H);
}

/** Clamp a content-space rect into the `[0,0,W,H]` content box (keeps width/height ≥ 0). */
export function clampContentRect(
  rect: { x: number; y: number; width: number; height: number },
  W: number, H: number,
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.min(rect.x, W));
  const y = Math.max(0, Math.min(rect.y, H));
  const width = Math.max(0, Math.min(rect.width, W - x));
  const height = Math.max(0, Math.min(rect.height, H - y));
  return { x, y, width, height };
}

/**
 * Map a crop drawn on one page's content box onto another page's box, preserving the crop's SHAPE
 * and its RELATIVE POSITION (#G23 v1d — aspect-ratio-aware apply-to-all).
 *
 * The previous apply-to-all reused one ABSOLUTE rect and clamped it to each page. On a uniform
 * document that is right; on a mixed-size one it is not — the same 200×100 rect at (50,50) frames a
 * different part of a smaller page, and on a page narrower than the rect it is silently truncated to
 * a different shape. "Take the top third of every page" is what the user means, and the top third is
 * a proportion, not a measurement.
 *
 * Two properties, and they can conflict, so the resolution is explicit:
 *  - **shape** is preserved by scaling with a UNIFORM factor, `min(toW/fromW, toH/fromH)`. Scaling
 *    each axis independently would preserve the fractions but stretch the crop when the two pages
 *    have different aspect ratios — a portrait selection becoming a squat one on a landscape page.
 *  - **position** is preserved by keeping the crop's CENTRE at the same fractional position, then
 *    clamping so the box stays inside the page. Anchoring the top-left instead drifts the framing
 *    towards the bottom-right as pages shrink.
 *
 * IDENTITY when the boxes match: `scale` is exactly 1 and the centre maths returns the input, so a
 * uniform document — the overwhelmingly common case — is byte-identical to the old behaviour. That
 * is asserted rather than reasoned about.
 */
export function scaleCropToPageBox(
  crop: { x: number; y: number; width: number; height: number },
  from: { W: number; H: number },
  to: { W: number; H: number },
): { x: number; y: number; width: number; height: number } {
  if (from.W <= 0 || from.H <= 0) return clampContentRect(crop, to.W, to.H);
  // EXACT identity for equal boxes, short-circuited rather than left to the arithmetic. The centre
  // round-trip `((y + h/2) / H) * H - h/2` is not exact in floating point — it returned
  // 59.999999999999986 for 60 — so without this a uniform document's stored crop would drift in the
  // last bits on every apply-to-all, and the byte-identical claim would simply be false.
  if (from.W === to.W && from.H === to.H) return { ...crop };
  const scale = Math.min(to.W / from.W, to.H / from.H);
  const width = Math.min(crop.width * scale, to.W);
  const height = Math.min(crop.height * scale, to.H);
  // Centre-relative, not corner-relative.
  const cx = ((crop.x + crop.width / 2) / from.W) * to.W;
  const cy = ((crop.y + crop.height / 2) / from.H) * to.H;
  const x = Math.max(0, Math.min(cx - width / 2, to.W - width));
  const y = Math.max(0, Math.min(cy - height / 2, to.H - height));
  return { x, y, width, height };
}

/**
 * Parse a CSS hex color string (#RRGGBB or RRGGBB) into normalized [0, 1] RGB components
 * suitable for pdf-lib color APIs.
 */
export function hexToRgbValues(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}
