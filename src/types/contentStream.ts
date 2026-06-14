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
}
