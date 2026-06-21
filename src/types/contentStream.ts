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
  /**
   * Raw PDF *stroke* color ops string (uppercase operators), e.g. '0 0 1 RG'
   * (DeviceRGB), '0.5 G' (gray), '0 0 1 0 K' (CMYK). Captured so a Path-3 redraw of
   * stroked/outline text (render mode 1/2/4/5/6) keeps its stroke; absent when no
   * stroke color preceded the show op (F2).
   */
  strokeColor?: string;
  /** Active line width (`w`) when this op was shown — re-emitted by a Path-3 redraw
   * so stroked text keeps its outline weight. Absent when left at the default (F2). */
  lineWidth?: number;
  /**
   * Set when the combined text→user transform (textMatrix × CTM) is rotated, sheared,
   * or non-uniformly scaled (beyond the `Tz` horizontal scale). An axis-aligned scalar
   * decoration line drawn at `origin` would be mis-placed under such a transform, so
   * `addDecorationAt` refuses these (the same cm-rotation ceiling Path-3 documents).
   * Absent (falsy) for upright, uniformly-scaled text — the common case.
   */
  tilted?: true;
}

/**
 * A thin graphic decoration (underline / strikethrough) located in the SAME content
 * stream as the text it decorates. Geometry (`x`/`y`/`width`/`height`) is in PDF user
 * space (y-up), used for baseline classification. `painterOpIndex` is the paint op
 * that draws it (a fill op for `kind:'rect'`, a stroke `S` for `kind:'line'`),
 * neutralised to `n` to remove the decoration on a delete. b == c == 0 (no
 * shear/rotation) is enforced for both kinds so a scalar width rewrite stays valid.
 *
 * Two encodings are represented (the two ways authoring tools draw a rule):
 *  - `rect`: a thin filled rectangle `x y w h re` + fill painter. The width operand
 *    lives at `widthOperandIndex` of the `re` op (LOCAL coords — divide a user-space
 *    delta by `ctmScaleX` to write it back).
 *  - `line`: a horizontal stroked segment `mx my m  lx ly l  S` (the Word/LibreOffice
 *    form). Resized by rewriting the `l` endpoint x (`endpointOperandIndex`) relative
 *    to the fixed `m` anchor (`anchorLocalX`, LOCAL coords).
 */
interface DecorationRuleBase {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Index of the paint op (fill for rect, stroke `S` for line) that draws this rule. */
  painterOpIndex: number;
  /** Horizontal CTM scale (a) applied to the rule; b == c == 0 is enforced. */
  ctmScaleX: number;
}

export interface RectDecorationRule extends DecorationRuleBase {
  kind: 'rect';
  /** Index of the `re` op in the grouped ops array. */
  reOpIndex: number;
  /** Index within the `re` op's operands of the width number token (= 2). */
  widthOperandIndex: number;
}

export interface LineDecorationRule extends DecorationRuleBase {
  kind: 'line';
  /** Index of the `l` op whose endpoint x is rewritten to resize the segment. */
  lineOpIndex: number;
  /** Index within the `l` op's operands of the endpoint x token (= 0). */
  endpointOperandIndex: number;
  /** LOCAL-space x of the `m` anchor (the fixed end the segment grows away from). */
  anchorLocalX: number;
}

export type DecorationRule = RectDecorationRule | LineDecorationRule;
