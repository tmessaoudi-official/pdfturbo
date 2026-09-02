/**
 * Pure walk of a pdf.js operator list (M2 #22 — extracted from exportService's
 * _extractFlowDoc). Tracks the CTM (q/Q/cm), the text matrix (Tm, Td/TD/T*, leading),
 * and the current fill color, then emits FOUR flow-export inputs:
 *   - colorMap: non-black text fill colors keyed by page-space text origin
 *   - rules:    thin horizontal filled/stroked rects (underline/strike candidates)
 *   - vRules:   thin vertical rects (table-grid candidates, #56)
 *   - images:   image-XObject paint placements (name + draw CTM)
 *
 * The count matters: `ctm` feeds all four, so a placement fix for one is a behaviour change for
 * every one of them — which is exactly how the `beginAnnotation` fix introduced a regression in
 * the other three before they were gated (see `annotationDepth`).
 *
 * No DOM, no canvas: image bitmap rasterization (which needs page.objs + a canvas)
 * stays in the caller. This makes the matrix/color/rule logic unit-testable.
 */
import { fillOpToHex, type RuleRect } from '../utils/flowDoc';

export type Matrix6 = [number, number, number, number, number, number];

export interface ImagePlacement {
  /** XObject name — `g_`-prefixed → document `commonObjs`, else page `objs`. */
  name: string;
  /** Draw CTM in effect at the paint op. */
  ctm: Matrix6;
}

export interface PageOpsResult {
  /** Non-black text fill colors (uppercase 6-hex, no '#') keyed by `"px,py"`. */
  colorMap: Map<string, string>;
  /** Thin horizontal rules in PDF user space (y-up) — underline/strike candidates. */
  rules: RuleRect[];
  /** Thin vertical rules in PDF user space (y-up) — table-grid candidates (#56). */
  vRules: RuleRect[];
  /** Image-XObject paint placements in document order. */
  images: ImagePlacement[];
}

/** Minimal shape of a pdf.js operator list (only what the walk reads). */
export interface OpListLike {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

export function walkPageOps(
  opList: OpListLike,
  OPS: Record<string, number>,
  /**
   * The page's CropBox origin `{ x: viewBox[0], y: viewBox[1] }`, when the caller wants positions
   * reported in the CROP frame rather than absolute user space (C22). Omitted → absolute, which is
   * what pdf.js itself reports and what the CSV/XLSX caller wants.
   */
  origin?: { x: number; y: number },
): PageOpsResult {
  const colorMap = new Map<string, string>();
  const rules: RuleRect[] = [];
  const vRules: RuleRect[] = [];
  const images: ImagePlacement[] = [];

  // Current text fill color as an uppercase 6-hex string (no '#'). pdf.js v6
  // pre-resolves RGB/Gray/CMYK/Separation/spot color spaces and delivers
  // `setFillRGBColor` with a single "#rrggbb" string arg — `fillOpToHex`
  // normalizes that (and the legacy float shapes).
  let fillHex = '000000';
  // Text matrix (Tm), text-line matrix (Tlm) and leading (TL) — tracked so the
  // fill-color attaches at the SAME position getTextContent reports for each show
  // op. pdf.js v6 packs the Tm as a single Float32Array arg (not 6 scalars), and
  // text is positioned via Td/TD/T* far more often than via Tm — both must be
  // handled or the color key never matches the text item and colored runs go black.
  let textMatrix = [1, 0, 0, 1, 0, 0];
  let textLineMatrix = [1, 0, 0, 1, 0, 0];
  let textLeading = 0;
  const unpackMatrix = (a: unknown[]): number[] => {
    const a0 = a[0];
    const m = (Array.isArray(a0) || ArrayBuffer.isView(a0))
      ? (a0 as ArrayLike<number>)
      : (a as ArrayLike<number>);
    return [Number(m[0]), Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  };
  // Tlm := [1 0 0 1 tx ty] × Tlm ; Tm := Tlm  (PDF Td/TD/T* semantics).
  const translateTextLine = (tx: number, ty: number) => {
    const [a, b, c, d, e, f] = textLineMatrix;
    textLineMatrix = [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
    textMatrix = [...textLineMatrix];
  };
  // CTM stack for image position/size extraction (q/Q/cm operators, and the implicit
  // save/transform pairs pdf.js emits for form XObjects and annotation appearance streams).
  const ctmStack: Matrix6[] = [];
  /**
   * The BASE transform — pdf.js's own term for the frame a page's ops are placed into.
   *
   * C22: every position this walker reports — `rules`, `vRules`, image CTMs and the `colorMap`
   * keys — derives from `ctm`, so seeding it with the negated CropBox origin normalises all four
   * channels in LOCKSTEP by construction. That matters more than it looks: colour, underline and
   * hyperlink are matched by POSITION against the text items, so a normalisation that reached the
   * words but only some of these channels would fix the layout and silently break all three. Here
   * a partial one is unexpressible rather than merely discouraged.
   *
   * `composeCtm(m, …)` applies `m` LAST, so this translation stays outermost and is never scaled
   * or rotated by a later `cm` — read, not assumed (`result[4] = m[0]*e + m[2]*f + m[4]`).
   * Identity by default → byte-identical output for an omitted origin.
   */
  const base: Matrix6 = [1, 0, 0, 1, -(origin?.x ?? 0), -(origin?.y ?? 0)];
  let ctm: Matrix6 = [...base];

  /**
   * How deep we are inside an annotation's appearance stream.
   *
   * The IMAGE channel is collected inside annotations on purpose — `imagePlacementRedacted`
   * needs a stamped image's true placement or a redaction over it cannot drop it. The other
   * three channels are NOT: they describe the PAGE's own text, and an annotation's vector ink
   * and fill colours would be read as page content. Before the placement was composed that ink
   * landed at (0,0), where `classifyRuleAsUnderline`'s overlap test never matched real text, so
   * it was inert noise; placed correctly it lands ON a text baseline, and a Square annotation's
   * border becomes an underline the source does not have while a page of widget borders becomes
   * a phantom table grid. `reconstructPage` REMOVES in-region words from the paragraph flow, so
   * that is the same harm CLAUDE.md grades as the reason C9 stays unwired.
   */
  let annotationDepth = 0;

  /** `m × [a b c d e f]`, the PDF `cm` composition. Shared so the sites cannot drift. */
  const composeCtm = (
    m: Matrix6, a: number, b: number, c: number, d: number, e: number, f: number,
  ): Matrix6 => [
    m[0] * a + m[2] * b, m[1] * a + m[3] * b,
    m[0] * c + m[2] * d, m[1] * c + m[3] * d,
    m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5],
  ];
  /**
   * A 6-element finite matrix argument, or null.
   *
   * STRICTER than pdf.js, which only tests the argument for truthiness
   * (`if (matrix) { this.transform(...matrix) }`) and has no length or finiteness check. Stated
   * precisely because an earlier comment claimed to "mirror canvas.js's own guard", and this
   * round's own headline lesson is not to assert what a library does without reading it.
   */
  const asMatrix6 = (v: unknown): Matrix6 | null => {
    const len = (v as ArrayLike<number> | null)?.length;
    if (len !== 6) return null;
    const a = Array.from(v as ArrayLike<number>, Number);
    return a.every(Number.isFinite) ? (a as Matrix6) : null;
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as number[];
    if (fn === OPS['save']) {
      ctmStack.push([...ctm] as Matrix6);
    } else if (fn === OPS['restore']) {
      const prev = ctmStack.pop();
      if (prev) ctm = prev;
    } else if (fn === OPS['transform']) {
      const [a, b, c, d, e, f] = args;
      ctm = composeCtm(ctm, a, b, c, d, e, f);
    } else if (fn === OPS['beginAnnotation']) {
      // An annotation's appearance stream is placed by ops the page content stream never shows.
      // pdf.js's canvas backend (pdf.mjs:12638-12696) resets to the base transform, saves, then
      // applies `transform` and `matrix` — args[2] and args[3]. Without this an image painted by
      // a Stamp/FreeText appearance reported its ctm at the PAGE ORIGIN, so
      // `imagePlacementRedacted` both MISSED a redaction over a stamped image and falsely
      // dropped one whenever a redaction happened to sit at (0,0) — it erred in both directions.
      // The strip added for the raster paths does not cover this: `_extractFlowDoc` walks the
      // ORIGINAL source page, not the stripped export copy.
      annotationDepth++;
      ctmStack.push([...ctm] as Matrix6);
      // Reset first: the backend sets the base transform rather than composing onto whatever the
      // content stream left behind. `base`, NOT identity — an annotation's appearance stream is
      // placed in the same page frame as everything else, so a literal identity here would leave
      // annotation-borne images and rules in ABSOLUTE space while the rest of the page had moved
      // to the crop frame. That mixed frame is the exact partial-normalisation failure C22 exists
      // to avoid, and it would err in the leak direction: `imagePlacementRedacted` would test a
      // stamped image against redactions expressed in a different frame.
      ctm = [...base];
      for (const idx of [2, 3]) {
        const m = asMatrix6(args[idx]);
        if (m) ctm = composeCtm(ctm, m[0], m[1], m[2], m[3], m[4], m[5]);
      }
    } else if (fn === OPS['endAnnotation']) {
      if (annotationDepth > 0) annotationDepth--;
      // Defensive, and NOT pinned by a test — said plainly rather than implied. Because
      // `beginAnnotation` RESETS the ctm rather than composing onto it, a missing pop here is
      // unobservable in pdf.js's current output: annotations come last in the operator list and
      // each one re-establishes its own frame. Sabotaging this line away leaves the suite green.
      // It stays because it keeps the stack balanced, so any future op emitted after an
      // annotation block reads the page frame and not the annotation's. Note this is a
      // deliberate DIVERGENCE from pdf.js, not a match to it: `endAnnotation` pops only
      // `baseTransformStack`, and the transform unwind happens at the NEXT `beginAnnotation`
      // via `#restoreInitialState()`. An earlier version of this comment claimed it mirrored
      // the backend's own `restore`, which the backend does not do here.
      const prev = ctmStack.pop();
      if (prev) ctm = prev;
    } else if (fn === OPS['paintFormXObjectBegin']) {
      // A form XObject is an implicit q/cm: pdf.js's canvas backend saves the state and
      // applies the form's /Matrix here (CanvasGraphics.paintFormXObjectBegin), restoring at
      // the matching End. The form /Matrix arrives as THIS op's first argument — it is NOT
      // re-emitted as a `transform`, verified by dumping a real operator list:
      //   paintFormXObjectBegin[[1,0,0,1,150,500],[0,0,200,200]]
      //   transform[...]   ← only the form's INTERNAL cm comes through this way
      // Without both halves an image inside a form reported the form-LOCAL ctm (so
      // `imagePlacementRedacted` missed a redacted picture and it exported intact), and the
      // form's inner cm leaked out to every later page-level op — compounding
      // MULTIPLICATIVELY, measured as [10000,0,0,2500,2000,1000] for a [100,0,0,50,20,20]
      // placement. Rules and text origins inside forms move to page space too, which is the
      // desired direction: nothing pinned the old form-local values.
      ctmStack.push([...ctm] as Matrix6);
      // A form may carry no /Matrix, or a malformed one. pdf.js guards this with a bare
      // truthiness test; `asMatrix6` is deliberately stricter (see its doc comment).
      const m = asMatrix6(args[0]);
      if (m) ctm = composeCtm(ctm, m[0], m[1], m[2], m[3], m[4], m[5]);
    } else if (fn === OPS['paintFormXObjectEnd']) {
      const prev = ctmStack.pop();
      if (prev) ctm = prev;
    } else if (fn === OPS['paintImageXObject']) {
      images.push({ name: args[0] as unknown as string, ctm: [...ctm] as Matrix6 });
    } else if (fn === OPS['constructPath']) {
      // (b) underline/strike: a thin horizontal filled/stroked rule. v6 packs
      // paths into constructPath: args = [paintOp, pathData, minMax]. The minMax
      // bbox is path-local; transform it by the CTM into PDF user space (y-up) —
      // the SAME space reconstructPage's words use.
      const a = args as unknown[];
      const paintOp = Number(a[0]);
      const isFill = paintOp === OPS['fill'] || paintOp === OPS['eoFill'] ||
        paintOp === OPS['fillStroke'] || paintOp === OPS['eoFillStroke'];
      const isStroke = paintOp === OPS['stroke'] || paintOp === OPS['closeStroke'];
      const mm = a[2] as Record<number, number> | undefined;
      if (mm && (isFill || isStroke)) {
        const corners: Array<[number, number]> = [
          [mm[0], mm[1]], [mm[2], mm[1]], [mm[2], mm[3]], [mm[0], mm[3]],
        ];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [lx, ly] of corners) {
          const dx = ctm[0] * lx + ctm[2] * ly + ctm[4];
          const dy = ctm[1] * lx + ctm[3] * ly + ctm[5];
          if (dx < minX) minX = dx; if (dx > maxX) maxX = dx;
          if (dy < minY) minY = dy; if (dy > maxY) maxY = dy;
        }
        const rw = maxX - minX, rh = maxY - minY;
        // Keep only thin, line-like rules — excludes shading blocks / vector art.
        // Horizontal → underline/strike candidates; vertical → table-grid (#56).
        if (rw > 2 && rh < 8 && rw > rh * 3) {
          if (annotationDepth === 0) rules.push({ x: minX, y: minY, width: rw, height: rh });
        } else if (rh > 2 && rw < 8 && rh > rw * 3) {
          if (annotationDepth === 0) vRules.push({ x: minX, y: minY, width: rw, height: rh });
        }
      }
    } else if (fn === OPS['setFillRGBColor']) {
      fillHex = fillOpToHex('rgb', args as unknown[]) ?? fillHex;
    } else if (fn === OPS['setFillGray']) {
      // Defensive: v6 rewrites gray→setFillRGBColor, kept for resilience.
      fillHex = fillOpToHex('gray', args as unknown[]) ?? fillHex;
    } else if (fn === OPS['setFillCMYKColor']) {
      // Defensive: v6 rewrites cmyk→setFillRGBColor, kept for resilience.
      fillHex = fillOpToHex('cmyk', args as unknown[]) ?? fillHex;
    } else if (fn === OPS['beginText']) {
      textMatrix = [1, 0, 0, 1, 0, 0];
      textLineMatrix = [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS['setTextMatrix']) {
      textMatrix = unpackMatrix(args as unknown[]);
      textLineMatrix = [...textMatrix];
    } else if (fn === OPS['setLeading']) {
      textLeading = Number(args[0]);
    } else if (fn === OPS['moveText']) {
      translateTextLine(Number(args[0]), Number(args[1]));
    } else if (fn === OPS['setLeadingMoveText']) {
      textLeading = -Number(args[1]);
      translateTextLine(Number(args[0]), Number(args[1]));
    } else if (fn === OPS['nextLine']) {
      translateTextLine(0, -textLeading);
    } else if (
      fn === OPS['showText'] ||
      fn === OPS['showSpacedText'] ||
      fn === OPS['nextLineShowText'] ||
      fn === OPS['nextLineSetSpacingShowText']
    ) {
      // ' and " advance to the next line before showing (implicit T*).
      if (fn === OPS['nextLineShowText'] || fn === OPS['nextLineSetSpacingShowText']) {
        translateTextLine(0, -textLeading);
      }
      // Text origin in page user space = Tm translation × CTM, matching the
      // position getTextContent reports for this item.
      const ox = textMatrix[4], oy = textMatrix[5];
      const px = Math.round(ctm[0] * ox + ctm[2] * oy + ctm[4]);
      const py = Math.round(ctm[1] * ox + ctm[3] * oy + ctm[5]);
      // Only record non-black so reconstructPage defaults to black text.
      if (fillHex !== '000000') {
        if (annotationDepth === 0) colorMap.set(`${px},${py}`, fillHex);
      }
    }
  }

  return { colorMap, rules, vRules, images };
}
