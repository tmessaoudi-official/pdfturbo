export interface CsToken {
  type:
    | 'number'
    | 'string'
    | 'hexstring'
    | 'name'
    | 'array'
    | 'dict'
    | 'comment'
    | 'inline-image'
    | 'operator';
  /** Exact serializable source text of the token. */
  raw: string;
  /** Numeric value (number tokens only). */
  value?: number;
  /** Parsed children (array tokens only). */
  items?: CsToken[];
}

export interface CsOp {
  operator: string;
  operands: CsToken[];
}

export interface TextOpInfo {
  /** Index into the ops array returned by groupOps. */
  opIndex: number;
  operator: string;
  /** Text origin in page user space (PDF coords, baseline), CTM-transformed. */
  origin: { x: number; y: number };
  fontKey: string;
  fontSize: number;
  /**
   * Raw PDF fill color ops string captured from the content stream, e.g.:
   *   '1 0 0 rg'  (DeviceRGB)
   *   '0.5 g'     (DeviceGray)
   *   '0 0 1 0 k' (DeviceCMYK)
   * Undefined when no fill color operator appeared before this show op.
   */
  fillColor?: string;
  /** Index of the Tf op (in the ops array) that set the current font+size. */
  tfOpIndex?: number;
  /** Index of the last fill-color op (rg/g/k/sc/scn) before this show op. */
  colorOpIndex?: number;
  /** Set when this op was found inside a Form XObject (not directly editable). */
  inXObject?: true;
  /**
   * Active text render mode (`Tr`) when this op was shown. 3 = invisible (the
   * classic OCR layer over a scanned image); 7 = invisible + clip. Editing such
   * ops would paint visible text over a scan, so they are refused (A5).
   * Defaults to 0 (fill) when no `Tr` op preceded the show.
   */
  renderMode?: number;
  /** Active char spacing (`Tc`), word spacing (`Tw`), horizontal scale percent
   * (`Tz`, 100 = normal) and text rise (`Ts`) when this op was shown. Captured so
   * a Path-3 standard-font redraw can re-emit them; absent when left at default. */
  charSpacing?: number;
  wordSpacing?: number;
  hScale?: number;
  textRise?: number;
}

/**
 * A thin filled rectangle decoration (underline / strikethrough), located in the
 * SAME content stream as the text it decorates. Geometry is in PDF user space
 * (y-up); the width operand lives at `widthOperandIndex` of the `re` op's operands
 * (LOCAL coords — divide a user-space delta by `ctmScaleX` to write it back). The
 * stroked-line form (`m … l … S`) carries no width operand and is not represented
 * here (it is refused — left unchanged). `painterOpIndex` is the fill op that
 * paints it (neutralised to `n` to remove the decoration on a delete).
 */
export interface DecorationRule {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Index of the `re` op in the grouped ops array. */
  reOpIndex: number;
  /** Index within the `re` op's operands of the width number token (= 2). */
  widthOperandIndex: number;
  /** Index of the fill painter op (`f`/`F`/`f*`/`B`…) that paints this rect. */
  painterOpIndex: number;
  /** Horizontal CTM scale (a) applied to the rect; b == c == 0 is enforced. */
  ctmScaleX: number;
  kind: 'rect';
}
