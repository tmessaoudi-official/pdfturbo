/**
 * Pure walk of a pdf.js operator list (M2 #22 — extracted from exportService's
 * _extractFlowDoc). Tracks the CTM (q/Q/cm), the text matrix (Tm, Td/TD/T*, leading),
 * and the current fill color, then emits three flow-export inputs:
 *   - colorMap: non-black text fill colors keyed by page-space text origin
 *   - rules:    thin horizontal filled/stroked rects (underline/strike candidates)
 *   - images:   image-XObject paint placements (name + draw CTM)
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

export function walkPageOps(opList: OpListLike, OPS: Record<string, number>): PageOpsResult {
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
  // CTM stack for image position/size extraction (q/Q/cm operators).
  const ctmStack: Matrix6[] = [];
  let ctm: Matrix6 = [1, 0, 0, 1, 0, 0];

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
      ctm = [
        ctm[0] * a + ctm[2] * b, ctm[1] * a + ctm[3] * b,
        ctm[0] * c + ctm[2] * d, ctm[1] * c + ctm[3] * d,
        ctm[0] * e + ctm[2] * f + ctm[4], ctm[1] * e + ctm[3] * f + ctm[5],
      ];
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
      const m = args[0] as unknown as ArrayLike<number> | null | undefined;
      // Mirror canvas.js's own guard: a form may carry no /Matrix, or a malformed one.
      if (m && m.length === 6) {
        const [a, b, c, d, e, f] = Array.from(m, Number);
        if ([a, b, c, d, e, f].every(Number.isFinite)) {
          ctm = [
            ctm[0] * a + ctm[2] * b, ctm[1] * a + ctm[3] * b,
            ctm[0] * c + ctm[2] * d, ctm[1] * c + ctm[3] * d,
            ctm[0] * e + ctm[2] * f + ctm[4], ctm[1] * e + ctm[3] * f + ctm[5],
          ];
        }
      }
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
          rules.push({ x: minX, y: minY, width: rw, height: rh });
        } else if (rh > 2 && rw < 8 && rh > rw * 3) {
          vRules.push({ x: minX, y: minY, width: rw, height: rh });
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
        colorMap.set(`${px},${py}`, fillHex);
      }
    }
  }

  return { colorMap, rules, vRules, images };
}
