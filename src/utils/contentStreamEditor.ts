/**
 * contentStreamEditor — true PDF text editing via content-stream operator surgery.
 *
 * Locates text-showing operators (Tj, TJ, ', ") by tracking the text matrix
 * through the page's content stream, then blanks or replaces them in place.
 * Unlike the overlay approach, the original text is genuinely removed from
 * the document (no longer extractable, no longer under a cover rectangle).
 *
 * Strategy for replacement:
 *   1. For ASCII literal-string Tj/TJ ops: replace the string operand in-place,
 *      preserving the original font/size/color entirely (in-stream path).
 *   2. For hex-encoded strings (typical TrueType/CID fonts): blank the op then
 *      append a new drawText command using the detected color and size with a
 *      standard fallback font (fallback path).
 *
 * In both cases, all show ops within SHADOW_RADIUS points of the primary target
 * are also blanked to eliminate shadow/outline text effects.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';

import type { CsToken, CsOp, TextOpInfo, DecorationRule } from '../types/contentStream';
import { isArabicText, classifyRuleAsUnderline } from './flowDoc';
export type { CsToken, CsOp, TextOpInfo, DecorationRule } from '../types/contentStream';

/**
 * Max distance (PDF points) at which a secondary show op is treated as belonging
 * to the SAME logical target as the primary — i.e. a drop-shadow / outline pass
 * drawn at (essentially) the same baseline origin. Kept sub-point so it never
 * sweeps up a DISTINCT neighbour word that merely sits a few points away (BUG A2):
 * a genuine shadow is rendered at the same origin (offset, if any, comes from a
 * sub-pixel CTM nudge), whereas a separate word has a clearly different origin.
 */
const SHADOW_RADIUS = 0.5;

const WHITESPACE = new Set([' ', '\t', '\r', '\n', '\f', '\0']);
const DELIMITERS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

function isRegular(ch: string): boolean {
  return !WHITESPACE.has(ch) && !DELIMITERS.has(ch);
}

/** Tokenize a decoded PDF content stream. */
// CP1252 (WinAnsi) codepoints that live above 0xFF — the standard-font redraw
// (font.encodeText) can encode these even though they're not Latin-1.
const _WINANSI_HIGH = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/**
 * True if `text` contains any character NOT representable in WinAnsi (CP1252).
 * The Path-3 standard-font redraw paints through a WinAnsi-encoded base-14 font;
 * non-WinAnsi codepoints (CJK, Cyrillic, emoji, …) would be substituted with '?'.
 * Such edits must REFUSE true-edit and fall back to the overlay (B-3) — never
 * paint a wrong glyph. Arabic is already refused separately (overlay with shaping).
 */
export function hasNonWinAnsi(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? -1;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) continue; // tab/newline
    if (cp >= 0x20 && cp <= 0x7e) continue;                  // ASCII printable
    if (cp >= 0xa0 && cp <= 0xff) continue;                  // Latin-1 printable
    if (_WINANSI_HIGH.has(cp)) continue;                     // CP1252 high range
    return true;
  }
  return false;
}

/**
 * Locate the end (exclusive, just past `EI`) of an inline image whose `BI` was just
 * consumed, with the scanner at `from`. Per PDF spec §8.9.7 the `EI` terminator is
 * WHITESPACE-DELIMITED; a naive `indexOf('EI')` matches the byte pair "EI" occurring
 * inside the binary image data and truncates the image early, mis-tokenizing the rest
 * of the page (F7). Scan from after the `ID` data marker for an `EI` that is preceded
 * by whitespace AND followed by whitespace / a delimiter / EOF. Falls back to the first
 * bare `EI` (legacy behaviour), or the stream end, so it is never worse than before.
 */
function findInlineImageEnd(src: string, from: number): number {
  // Image data starts after the `ID` marker + a single whitespace byte.
  let dataStart = from;
  const idIdx = src.indexOf('ID', from);
  if (idIdx !== -1) {
    dataStart = idIdx + 2;
    if (WHITESPACE.has(src[dataStart])) dataStart++;
  }
  for (let k = dataStart; k < src.length; ) {
    const ei = src.indexOf('EI', k);
    if (ei === -1) break;
    const prevWs = ei === 0 || WHITESPACE.has(src[ei - 1]);
    const after = src[ei + 2];
    const afterOk = after === undefined || WHITESPACE.has(after) || DELIMITERS.has(after);
    if (prevWs && afterOk) return ei + 2;
    k = ei + 2;
  }
  const bare = src.indexOf('EI', from);
  return bare === -1 ? src.length : bare + 2;
}

export function tokenizeContentStream(src: string): CsToken[] {
  const tokens: CsToken[] = [];
  let i = 0;

  // Advance `i` over a number body: mantissa [0-9.] then an optional, WELL-FORMED
  // exponent (`e`/`E` + optional sign + ≥1 digit). Keeping `1e-3` as ONE number
  // token preserves content-stream meaning on round-trip; a lone `e` not followed
  // by a valid exponent is left for the operator scanner (B-1).
  const consumeNumberBody = (): void => {
    while (i < src.length && /[0-9.]/.test(src[i])) i++;
    if (src[i] === 'e' || src[i] === 'E') {
      let j = i + 1;
      if (src[j] === '+' || src[j] === '-') j++;
      if (j < src.length && /[0-9]/.test(src[j])) {
        j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
        i = j;
      }
    }
  };

  const readLiteralString = (): string => {
    const start = i;
    i++; // consume '('
    let depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '\\') i += 2;
      else {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        i++;
      }
    }
    return src.slice(start, i);
  };

  const readUntilBalanced = (open: string, close: string): string => {
    const start = i;
    let depth = 0;
    while (i < src.length) {
      if (src.startsWith(open, i)) {
        depth++;
        i += open.length;
      } else if (src.startsWith(close, i)) {
        depth--;
        i += close.length;
        if (depth === 0) break;
      } else if (src[i] === '(') {
        readLiteralString();
      } else {
        i++;
      }
    }
    return src.slice(start, i);
  };

  while (i < src.length) {
    const ch = src[i];

    if (WHITESPACE.has(ch)) {
      i++;
      continue;
    }

    if (ch === '%') {
      const start = i;
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++;
      tokens.push({ type: 'comment', raw: src.slice(start, i), byteStart: start, byteEnd: i });
      continue;
    }

    if (ch === '(') {
      const s = i;
      tokens.push({ type: 'string', raw: readLiteralString(), byteStart: s, byteEnd: i });
      continue;
    }

    if (ch === '<') {
      if (src[i + 1] === '<') {
        const s = i;
        tokens.push({ type: 'dict', raw: readUntilBalanced('<<', '>>'), byteStart: s, byteEnd: i });
      } else {
        const start = i;
        while (i < src.length && src[i] !== '>') i++;
        i++; // consume '>'
        tokens.push({ type: 'hexstring', raw: src.slice(start, i), byteStart: start, byteEnd: i });
      }
      continue;
    }

    if (ch === '[') {
      const arrStart = i;
      i++; // consume '['
      const items: CsToken[] = [];
      // Recursive parse until matching ']' at this level
      while (i < src.length && src[i] !== ']') {
        if (WHITESPACE.has(src[i])) {
          i++;
          continue;
        }
        const inner = tokenizeOne();
        if (inner) items.push(inner);
      }
      i++; // consume ']'
      tokens.push({
        type: 'array',
        raw: `[${items.map(t => t.raw).join(' ')}]`,
        items,
        byteStart: arrStart,
        byteEnd: i,
      });
      continue;
    }

    if (ch === '/') {
      const start = i;
      i++;
      while (i < src.length && isRegular(src[i])) i++;
      tokens.push({ type: 'name', raw: src.slice(start, i), byteStart: start, byteEnd: i });
      continue;
    }

    if (/[0-9+\-.]/.test(ch)) {
      const start = i;
      i++;
      consumeNumberBody();
      const raw = src.slice(start, i);
      tokens.push({ type: 'number', raw, value: parseFloat(raw), byteStart: start, byteEnd: i });
      continue;
    }

    // Regular-character run → operator (or inline image)
    const start = i;
    while (i < src.length && isRegular(src[i])) i++;
    const word = src.slice(start, i);
    if (word === 'BI') {
      // Inline image: pass through raw up to and including the whitespace-delimited
      // 'EI' terminator (F7 — a bare indexOf would match "EI" inside binary data).
      const end = findInlineImageEnd(src, i);
      tokens.push({ type: 'inline-image', raw: src.slice(start, end), byteStart: start, byteEnd: end });
      i = end;
    } else {
      tokens.push({ type: 'operator', raw: word, byteStart: start, byteEnd: i });
    }
  }

  // Inner single-token parser used by array parsing (shares `i` via closure)
  function tokenizeOne(): CsToken | null {
    const c = src[i];
    if (c === '(') {
      const s = i;
      const raw = readLiteralString();
      return { type: 'string', raw, byteStart: s, byteEnd: i };
    }
    if (c === '<') {
      const start = i;
      while (i < src.length && src[i] !== '>') i++;
      i++;
      return { type: 'hexstring', raw: src.slice(start, i), byteStart: start, byteEnd: i };
    }
    if (c === '/') {
      const start = i;
      i++;
      while (i < src.length && isRegular(src[i])) i++;
      return { type: 'name', raw: src.slice(start, i), byteStart: start, byteEnd: i };
    }
    if (/[0-9+\-.]/.test(c)) {
      const start = i;
      i++;
      consumeNumberBody();
      const raw = src.slice(start, i);
      return { type: 'number', raw, value: parseFloat(raw), byteStart: start, byteEnd: i };
    }
    // operator-like word inside an array (rare) — consume to stay safe
    const start = i;
    i++;
    while (i < src.length && isRegular(src[i])) i++;
    return { type: 'operator', raw: src.slice(start, i), byteStart: start, byteEnd: i };
  }

  return tokens;
}

/** Serialize tokens back into a content stream (whitespace-normalized). */
export function serializeTokens(tokens: CsToken[]): string {
  return tokens.map(t => t.raw).join(' ');
}

/** Group a token list into operator + operands records. */
export function groupOps(tokens: CsToken[]): CsOp[] {
  const ops: CsOp[] = [];
  let operands: CsToken[] = [];
  let spanStart: number | undefined;
  for (const tok of tokens) {
    if (tok.type === 'operator') {
      ops.push({
        operator: tok.raw,
        operands,
        byteStart: operands.length ? spanStart : tok.byteStart,
        byteEnd: tok.byteEnd,
      });
      operands = [];
      spanStart = undefined;
    } else if (tok.type === 'inline-image') {
      ops.push({ operator: 'INLINE_IMAGE', operands: [tok], byteStart: tok.byteStart, byteEnd: tok.byteEnd });
      operands = [];
      spanStart = undefined;
    } else if (tok.type !== 'comment') {
      if (operands.length === 0) spanStart = tok.byteStart;
      operands.push(tok);
    }
  }
  return ops;
}

/** Serialize a single grouped op back to a content-stream fragment. */
export function serializeOp(op: CsOp): string {
  return op.operator === 'INLINE_IMAGE'
    ? op.operands[0].raw
    : [...op.operands.map(t => t.raw), op.operator].join(' ');
}

/** Serialize a grouped ops list back to a content stream string. */
export function serializeOps(ops: CsOp[]): string {
  return ops.map(serializeOp).join('\n');
}

export type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function translateMatrix(tx: number, ty: number, m: Matrix): Matrix {
  return [
    m[0],
    m[1],
    m[2],
    m[3],
    tx * m[0] + ty * m[2] + m[4],
    tx * m[1] + ty * m[3] + m[5],
  ];
}

/**
 * Concatenate two affine matrices (PDF convention: A × B).
 * PDF `cm` concatenates as CTM_new = CTM_old × M_cm, so pass (CTM_old, M_cm).
 */
export function multiplyMatrix(A: Matrix, B: Matrix): Matrix {
  return [
    A[0] * B[0] + A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[2] * B[1] + A[3] * B[3],
    A[4] * B[0] + A[5] * B[2] + B[4],
    A[4] * B[1] + A[5] * B[3] + B[5],
  ];
}

/** Apply an affine matrix to a 2D point; returns the transformed point. */
export function applyMatrixToPoint(M: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: x * M[0] + y * M[2] + M[4],
    y: x * M[1] + y * M[3] + M[5],
  };
}

const SHOW_OPS = new Set(['Tj', 'TJ', "'", '"']);

/**
 * Walk ops tracking PDF text state (including CTM via q/Q/cm).
 * Returns every text-showing op with its origin and fill color.
 * Origin is reported in page user space (CTM-transformed).
 */
export function locateTextOps(ops: CsOp[]): TextOpInfo[] {
  const found: TextOpInfo[] = [];
  let textMatrix: Matrix = [...IDENTITY];
  let lineMatrix: Matrix = [...IDENTITY];
  let fontKey = '';
  let fontSize = 0;
  let leading = 0;
  let renderMode = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let hScale = 100;
  let textRise = 0;
  let fillColor: string | undefined;
  let strokeColor: string | undefined;
  let lineWidth: number | undefined;
  let extGStateName: string | undefined;
  let tfOpIndex: number | undefined;
  let colorOpIndex: number | undefined;
  // CTM stack — tracks q/Q nesting and cm transforms
  let ctm: Matrix = [...IDENTITY];
  const ctmStack: Matrix[] = [];

  const num = (t: CsToken | undefined): number => t?.value ?? 0;

  ops.forEach((op, opIndex) => {
    switch (op.operator) {
      case 'q':
        ctmStack.push([...ctm]);
        break;
      case 'Q': {
        const saved = ctmStack.pop();
        if (saved) ctm = saved;
        break;
      }
      case 'cm': {
        const m_cm: Matrix = [
          num(op.operands[0]), num(op.operands[1]),
          num(op.operands[2]), num(op.operands[3]),
          num(op.operands[4]), num(op.operands[5]),
        ];
        ctm = multiplyMatrix(ctm, m_cm);
        break;
      }
      case 'BT':
        textMatrix = [...IDENTITY];
        lineMatrix = [...IDENTITY];
        break;
      case 'gs':
        // A2: remember the active ExtGState resource so a Path-3 redraw can recover
        // its fill/stroke alpha. Last-seen wins (mirrors fill/stroke-color tracking,
        // which is likewise not q/Q-restored — a documented Path-3 limitation).
        extGStateName = op.operands[0]?.raw?.replace(/^\//, '') || undefined;
        break;
      case 'Tf':
        fontKey = op.operands[0]?.raw ?? '';
        fontSize = num(op.operands[1]);
        tfOpIndex = opIndex;
        break;
      case 'TL':
        leading = num(op.operands[0]);
        break;
      case 'Tr':
        renderMode = num(op.operands[0]);
        break;
      case 'Tc':
        charSpacing = num(op.operands[0]);
        break;
      case 'Tw':
        wordSpacing = num(op.operands[0]);
        break;
      case 'Tz':
        hScale = num(op.operands[0]);
        break;
      case 'Ts':
        textRise = num(op.operands[0]);
        break;
      case 'TD':
        leading = -num(op.operands[1]);
        lineMatrix = translateMatrix(num(op.operands[0]), num(op.operands[1]), lineMatrix);
        textMatrix = [...lineMatrix];
        break;
      case 'Td':
        lineMatrix = translateMatrix(num(op.operands[0]), num(op.operands[1]), lineMatrix);
        textMatrix = [...lineMatrix];
        break;
      case 'Tm': {
        const m = op.operands.slice(0, 6).map(t => t.value ?? 0);
        lineMatrix = m as Matrix;
        textMatrix = [...lineMatrix];
        break;
      }
      case 'T*':
        lineMatrix = translateMatrix(0, -leading, lineMatrix);
        textMatrix = [...lineMatrix];
        break;
      // Fill color operators — tracked so replacement can preserve text color
      case 'rg':
        fillColor = op.operands.map(t => t.raw).join(' ') + ' rg';
        colorOpIndex = opIndex;
        break;
      case 'g':
        fillColor = op.operands.map(t => t.raw).join(' ') + ' g';
        colorOpIndex = opIndex;
        break;
      case 'k':
        fillColor = op.operands.map(t => t.raw).join(' ') + ' k';
        colorOpIndex = opIndex;
        break;
      case 'sc':
      case 'scn':
        fillColor = op.operands.map(t => t.raw).join(' ') + ' ' + op.operator;
        colorOpIndex = opIndex;
        break;
      case 'cs':
        // Color space change — color value no longer reliable; reset.
        fillColor = undefined;
        colorOpIndex = undefined;
        break;
      // Stroke color operators (uppercase) — tracked so a Path-3 redraw of
      // stroked/outline text keeps its stroke color (F2).
      case 'RG':
      case 'G':
      case 'K':
      case 'SC':
      case 'SCN':
        strokeColor = op.operands.map(t => t.raw).join(' ') + ' ' + op.operator;
        break;
      case 'CS':
        // Stroke color space change — stroke color no longer reliable; reset.
        strokeColor = undefined;
        break;
      case 'w':
        // Line width — re-emitted by a Path-3 redraw so stroked text keeps weight.
        lineWidth = num(op.operands[0]);
        break;
      default:
        break;
    }

    if (SHOW_OPS.has(op.operator)) {
      if (op.operator === "'" || op.operator === '"') {
        lineMatrix = translateMatrix(0, -leading, lineMatrix);
        textMatrix = [...lineMatrix];
        // The `"` op (aw ac string ") sets word + char spacing as PERSISTENT graphics
        // state — spec: `"` ≡ `aw Tw ac Tc string '`. Capture them so a later Path-3
        // redraw of this run uses the correct spacing (F8); previously ignored.
        if (op.operator === '"') {
          wordSpacing = num(op.operands[0]);
          charSpacing = num(op.operands[1]);
        }
      }
      const vScale = Math.hypot(textMatrix[2], textMatrix[3]) || 1;
      // Combined text→user linear transform (textMatrix × CTM). For upright,
      // uniformly-scaled text the off-diagonals are ~0 and the horizontal scale
      // (after dividing out the Tz hScale) matches the vertical scale; anything
      // else means a scalar axis-aligned underline would be mis-placed → tilted.
      const trm = multiplyMatrix(textMatrix, ctm);
      const sxRaw = Math.hypot(trm[0], trm[1]);
      const sx = sxRaw / (hScale / 100 || 1);
      const sy = Math.hypot(trm[2], trm[3]);
      const tilted =
        Math.abs(trm[1]) > 1e-3 ||
        Math.abs(trm[2]) > 1e-3 ||
        (sy > 1e-6 && Math.abs(sx - sy) > 0.02 * sy);
      found.push({
        opIndex,
        operator: op.operator,
        origin: applyMatrixToPoint(ctm, textMatrix[4], textMatrix[5]),
        fontKey,
        fontSize: fontSize * vScale,
        fillColor,
        tfOpIndex,
        colorOpIndex,
        renderMode,
        // Only carry non-default graphics state (keeps unaffected ops byte-identical).
        ...(charSpacing !== 0 ? { charSpacing } : {}),
        ...(wordSpacing !== 0 ? { wordSpacing } : {}),
        ...(hScale !== 100 ? { hScale } : {}),
        ...(textRise !== 0 ? { textRise } : {}),
        ...(strokeColor !== undefined ? { strokeColor } : {}),
        ...(lineWidth !== undefined ? { lineWidth } : {}),
        ...(tilted ? { tilted: true as const } : {}),
        ...(extGStateName !== undefined ? { extGStateName } : {}),
      });
    }
  });

  return found;
}

// ── Decoration rules (underline / strikethrough) ────────────────────────────────

const FILL_PAINTERS = new Set(['f', 'F', 'f*', 'b', 'b*', 'B', 'B*']);
const PATH_PAINTERS = new Set([...FILL_PAINTERS, 'S', 's', 'n']);

/**
 * Locate thin FILLED rectangles (`x y w h re` + a fill painter) in the same content
 * stream, CTM-transformed into PDF user space. These are underline/strikethrough
 * decoration candidates. The stroked-line form (`m … l … S`) carries no width
 * operand and is deliberately NOT collected — it is refused (left unchanged). A rect
 * under a rotated/sheared CTM (b or c ≠ 0) is omitted: its width operand can't be
 * rewritten by a simple scalar. Pure → jsdom-unit-testable.
 */
export function locateDecorationRects(ops: CsOp[]): DecorationRule[] {
  const out: DecorationRule[] = [];
  let ctm: Matrix = [...IDENTITY];
  const ctmStack: Matrix[] = [];
  const num = (t: CsToken | undefined): number => t?.value ?? 0;
  const skewed = (): boolean => Math.abs(ctm[1]) > 1e-6 || Math.abs(ctm[2]) > 1e-6;
  // A mirror / negative-scale CTM (flip-X `-1 0 0 1`, flip-Y `1 0 0 -1`, 180° `-1 0 0 -1`)
  // can't be width-resized by a positive scalar; refuse rather than resize the wrong way (F5).
  const mirrored = (): boolean => ctm[0] < 0 || ctm[3] < 0;
  // Pending `re` rectangles awaiting their painter op (a single painter can close
  // several preceding `re` ops; we only adjust a rect that is the SOLE pending one).
  let pending: { reOpIndex: number; x: number; y: number; w: number; h: number; scaleX: number }[] = [];
  // Pending `m`/`l` subpath segments awaiting a stroke painter. A simple horizontal
  // underline is EXACTLY one `m` then one `l`; a polyline (≥2 `l`) or multi-subpath
  // (≥2 `m`) is ambiguous → refused.
  let mList: { localX: number; userX: number; userY: number; scaleX: number; skewed: boolean; mirrored: boolean }[] = [];
  let lList: { opIndex: number; userX: number; userY: number }[] = [];
  // True when a curve op (c/v/y/h) precedes the painter: it would share the paint, so
  // resizing/removing the rect or line would touch unrelated geometry — refuse.
  let sawOtherPath = false;
  // Current stroke line width (`w`), graphics state — sets a stroked line's thickness.
  let lineWidthLocal = 1;

  const reset = (): void => { pending = []; mList = []; lList = []; sawOtherPath = false; };

  ops.forEach((op, opIndex) => {
    switch (op.operator) {
      case 'q':
        ctmStack.push([...ctm]);
        break;
      case 'Q': {
        const saved = ctmStack.pop();
        if (saved) ctm = saved;
        break;
      }
      case 'cm':
        ctm = multiplyMatrix(ctm, [
          num(op.operands[0]), num(op.operands[1]), num(op.operands[2]),
          num(op.operands[3]), num(op.operands[4]), num(op.operands[5]),
        ]);
        break;
      case 'w':
        lineWidthLocal = num(op.operands[0]);
        break;
      case 're': {
        // Refuse sheared/rotated or mirror/negative-scale CTM — a scalar width
        // rewrite would be wrong (or flip direction). (F5 adds the mirror case.)
        if (skewed() || mirrored()) break;
        const lx = num(op.operands[0]);
        const ly = num(op.operands[1]);
        const lw = num(op.operands[2]);
        const lh = num(op.operands[3]);
        const p = applyMatrixToPoint(ctm, lx, ly);
        pending.push({ reOpIndex: opIndex, x: p.x, y: p.y, w: lw * ctm[0], h: lh * ctm[3], scaleX: ctm[0] });
        break;
      }
      case 'm': {
        const lxm = num(op.operands[0]);
        const p = applyMatrixToPoint(ctm, lxm, num(op.operands[1]));
        mList.push({ localX: lxm, userX: p.x, userY: p.y, scaleX: ctm[0], skewed: skewed(), mirrored: mirrored() });
        break;
      }
      case 'l': {
        const p = applyMatrixToPoint(ctm, num(op.operands[0]), num(op.operands[1]));
        lList.push({ opIndex, userX: p.x, userY: p.y });
        break;
      }
      case 'c': case 'v': case 'y': case 'h':
        sawOtherPath = true;
        break;
      default:
        if (PATH_PAINTERS.has(op.operator)) {
          // A SINGLE pending rect, closed by a FILL painter, with NO other subpath
          // sharing that painter, is an unambiguous filled-rect decoration.
          if (
            FILL_PAINTERS.has(op.operator) &&
            pending.length === 1 && mList.length === 0 && lList.length === 0 && !sawOtherPath
          ) {
            const r = pending[0];
            // Normalize the vertical extent to the TRUE bounding box. PDF `re` allows a
            // NEGATIVE height (e.g. iText/JasperReports draw filled bands top-down as
            // `x y w -h re`); a signed height would defeat the classifier's "too tall to
            // be a decoration" guard (`-h > 0.18*size` is false), letting a full background
            // fill be mistaken for an underline/strike and resized (#bg-fill). A genuine
            // thin underline drawn top-down normalizes to a thin positive height and still
            // classifies. Width keeps its sign — a negative-width rect is already rejected
            // by the classifier, so the width-operand resize never touches it.
            const y0 = r.h < 0 ? r.y + r.h : r.y;
            out.push({
              x: r.x, y: y0, width: r.w, height: Math.abs(r.h),
              reOpIndex: r.reOpIndex, widthOperandIndex: 2, painterOpIndex: opIndex,
              ctmScaleX: r.scaleX, kind: 'rect',
            });
          }
          // A SINGLE horizontal `m`→`l` segment, closed by a plain STROKE `S`, with no
          // rect, no curve and no extra subpath, is a stroked-line decoration (the
          // Word/LibreOffice underline form). `s` (closepath+stroke) is refused — its
          // implicit closing segment makes the geometry ambiguous.
          if (
            op.operator === 'S' &&
            pending.length === 0 && mList.length === 1 && lList.length === 1 && !sawOtherPath
          ) {
            const m = mList[0];
            const l = lList[0];
            if (!m.skewed && !m.mirrored && Math.abs(m.userY - l.userY) <= 1e-3) {
              const strokeUser = lineWidthLocal * Math.abs(ctm[3]);
              out.push({
                x: Math.min(m.userX, l.userX),
                y: m.userY - strokeUser / 2,
                width: Math.abs(l.userX - m.userX),
                height: strokeUser,
                lineOpIndex: l.opIndex, endpointOperandIndex: 0, anchorLocalX: m.localX,
                painterOpIndex: opIndex, ctmScaleX: m.scaleX, kind: 'line',
              });
            }
          }
          reset();
        }
        break;
    }
  });

  return out;
}

/**
 * True if any `Q` operator pops an empty graphics-state stack (unbalanced q/Q).
 * When true, the CTM is stale from that point on, so CTM-dependent decoration
 * geometry on the stream is unreliable and a resize is refused (F13). Pure.
 */
export function ctmStackUnderflows(ops: CsOp[]): boolean {
  let depth = 0;
  for (const op of ops) {
    if (op.operator === 'q') depth++;
    else if (op.operator === 'Q') {
      if (depth === 0) return true;
      depth--;
    }
  }
  return false;
}

/**
 * Pick the SINGLE decoration rule that belongs to a text op (origin = baseline,
 * extent = [origin.x, origin.x + textWidth]). Reuses the export-path classifier so
 * the baseline-band + ≥50%-overlap thresholds match exactly. Returns null when
 * there is no match OR more than one candidate (ambiguous → refuse, never guess).
 */
export function matchDecorationForText(
  rules: DecorationRule[],
  target: { origin: { x: number; y: number }; fontSize: number },
  textWidth: number,
): { rule: DecorationRule; kind: 'underline' | 'strikethrough' } | null {
  const run = { x: target.origin.x, y: target.origin.y, width: textWidth, size: target.fontSize };
  const hits: { rule: DecorationRule; kind: 'underline' | 'strikethrough' }[] = [];
  for (const rule of rules) {
    const kind = classifyRuleAsUnderline(rule, run);
    if (!kind) continue;
    // SYMMETRIC overlap (#bg-fill F1/F2): classifyRuleAsUnderline only checks that the rule
    // covers ≥50% of the TEXT — a thin full-width table border / footer separator / band edge
    // that merely crosses the baseline passes (a 500pt rule fully covers a 28pt word), and we
    // would then RESIZE pre-existing page geometry. A genuine underline/strike is ~text-width,
    // so also require the TEXT to cover ≥50% of the RULE. (classifyRuleAsUnderline is shared with
    // the read-only export path, where rejecting a multi-word-spanning underline for one word
    // would lose the mark — so this destructive-edit-only guard lives here, not in the classifier.)
    const rw = Math.abs(rule.width);
    const overlap = Math.min(rule.x + rw, run.x + run.width) - Math.max(rule.x, run.x);
    if (overlap < 0.5 * rw) continue;
    hits.push({ rule, kind });
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * New decoration-rule width after a text-length change: scale the old rule width by
 * the new/old text-width ratio (both measured in the SAME proxy font → path- and
 * scale-independent). Returns null when the old text width is ~0 (div-by-zero guard).
 */
export function adjustedRuleWidth(oldLocalWidth: number, oldTextWidth: number, newTextWidth: number): number | null {
  if (!(oldTextWidth > 1e-3)) return null;
  return oldLocalWidth * (newTextWidth / oldTextWidth);
}

// ── Color helpers ──────────────────────────────────────────────────────────────

/**
 * Extract the PostScript name from a pdf.js internal font id.
 * pdf.js ids look like 'g_d0_ABCDEF+Arial-BoldMT'; the part after '+' is the real name.
 * Returns the raw id unchanged when no '+' is present.
 */
export function extractPsName(internalId: string): string {
  const m = internalId.match(/\+(.+)$/);
  return m ? m[1] : internalId;
}

export interface Rgb { r: number; g: number; b: number }

/**
 * Decide the RGB the Path-3 redraw should paint, in precedence order:
 *   1. an explicit style color (toolbar override),
 *   2. a parseable in-stream fill (rg / g / k),
 *   3. a canvas-sampled fallback (for scn/Separation/spot, whose true color the
 *      stream parser cannot resolve but the rendered page already shows),
 *   4. black.
 * Pure — unit-testable without a PDFDocument.
 */
export function resolveRedrawColor(
  styleColor: Rgb | undefined,
  fillColorRaw: string | undefined,
  fallbackColor?: Rgb
): Rgb {
  if (styleColor) return styleColor;
  const parsed = fillColorRaw ? parseFillColorToRgb(fillColorRaw) : null;
  if (parsed) return parsed;
  if (fallbackColor) return fallbackColor;
  return { r: 0, g: 0, b: 0 };
}

function parseFillColorToRgb(raw: string): Rgb | null {
  const rgMatch = raw.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+[rR][gG]$/);
  if (rgMatch) {
    return { r: parseFloat(rgMatch[1]), g: parseFloat(rgMatch[2]), b: parseFloat(rgMatch[3]) };
  }
  const gMatch = raw.match(/^([\d.]+)\s+g$/i);
  if (gMatch) {
    const v = parseFloat(gMatch[1]);
    return { r: v, g: v, b: v };
  }
  const kMatch = raw.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+[kK]$/);
  if (kMatch) {
    const c = parseFloat(kMatch[1]);
    const m2 = parseFloat(kMatch[2]);
    const y = parseFloat(kMatch[3]);
    const k = parseFloat(kMatch[4]);
    return { r: (1 - c) * (1 - k), g: (1 - m2) * (1 - k), b: (1 - y) * (1 - k) };
  }
  return null;
}

/**
 * Convert a raw PDF fill color ops string to a 6-char uppercase hex string.
 * Returns undefined for unsupported or unrecognised color formats.
 */
export function fillColorToHex(raw: string): string | undefined {
  const c = parseFillColorToRgb(raw);
  if (!c) return undefined;
  const toHex = (v: number): string =>
    Math.round(Math.max(0, Math.min(255, v * 255)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return toHex(c.r) + toHex(c.g) + toHex(c.b);
}

// ── In-stream replacement helpers ─────────────────────────────────────────────

function isAsciiSafe(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

function encodeLiteralString(text: string): string {
  return '(' + text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
}

/**
 * Decode a PDF literal-string raw token `(...)` into its logical characters.
 * Handles the escapes `encodeLiteralString` emits (`\\`, `\(`, `\)`) plus the
 * standard PDF backslash escapes (`\n \r \t \b \f`, octal `\ddd`, and a
 * line-continuation `\` at EOL). Used only to MEASURE each TJ segment's length
 * so a multi-segment kerned array can be split proportionally — exactness of the
 * decoded text isn't required, only its character count.
 */
export function decodeLiteralString(raw: string): string {
  let s = raw;
  if (s.startsWith('(')) s = s.slice(1);
  if (s.endsWith(')')) s = s.slice(0, -1);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[i + 1];
    if (n === undefined) break;
    if (n >= '0' && n <= '7') {
      let oct = n;
      i++;
      for (let k = 0; k < 2 && s[i + 1] >= '0' && s[i + 1] <= '7'; k++) oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8) & 0xff);
    } else if (n === '\n' || n === '\r') {
      i++; // line continuation: backslash-newline collapses to nothing
    } else {
      const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
      out += map[n] ?? n;
      i++;
    }
  }
  return out;
}

/**
 * Try to replace the string payload of a show op in-place.
 * Only succeeds when the operand is a literal string `(...)` and newText is
 * pure ASCII (32–126) — hex-encoded or non-ASCII content is left unchanged.
 * Returns true on success (stream modified); false when the fallback path is needed.
 */
export function replaceShowOpInPlace(op: CsOp, newText: string): boolean {
  if (!isAsciiSafe(newText)) return false;

  if (op.operator === 'TJ') {
    const arr = op.operands[0];
    if (!arr || arr.type !== 'array' || !arr.items) return false;
    const stringItems = arr.items.filter(t => t.type === 'string');
    if (stringItems.length === 0) return false; // all hex → can't replace safely
    // Gap 1 (kerning preservation): distribute newText across the EXISTING string
    // segments by their original character counts, leaving the kerning numbers
    // between them untouched. Equal-length edits keep each segment's char count
    // (so kerning stays in its original visual position); a length delta is
    // absorbed by the LAST segment (the common "fix one word" edit). This
    // replaces the old collapse-to-one-literal behaviour that discarded all
    // kerning and reflowed the line, shifting neighbouring glyphs.
    const lengths = stringItems.map(it => decodeLiteralString(it.raw).length);
    let cursor = 0;
    for (let si = 0; si < stringItems.length; si++) {
      const isLast = si === stringItems.length - 1;
      const take = isLast ? newText.length - cursor : Math.min(lengths[si], newText.length - cursor);
      const slice = take > 0 ? newText.slice(cursor, cursor + take) : '';
      cursor += slice.length;
      stringItems[si].raw = encodeLiteralString(slice);
    }
    arr.raw = `[${arr.items.map(t => t.raw).join(' ')}]`;
    return true;
  }

  // Tj, ', "
  const str = op.operands[op.operands.length - 1];
  if (!str) return false;
  if (str.type === 'hexstring') return false;
  if (str.type !== 'string') return false;
  str.raw = encodeLiteralString(newText);
  return true;
}

// ── Page content I/O ───────────────────────────────────────────────────────────

/** Decode and concatenate all content streams of a page. */
function getPageContent(doc: PDFDocument, pageIndex: number): string {
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  if (!contents) return '';

  const streams: PDFRawStream[] = [];
  if (contents instanceof PDFRawStream) {
    streams.push(contents);
  } else if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const resolved = doc.context.lookup(contents.get(i));
      if (resolved instanceof PDFRawStream) streams.push(resolved);
    }
  }

  let out = '';
  for (const s of streams) {
    const bytes = decodePDFRawStream(s).decode();
    let chunk = '';
    for (let i = 0; i < bytes.length; i++) chunk += String.fromCharCode(bytes[i]);
    out += chunk + '\n';
  }
  return out;
}

/**
 * Pack a raw-byte content string into bytes. A PDF content stream is a BYTE string — every char
 * here is built via `String.fromCharCode(byte)`, so each code point must be 0–255. A code point
 * >0xFF means a Unicode char leaked into the stream (a builder that forgot to byte-encode); the
 * `& 0xff` mask would then silently corrupt it. Lossless today, but the mask is a latent footgun
 * (#QA-2026-06-23 P3 #9) — so we surface the first offending code point instead of truncating in
 * silence. (One pass, no extra cost — the check rides the existing copy loop.)
 */
export function stringToContentBytes(content: string): Uint8Array {
  const bytes = new Uint8Array(content.length);
  let high = -1;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    if (c > 0xff && high < 0) high = c;
    bytes[i] = c & 0xff;
  }
  if (high >= 0) {
    // eslint-disable-next-line no-console -- surface latent content-stream corruption (no reporter here)
    console.warn(`[contentStreamEditor] content stream contained code point U+${high.toString(16).toUpperCase().padStart(4, '0')} (>0xFF) — truncated to a byte; the stream must be a raw byte string`);
  }
  return bytes;
}

/** Replace the page's Contents with a single new uncompressed stream. */
function setPageContent(doc: PDFDocument, pageIndex: number, content: string): void {
  const page = doc.getPage(pageIndex);
  const bytes = stringToContentBytes(content);
  const stream = doc.context.stream(bytes);
  const ref = doc.context.register(stream);
  page.node.set(PDFName.of('Contents'), ref);
}

/**
 * Replace a Form XObject's content stream with new uncompressed content.
 * Preserves the XObject's /BBox, /Resources, /Matrix, and other metadata.
 */
function setFormXObjectContent(
  doc: PDFDocument,
  pageIndex: number,
  xobjName: string,
  content: string,
): void {
  try {
    const page = doc.getPage(pageIndex);
    const name = xobjName.replace(/^\//, '');
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const resources = doc.context.lookup((page.node as any).Resources()) as any;
    if (!resources?.get) return;
    const xobjDictRaw = resources.get(PDFName.of('XObject'));
    if (!xobjDictRaw) return;
    const xobjDict = doc.context.lookup(xobjDictRaw) as PDFDict;
    if (!xobjDict?.get) return;
    const streamRef = xobjDict.get(PDFName.of(name));
    if (!streamRef) return;
    const oldStream = doc.context.lookup(streamRef);
    if (!(oldStream instanceof PDFRawStream)) return;

    const bytes = stringToContentBytes(content);

    // Build new dict: copy all entries except /Filter, /DecodeParms (now uncompressed), update /Length
    const newDict = PDFDict.fromMapWithContext(new Map(), doc.context);
    for (const [k, v] of oldStream.dict.entries()) {
      const kStr = k.toString();
      if (kStr !== '/Filter' && kStr !== '/DecodeParms') newDict.set(k, v);
    }
    newDict.set(PDFName.of('Length'), doc.context.obj(bytes.length));

    const newStream = PDFRawStream.of(newDict, bytes);
    if (streamRef instanceof PDFRef) {
      doc.context.assign(streamRef, newStream);
    } else {
      const newRef = doc.context.register(newStream);
      xobjDict.set(PDFName.of(name), newRef);
    }
  } catch { /* silently ignore — falls through to overlay */ }
}

/** Blank the string payload of a show op in place (keeps state side-effects like T*). */
function blankShowOp(op: CsOp): void {
  if (op.operator === 'TJ') {
    const arr = op.operands[0];
    if (arr && arr.type === 'array') {
      arr.raw = '[]';
      arr.items = [];
    }
    return;
  }
  // Tj, ', " — the string is the last operand
  const str = op.operands[op.operands.length - 1];
  if (str && (str.type === 'string' || str.type === 'hexstring')) {
    str.raw = '()';
    str.type = 'string';
  }
}

/**
 * Extract a show op's shown-text payload as a comparable string: the
 * concatenation of all its string/hexstring operands (raw, brackets stripped).
 * Used to tell a genuine shadow/outline duplicate (identical payload) apart from
 * a DISTINCT neighbour that merely shares the origin.
 */
function showOpPayload(op: CsOp): string {
  const parts: CsToken[] =
    op.operator === 'TJ'
      ? (op.operands[0]?.items ?? []).filter(t => t.type === 'string' || t.type === 'hexstring')
      : [op.operands[op.operands.length - 1]].filter(
          (t): t is CsToken => !!t && (t.type === 'string' || t.type === 'hexstring')
        );
  return parts.map(t => t.raw.replace(/^[(<]|[)>]$/g, '')).join('');
}

/**
 * Blank only the show ops that are genuine shadow/outline DUPLICATES of the
 * target: within SHADOW_RADIUS of `primaryOrigin` AND sharing the target's font
 * key, font size, and shown-text payload. Proximity alone is NOT enough — a
 * distinct neighbour word sharing the origin must survive (BUG A4). The op at
 * `excludeOpIndex` is skipped (handled separately by the caller).
 */
function blankAllNearby(
  ops: CsOp[],
  textOps: TextOpInfo[],
  target: TextOpInfo,
  excludeOpIndex: number,
  targetPayload: string
): void {
  const primaryOrigin = target.origin;
  for (const t of textOps) {
    if (t.opIndex === excludeOpIndex) continue;
    const dist = Math.hypot(t.origin.x - primaryOrigin.x, t.origin.y - primaryOrigin.y);
    if (dist > SHADOW_RADIUS) continue;
    // Same logical text only: a true shadow repeats the identical glyph payload
    // in the same font at the same size. Differ on any of these → keep it.
    if (t.fontKey !== target.fontKey) continue;
    if (Math.abs(t.fontSize - target.fontSize) > 0.01) continue;
    if (showOpPayload(ops[t.opIndex]) !== targetPayload) continue;
    blankShowOp(ops[t.opIndex]);
  }
}

// ── Public edit API ────────────────────────────────────────────────────────────

interface EditTarget {
  ops: CsOp[];
  target: TextOpInfo;
  textOps: TextOpInfo[];
  /** Set when the target lives inside a Form XObject rather than the page stream. */
  xObjectName?: string;
  /** The ORIGINAL decoded stream the ops were parsed from (F3 byte-splice source). */
  source: string;
  /** serializeOp(op) for each op, captured BEFORE any mutation — the diff baseline. */
  origSerialized: string[];
}

/**
 * Compute the new content stream for a write-back. Hybrid byte-splice (F3):
 *  - exactly ONE op changed (vs the pre-mutation snapshot) with a valid byte span →
 *    splice that op's bytes in the ORIGINAL source, keep every other byte verbatim;
 *  - ZERO ops changed but an appended tail (addDecorationAt) → keep source verbatim;
 *  - otherwise → today's full re-serialize (`serializeOps`), zero regression.
 * `appendedTail` (the Path-3 redraw / decoration block) is always concatenated last.
 * Preserves inline images and any byte the tokenizer mis-models, for the common edit.
 */
export function buildStreamContent(found: EditTarget, appendedTail = ''): string {
  const { ops, source, origSerialized } = found;
  const changed: number[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (serializeOp(ops[k]) !== origSerialized[k]) changed.push(k);
  }
  if (changed.length === 1) {
    const op = ops[changed[0]];
    if (
      typeof op.byteStart === 'number' && typeof op.byteEnd === 'number' &&
      op.byteStart >= 0 && op.byteEnd <= source.length && op.byteStart <= op.byteEnd
    ) {
      return source.slice(0, op.byteStart) + serializeOp(op) + source.slice(op.byteEnd) + appendedTail;
    }
  }
  if (changed.length === 0 && appendedTail) return source + appendedTail;
  return serializeOps(ops) + appendedTail;
}

/** Write modified ops back to either the page stream or an XObject stream. */
function writeBack(doc: PDFDocument, pageIndex: number, found: EditTarget): void {
  const content = buildStreamContent(found, '');
  if (found.xObjectName) {
    setFormXObjectContent(doc, pageIndex, found.xObjectName, content);
  } else {
    setPageContent(doc, pageIndex, content);
  }
}

function findTarget(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  tolerance: number
): EditTarget | null {
  const pageContent = getPageContent(doc, pageIndex);
  if (!pageContent) return null;
  const pageOps = groupOps(tokenizeContentStream(pageContent));
  const directTextOps = locateTextOps(pageOps);

  let best: TextOpInfo | null = null;
  let bestDist = Infinity;
  for (const t of directTextOps) {
    // Skip blanked/empty show ops. Path 3 (standard-font redraw) blanks the
    // original op in place — `()Tj` / `[]TJ` — and appends a live redraw at the
    // end of the stream. Both sit at the same origin, so a later edit would tie
    // on distance and the ghost (lower opIndex) would win, leaving the live
    // redraw untouched while the new text overlays it (the "second edit resets /
    // text on top of each other" bug). An empty op shows nothing, so it is never
    // a legitimate edit target regardless.
    if (showOpPayload(pageOps[t.opIndex]).trim() === '') continue;
    const dist = Math.hypot(t.origin.x - point.x, t.origin.y - point.y);
    if (dist <= tolerance && dist < bestDist) { bestDist = dist; best = t; }
  }
  if (best) {
    return {
      ops: pageOps, target: best, textOps: directTextOps,
      source: pageContent, origSerialized: pageOps.map(serializeOp),
    };
  }

  // Fall back: search Form XObjects referenced by Do operators in the page stream.
  interface XCandidate { dist: number; target: TextOpInfo; ops: CsOp[]; textOps: TextOpInfo[]; xObjectName: string; source: string }
  let bestX: XCandidate | null = null;
  for (const op of pageOps) {
    if (op.operator !== 'Do') continue;
    const raw = op.operands[0]?.raw ?? '';
    if (!raw) continue;
    const xContent = getFormXObjectContent(doc, pageIndex, raw);
    if (!xContent) continue;
    const xMatrix = getFormXObjectMatrix(doc, pageIndex, raw);
    const xOps = groupOps(tokenizeContentStream(xContent));
    const xTextOps = locateTextOps(xOps);
    for (const t of xTextOps) {
      if (showOpPayload(xOps[t.opIndex]).trim() === '') continue; // skip blanked ghosts
      const ps = applyMatrixToPoint(xMatrix, t.origin.x, t.origin.y);
      const dist = Math.hypot(ps.x - point.x, ps.y - point.y);
      if (dist <= tolerance && dist < (bestX?.dist ?? Infinity)) {
        // Flag the target as XObject-sourced so callers (textEditHandler) can
        // treat it as not-truly-editable and fall back to an overlay (A1).
        bestX = { dist, target: { ...t, inXObject: true }, ops: xOps, textOps: xTextOps, xObjectName: raw.replace(/^\//, ''), source: xContent };
      }
    }
  }
  if (bestX) {
    return {
      ops: bestX.ops, target: bestX.target, textOps: bestX.textOps,
      xObjectName: bestX.xObjectName, source: bestX.source,
      origSerialized: bestX.ops.map(serializeOp),
    };
  }

  return null;
}

/**
 * Locate the text-show op nearest to `point` without modifying anything.
 * Lets callers test whether a true edit is possible before offering it.
 */
export function findTextOpAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  tolerance = 5
): TextOpInfo | null {
  return findTarget(doc, pageIndex, point, tolerance)?.target ?? null;
}

/**
 * Decode one show op's shown text into a logical string, mirroring the operand
 * kinds the edit path (`replaceShowOpInPlace` / `replaceShowOpHex` / Path-2) acts
 * on, so the decoded text never diverges from what `replaceTextAt` will replace:
 *   - literal-string operands  → `decodeLiteralString` (the same helper the edit
 *     path uses to MEASURE segment lengths);
 *   - hex operands / `TJ` hex items, font WITH ToUnicode → the font's CMap
 *     (`forward`, keyed by integer char code), split into `bytesPerCode`-sized code
 *     units — the SAME map Path-2 builds (it inverts this map to re-encode);
 *   - hex operands, font WITHOUT ToUnicode but `byteSwapSafe` → the single-byte
 *     codes are their own character codes (a standard, non-embedded font where
 *     byte == ASCII; pdf-lib's `drawText` emits standard-font text as hex). This is
 *     the exact case Path-1 (`replaceShowOpInPlace`) edits, so decoding it here
 *     keeps prefill == replacement. A byte-swap-UNSAFE font (subset/CID/embedded)
 *     with no ToUnicode is undecodable here → '' (caller keeps the clicked string).
 * Numeric `TJ` kerning entries are ignored; segments are concatenated in stream
 * order. Returns '' when nothing decodes (the caller treats '' as "give up").
 */
function decodeShowOpText(
  op: CsOp,
  forward: Map<number, string> | null,
  bytesPerCode: 1 | 2,
  byteSwapSafe: boolean,
): string {
  // Decode a raw byte sequence to a logical string, applying the SAME font-safety
  // gate to literal- and hex-string operands alike. A literal `( … )` operand's
  // bytes are char codes in the font's encoding exactly like a hex operand's —
  // for a subset/CID/embedded font those are glyph codes, NOT ASCII, so decoding
  // them verbatim yields garbage. (The literal branch used to skip this gate,
  // which prefilled the inline editor with random characters — the click-to-edit
  // regression.)
  const decodeBytes = (bytes: number[]): string => {
    let out = '';
    if (forward) {
      for (let i = 0; i + bytesPerCode <= bytes.length; i += bytesPerCode) {
        let code = 0;
        for (let k = 0; k < bytesPerCode; k++) code = (code << 8) | bytes[i + k];
        const uni = forward.get(code);
        if (uni !== undefined) out += uni;
      }
      return out;
    }
    // No ToUnicode: only a standard byte==ASCII font is safely decodable (Path-1).
    if (!byteSwapSafe) return '';
    for (const b of bytes) out += String.fromCharCode(b);
    return out;
  };

  const hexToBytes = (inner: string): number[] => {
    const clean = inner.replace(/\s+/g, '');
    const bytes: number[] = [];
    for (let i = 0; i + 2 <= clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
    return bytes;
  };
  const literalToBytes = (raw: string): number[] => {
    const decoded = decodeLiteralString(raw);
    const bytes: number[] = [];
    for (let i = 0; i < decoded.length; i++) bytes.push(decoded.charCodeAt(i) & 0xff);
    return bytes;
  };

  const decodeToken = (tok: CsToken | undefined): string => {
    if (!tok) return '';
    if (tok.type === 'string') return decodeBytes(literalToBytes(tok.raw));
    if (tok.type === 'hexstring') return decodeBytes(hexToBytes(tok.raw.replace(/^</, '').replace(/>$/, '')));
    return '';
  };

  if (op.operator === 'TJ') {
    const arr = op.operands[0];
    if (!arr || arr.type !== 'array' || !arr.items) return '';
    // Concatenate string/hex segments in order; ignore the numeric kerning entries.
    return arr.items
      .filter(t => t.type === 'string' || t.type === 'hexstring')
      .map(decodeToken)
      .join('');
  }
  // Tj, ', " — the shown string is the last operand.
  return decodeToken(op.operands[op.operands.length - 1]);
}

/**
 * Decode the editable text of the show op nearest to `point`, for prefilling the
 * inline true-edit editor (G8). The prefill MUST equal what `replaceTextAt` will
 * later replace at the same origin: pdf.js splits a `Tj`/`TJ` word into one item
 * PER GLYPH, so `best.str` is often a single character while the matched op holds
 * the whole word — prefilling `best.str` then in-place-editing the whole op
 * corrupts the word down to that one glyph. Returning the matched op's OWN text
 * keeps prefill == replacement, so a single-`Tj` word shows and edits whole.
 *
 * Returns null when:
 *   - no show op lies within `tolerance` (off-text click);
 *   - the target lives inside a Form XObject (`inXObject`) — not editable in place,
 *     the caller falls back to an overlay; or
 *   - decoding is impossible / yields empty (e.g. a hex op with no ToUnicode) — the
 *     caller then keeps the clicked item's own string, which is always safe.
 *
 * Ceiling: this returns the SINGLE matched op's text. A word drawn across MULTIPLE
 * separate show ops is a structural limit — only the matched op is edited in place;
 * the whole-word path is the G7 clustered overlay.
 */
export function getEditableTextAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  tolerance = 5,
): string | null {
  const found = findTarget(doc, pageIndex, point, tolerance);
  if (!found) return null;
  // XObject targets aren't truly editable (own coord space + subset font); the
  // handler overlays instead, so there is no prefill to derive here.
  if (found.xObjectName || found.target.inXObject) return null;

  const op = found.ops[found.target.opIndex];
  if (!op) return null;

  // Reuse the trusted ToUnicode machinery so hex operands decode exactly as Path-2
  // re-encodes them. Built once per call; null when the font carries no ToUnicode.
  const cmapText = getPageFontToUnicode(doc, pageIndex, found.target.fontKey);
  const forward = cmapText ? parseToUnicodeCMap(cmapText) : null;
  const bytesPerCode = cmapText ? detectCMapBytesPerCode(cmapText) : 2;
  // For a hex op with no ToUnicode, only a standard byte==ASCII font (the Path-1
  // case) is safely decodable — gate on the SAME predicate Path-1 uses.
  const byteSwapSafe = !isByteSwapUnsafeFont(doc, pageIndex, found.target.fontKey);

  const text = decodeShowOpText(op, forward, bytesPerCode, byteSwapSafe);
  return text.length > 0 ? text : null;
}

/**
 * Truly delete the text op nearest to `point` (PDF coords, baseline origin).
 * Also blanks shadow ops within SHADOW_RADIUS of the target to remove outline effects.
 * Returns false when no show op lies within `tolerance`.
 */
export function deleteTextAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  tolerance = 5,
  opts?: { adjustDecorations?: boolean }
): boolean {
  const found = findTarget(doc, pageIndex, point, tolerance);
  if (!found) return false;

  const delPayload = showOpPayload(found.ops[found.target.opIndex]);
  blankShowOp(found.ops[found.target.opIndex]);
  blankAllNearby(found.ops, found.textOps, found.target, found.target.opIndex, delPayload);
  // Remove the orphaned underline/strike rule, if exactly one belongs to this text
  // (matched by its own width — no font metrics needed since we only neutralise it).
  if (opts?.adjustDecorations) removeDecorationForText(found.ops, found.target);
  writeBack(doc, pageIndex, found);
  return true;
}

/**
 * Neutralise (set its fill painter to the no-op `n`) the SINGLE decoration rule that
 * sits under `target`'s baseline, so deleting underlined text doesn't leave a floating
 * rule. Matches each rule using its OWN width as the run extent — exact metrics are
 * unnecessary for removal. Ambiguous (≠1 candidate) → leaves the page unchanged.
 */
function removeDecorationForText(ops: CsOp[], target: TextOpInfo): void {
  const rules = locateDecorationRects(ops);
  const hits = rules.filter(r =>
    // NOTE: passing the rule's OWN width as the run extent makes classifyRuleAsUnderline's
    // overlap test pass trivially, so it would match ANY thin baseline-crossing rule —
    // including a full-width table border / band edge — and neutralise its paint on delete
    // (#bg-fill F1/F2, delete path). We have no text width here, but a genuine underline is
    // ANCHORED at the text's left edge, whereas a page-spanning separator/band starts far
    // left of the text. Require left-edge proximity so we only ever remove THIS text's rule.
    Math.abs(r.x - target.origin.x) <= 0.5 * target.fontSize &&
    classifyRuleAsUnderline(r, { x: target.origin.x, y: target.origin.y, width: r.width, size: target.fontSize })
  );
  if (hits.length !== 1) return;
  const painter = ops[hits[0].painterOpIndex];
  if (painter) {
    painter.operator = 'n';
    painter.operands = [];
  }
}

// ── Phase B: ToUnicode CMap parsing ───────────────────────────────────────────

/** Convert a hex string (without angle brackets) to its integer value. */
function hexToInt(hex: string): number {
  return parseInt(hex, 16);
}

/**
 * Decode a ToUnicode CMap destination hex value into a Unicode string.
 *
 * Per the PDF spec (9.10.3), a bfchar/bfrange dst value is a string of UTF-16BE
 * code units — i.e. 4 hex digits per 16-bit unit, with high+low surrogate pairs
 * combining into a single non-BMP code point. The previous parity heuristic
 * (guess 4 vs 2 from length) mis-decoded ligature and non-BMP values (BUG A3);
 * this decodes strictly as UTF-16BE.
 *
 * A lone/unpaired surrogate (malformed CMap) is skipped rather than emitted as a
 * broken code unit, so the result is always a valid string and never throws.
 */
function cmapHexToUnicodeStr(hex: string): string {
  const clean = hex.replace(/\s+/g, '').toUpperCase();
  let out = '';
  for (let i = 0; i + 4 <= clean.length; i += 4) {
    const unit = parseInt(clean.slice(i, i + 4), 16);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      // High surrogate — needs a following low surrogate to form a code point.
      const lo = i + 8 <= clean.length ? parseInt(clean.slice(i + 4, i + 8), 16) : NaN;
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        const cp = 0x10000 + ((unit - 0xd800) << 10) + (lo - 0xdc00);
        out += String.fromCodePoint(cp);
        i += 4; // consumed the low surrogate too
      }
      // else: lone high surrogate → skip (malformed)
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      // Lone low surrogate → skip (malformed)
    } else {
      out += String.fromCodePoint(unit);
    }
  }
  return out;
}

/**
 * Parse a ToUnicode CMap text into a Map of charCode → Unicode string.
 * Handles beginbfchar/endbfchar and beginbfrange/endbfrange sections.
 */
// Upper bound on entries from one ToUnicode CMap (M0 #2 — file-open DoS/OOM guard).
// Legitimate ToUnicode maps use 1- or 2-byte char codes → at most 65536 distinct
// codes. A crafted CMap can declare a sequential bfrange spanning billions of code
// points; without this bound the parser would allocate billions of Map entries
// (OOM) or throw a RangeError on an out-of-Unicode-range destination.
const MAX_CMAP_ENTRIES = 0x10000;
const MAX_CODE_POINT = 0x10ffff;

export function parseToUnicodeCMap(cmap: string): Map<number, string> {
  const result = new Map<number, string>();

  for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      if (result.size >= MAX_CMAP_ENTRIES) break;
      result.set(hexToInt(m[1]), cmapHexToUnicodeStr(m[2]));
    }
  }

  for (const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = section[1];
    // Array ranges: <from> <to> [<d1> <d2> ...] — already bounded by items.length.
    const processed = body.replace(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]/g,
      (_, from, to, dsts) => {
        const f = hexToInt(from), t = hexToInt(to);
        const items = [...dsts.matchAll(/<([0-9A-Fa-f]+)>/g)];
        for (let i = 0; i <= t - f && i < items.length; i++) {
          if (result.size >= MAX_CMAP_ENTRIES) break;
          result.set(f + i, cmapHexToUnicodeStr(items[i][1]));
        }
        return '';
      }
    );
    // Sequential ranges: <from> <to> <startDst>
    for (const m of processed.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const from = hexToInt(m[1]), to = hexToInt(m[2]), start = hexToInt(m[3]);
      const span = to - from;
      if (!Number.isFinite(span) || span < 0) continue; // inverted / NaN range — ignore
      // Clamp the span to the remaining entry budget.
      const limit = Math.min(span, MAX_CMAP_ENTRIES - result.size - 1);
      for (let i = 0; i <= limit; i++) {
        const cp = start + i;
        if (cp > MAX_CODE_POINT) break; // destination left the Unicode range — stop
        if (!result.has(from + i)) {
          result.set(from + i, String.fromCodePoint(cp));
        }
      }
    }
  }

  return result;
}

/**
 * Detect whether a ToUnicode CMap uses 1-byte or 2-byte char codes.
 * Returns 1 when the codespace range uses single-byte codes (e.g. <20> <FF>),
 * 2 otherwise (the common case for CID/TrueType fonts).
 */
export function detectCMapBytesPerCode(cmap: string): 1 | 2 {
  const m = cmap.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>/);
  return m && m[1].length <= 2 ? 1 : 2;
}

/**
 * Encode `text` as a PDF hex string using the reverse unicode→charCode map.
 * Returns null if any character is missing from the map or text is empty.
 */
export function encodeWithSubset(
  text: string,
  reverseMap: Map<string, number>,
  bytesPerCode: 1 | 2
): string | null {
  if (!text) return null;
  let hex = '<';
  for (const ch of text) {
    const code = reverseMap.get(ch);
    if (code === undefined) return null;
    hex += code.toString(16).padStart(bytesPerCode * 2, '0').toUpperCase();
  }
  return hex + '>';
}

/**
 * Replace the hexstring operand of a show op with a new hex payload.
 * Returns true on success; false when no hexstring operand is found.
 *
 * For a multi-segment TJ array (`[<h1> -50 <h2> …] TJ`) the FULL new payload is
 * written into the first hexstring item and EVERY other hexstring item is
 * blanked to empty `<>` — otherwise the trailing segments keep showing their
 * STALE original glyphs, producing a garbled edit (BUG A2). Kerning numbers are
 * left in place (their effect is cosmetic); losing kerning is acceptable, but
 * leaving stale text is not.
 */
export function replaceShowOpHex(op: CsOp, newHex: string): boolean {
  if (op.operator === 'TJ') {
    const arr = op.operands[0];
    if (!arr || arr.type !== 'array' || !arr.items) return false;
    const hexItems = arr.items.filter(t => t.type === 'hexstring');
    if (hexItems.length === 0) return false;
    // Gap 1 (kerning preservation, Path-2): distribute the new hex code units
    // across the EXISTING hex segments by their original content lengths instead
    // of jamming the whole payload into the first segment. This keeps the
    // per-segment advance widths (and the kerning numbers between them) aligned
    // for equal-length edits; any length delta is absorbed by the last segment.
    // The A2 guarantee still holds: every segment is rewritten, so no stale glyph
    // bytes survive (overflow segments become empty <>). newHex is a multiple of
    // bytesPerCode and so is each original segment, so the slices stay aligned.
    // #QA-2026-06-23 P3 #6: a MALFORMED source segment with ODD hex length would hand
    // a non-last segment an odd-length slice, splitting a 2-byte code across the
    // boundary — round each non-last `take` DOWN to an even count so emitted codes
    // stay whole bytes; the (even) remainder is absorbed by the last segment.
    const inner = newHex.replace(/^</, '').replace(/>$/, '');
    let cursor = 0;
    for (let hi = 0; hi < hexItems.length; hi++) {
      const isLast = hi === hexItems.length - 1;
      const origLen = hexItems[hi].raw.replace(/^</, '').replace(/>$/, '').length;
      let take = isLast ? inner.length - cursor : Math.min(origLen, inner.length - cursor);
      if (!isLast) take -= take % 2; // never split a byte (2 hex chars) across segments
      const slice = take > 0 ? inner.slice(cursor, cursor + take) : '';
      cursor += slice.length;
      hexItems[hi].raw = `<${slice}>`;
    }
    arr.raw = `[${arr.items.map(t => t.raw).join(' ')}]`;
    return true;
  }
  const str = op.operands[op.operands.length - 1];
  if (!str || str.type !== 'hexstring') return false;
  str.raw = newHex;
  return true;
}

// ── Phase B: font matching ─────────────────────────────────────────────────────

/**
 * Select the closest PDF standard font to `baseFontName`/`flags`.
 * Uses PostScript font name substrings and PDF FontDescriptor Flags bits:
 *   bit 0 (0x01) = FixedPitch (monospace)
 *   bit 1 (0x02) = Serif
 *   bit 6 (0x40) = Italic/Oblique
 *   bit 18 (0x40000) = ForceBold
 */
export function matchStandardFont(baseFontName: string, flags: number): StandardFonts {
  const n = baseFontName.toLowerCase();
  const isBold = n.includes('bold') || (flags & 0x40000) !== 0;
  const isItalic = n.includes('italic') || n.includes('oblique') || (flags & 0x40) !== 0;
  const isMono = (flags & 0x01) !== 0 || n.includes('mono') || n.includes('courier') || n.includes('typewriter');
  const isSerif = (flags & 0x02) !== 0 || n.includes('times') || n.includes('georgia') ||
    n.includes('garamond') || n.includes('palatino') || n.includes('serif');

  if (isMono) {
    if (isBold && isItalic) return StandardFonts.CourierBoldOblique;
    if (isBold) return StandardFonts.CourierBold;
    if (isItalic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (isSerif) {
    if (isBold && isItalic) return StandardFonts.TimesRomanBoldItalic;
    if (isBold) return StandardFonts.TimesRomanBold;
    if (isItalic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (isBold && isItalic) return StandardFonts.HelveticaBoldOblique;
  if (isBold) return StandardFonts.HelveticaBold;
  if (isItalic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/**
 * Read the FontDescriptor for a font in a page's resource dict.
 * Returns { flags, name } or null when no descriptor is present.
 */
export function getPageFontDescriptor(
  doc: PDFDocument,
  pageIndex: number,
  fontKey: string
): { flags: number; name: string } | null {
  try {
    const page = doc.getPage(pageIndex);
    const name = fontKey.replace(/^\//, '');
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const resources = doc.context.lookup((page.node as any).Resources()) as any;
    if (!resources?.get) return null;
    const fontDictRaw = resources.get(PDFName.of('Font'));
    if (!fontDictRaw) return null;
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const fontDict = doc.context.lookup(fontDictRaw) as any;
    if (!fontDict?.get) return null;
    const fontEntryRaw = fontDict.get(PDFName.of(name));
    if (!fontEntryRaw) return null;
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const fontEntry = doc.context.lookup(fontEntryRaw) as any;
    if (!fontEntry?.get) return null;
    const descRaw = fontEntry.get(PDFName.of('FontDescriptor'));
    if (!descRaw) return null;
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const desc = doc.context.lookup(descRaw) as any;
    if (!desc?.get) return null;
    const flags = desc.get(PDFName.of('Flags'))?.value() ?? 0;
    const rawName = desc.get(PDFName.of('FontName'))?.toString() ?? '';
    return { flags, name: rawName.replace(/^\//, '') };
  } catch {
    return null;
  }
}

/**
 * Read the raw ToUnicode CMap text for a font in a page's resource dict.
 * Returns null when no ToUnicode stream is present.
 */
export function getPageFontToUnicode(
  doc: PDFDocument,
  pageIndex: number,
  fontKey: string
): string | null {
  try {
    const page = doc.getPage(pageIndex);
    const name = fontKey.replace(/^\//, '');
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const resources = doc.context.lookup((page.node as any).Resources()) as any;
    if (!resources?.get) return null;
    const fontDictRaw = resources.get(PDFName.of('Font'));
    if (!fontDictRaw) return null;
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const fontDict = doc.context.lookup(fontDictRaw) as any;
    if (!fontDict?.get) return null;
    const fontEntryRaw = fontDict.get(PDFName.of(name));
    if (!fontEntryRaw) return null;
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const fontEntry = doc.context.lookup(fontEntryRaw) as any;
    if (!fontEntry?.get) return null;
    const tuRaw = fontEntry.get(PDFName.of('ToUnicode'));
    if (!tuRaw) return null;
    const tuStream = doc.context.lookup(tuRaw);
    if (!(tuStream instanceof PDFRawStream)) return null;
    const bytes = decodePDFRawStream(tuStream).decode();
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  } catch {
    return null;
  }
}

/**
 * Truly replace the text op nearest to `point`.
 *
 * Three-path strategy (Phase B):
 *   1. ASCII literal strings → replace in-place (font/size/color preserved).
 *   2. Hex-encoded strings + ToUnicode CMap → encode with subset, replace in-place
 *      (font/size/color preserved; only works when all glyphs exist in the subset).
 *   3. Fallback → blank + redraw using font-matched standard font (serif/sans/mono
 *      + bold/italic detected from FontDescriptor flags and BaseFont name).
 * Shadow ops within SHADOW_RADIUS are always blanked regardless of path.
 */
export interface TextStyle {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: string;
  color?: { r: number; g: number; b: number };
}

function buildEffectiveFontName(baseName: string, style: TextStyle): string {
  const family = style.fontFamily ?? '';
  const b = style.bold ?? /bold|black|heavy|semibold|demibold/i.test(baseName);
  const i = style.italic ?? /italic|oblique/i.test(baseName);
  const suffix = b && i ? '-BoldItalic' : b ? '-Bold' : i ? '-Italic' : '';
  if (family) return family + suffix;
  return baseName + suffix;
}

function buildEffectiveFlags(baseFlags: number, style: TextStyle): number {
  let f = baseFlags;
  if (style.bold !== undefined) {
    if (style.bold) f |= 0x40000; else f &= ~0x40000;
  }
  if (style.italic !== undefined) {
    if (style.italic) f |= 0x40; else f &= ~0x40;
  }
  return f;
}

/**
 * Change only the font size for the text op nearest `point` (in-stream Tf mutation).
 * Returns false when no op is found, or when the op has no tracked tfOpIndex.
 */
export function changeSizeAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  newSize: number,
  tolerance = 5
): boolean {
  const found = findTarget(doc, pageIndex, point, tolerance);
  if (!found) return false;
  const { ops, target } = found;
  if (target.tfOpIndex === undefined) return false;
  const tfOp = ops[target.tfOpIndex];
  if (!tfOp || tfOp.operator !== 'Tf') return false;
  const sizeToken = tfOp.operands[1];
  if (!sizeToken) return false;
  sizeToken.raw = String(newSize);
  sizeToken.value = newSize;
  writeBack(doc, pageIndex, found);
  return true;
}

function fmtColorComponent(v: number): string {
  const clamped = Math.max(0, Math.min(1, v));
  return clamped.toFixed(4).replace(/\.?0+$/, '') || '0';
}

/**
 * Change only the fill color for the text op nearest `point` (in-stream rg mutation).
 * Returns false when no op is found, or when the op has no tracked colorOpIndex.
 */
export function changeColorAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  color: { r: number; g: number; b: number },
  tolerance = 5
): boolean {
  const found = findTarget(doc, pageIndex, point, tolerance);
  if (!found) return false;
  const { ops, target } = found;
  if (target.colorOpIndex === undefined) return false;
  const colorOp = ops[target.colorOpIndex];
  if (!colorOp) return false;
  const r = fmtColorComponent(color.r);
  const g = fmtColorComponent(color.g);
  const b = fmtColorComponent(color.b);
  colorOp.operator = 'rg';
  colorOp.operands = [
    { type: 'number', raw: r, value: color.r },
    { type: 'number', raw: g, value: color.g },
    { type: 'number', raw: b, value: color.b },
  ];
  writeBack(doc, pageIndex, found);
  return true;
}

/**
 * Build an isolated stroked horizontal line (`q <w> w <r> <g> <b> RG x0 y m x1 y l S Q`)
 * for a standalone underline / strikethrough. Drawn at end-of-stream in its own `q…Q`
 * block so it inherits the default graphics state and never disturbs prior content.
 * Pure → jsdom-unit-testable.
 */
export function buildStandaloneDecoration(p: {
  x0: number;
  x1: number;
  y: number;
  thickness: number;
  color: Rgb;
}): string {
  return (
    `\nq ${fmtNum(p.thickness)} w ` +
    `${fmtNum(p.color.r)} ${fmtNum(p.color.g)} ${fmtNum(p.color.b)} RG ` +
    `${fmtNum(p.x0)} ${fmtNum(p.y)} m ${fmtNum(p.x1)} ${fmtNum(p.y)} l S Q`
  );
}

/**
 * Add a NEW underline / strikethrough to the text op nearest `point`, KEEPING the
 * original text + font (no Path-3 substitution). The decoration is a standalone stroked
 * line appended to the content stream at the text baseline, its width measured in the
 * font's OWN advances (embedded-exact) with a standard-font proxy fallback.
 *
 * Refuses (returns false, leaves the PDF unchanged) when:
 *   - no editable text op is within `tolerance` of `point`;
 *   - the text is `tilted` (rotated / sheared / non-uniformly scaled) — a scalar
 *     axis-aligned line would be mis-placed (the cm-rotation ceiling);
 *   - the text is invisible (render mode 3 / 7 — an OCR layer over a scan);
 *   - the shown text can't be decoded (so its width can't be measured).
 */
export async function addDecorationAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  kind: 'underline' | 'strikethrough',
  tolerance = 5
): Promise<boolean> {
  const found = findTarget(doc, pageIndex, point, tolerance);
  if (!found) return false;
  const { ops, target } = found;
  if (target.tilted) return false;
  if (target.renderMode === 3 || target.renderMode === 7) return false;

  // Decode the shown text so we can measure its rendered width.
  const cmapText = getPageFontToUnicode(doc, pageIndex, target.fontKey);
  const forward = cmapText ? parseToUnicodeCMap(cmapText) : null;
  const bytesPerCode = cmapText ? detectCMapBytesPerCode(cmapText) : 2;
  const byteSwapSafe = !isByteSwapUnsafeFont(doc, pageIndex, target.fontKey);
  const text = decodeShowOpText(ops[target.opIndex], forward, bytesPerCode, byteSwapSafe);
  if (!text) return false;

  const size = target.fontSize || 12;

  // Measure width in the font's OWN advances when available (Path 1/2 keep the embedded
  // font, whose metrics differ from any proxy); else fall back to a standard-font proxy.
  let width: number | null = null;
  const reverseMap = new Map<string, number>();
  if (forward) for (const [code, uni] of forward) if (!reverseMap.has(uni)) reverseMap.set(uni, code);
  const glyphWidths = getPageFontGlyphWidths(doc, pageIndex, target.fontKey);
  if (glyphWidths && reverseMap.size > 0) {
    const w = embeddedTextWidth(text, size, reverseMap, glyphWidths);
    if (w !== null && w > 1e-3) width = w;
  }
  if (width === null) {
    const baseName = getPageFontBaseName(doc, pageIndex, target.fontKey).replace(/^\//, '');
    const flags = getPageFontDescriptor(doc, pageIndex, target.fontKey)?.flags ?? 0;
    try {
      const proxy = await doc.embedFont(matchStandardFont(baseName, flags));
      width = proxy.widthOfTextAtSize(text, size);
    } catch {
      return false; // can't measure → refuse rather than draw a wrong-length line
    }
  }
  if (!(width > 0)) return false;

  const userWidth = width * ((target.hScale ?? 100) / 100);
  const x0 = target.origin.x;
  const x1 = x0 + userWidth;
  // Underline just below the baseline; strikethrough through the glyph body.
  const y = kind === 'underline' ? target.origin.y - size * 0.1 : target.origin.y + size * 0.28;
  const thickness = Math.max(0.4, size * 0.05);
  // Line colour = the text's own fill (else black) so the decoration matches the glyphs.
  const color = resolveRedrawColor(undefined, target.fillColor, undefined);

  const block = buildStandaloneDecoration({ x0, x1, y, thickness, color });
  // F3: no op is mutated (pure append) → buildStreamContent keeps the source verbatim
  // and appends the decoration (fast path B). `block` already starts with '\n'.
  const content = buildStreamContent(found, block);
  if (found.xObjectName) {
    setFormXObjectContent(doc, pageIndex, found.xObjectName, content);
  } else {
    setPageContent(doc, pageIndex, content);
  }
  return true;
}

export async function replaceTextAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  newText: string,
  tolerance = 5,
  style?: TextStyle,
  // Canvas-sampled glyph color, used by the Path-3 redraw ONLY when the
  // in-stream fill can't be resolved (scn/Separation/spot) and no style color
  // was given — stops spot-colored text from being recolored black.
  fallbackColor?: Rgb,
  // When `adjustDecorations` is set, resize the underline/strikethrough rule that
  // belongs to the edited text so it tracks the new text length (#text-decoration).
  opts?: { adjustDecorations?: boolean }
): Promise<false | true | 'substituted'> {
  const found = findTarget(doc, pageIndex, point, tolerance);
  if (!found) return false;

  const { ops, target, textOps } = found;
  // Capture the original shown payload BEFORE any path mutates the op, so the
  // shadow-duplicate match in blankAllNearby compares against the real text (A4).
  const targetPayload = showOpPayload(ops[target.opIndex]);

  // A5: refuse cleanly (no blanking, no redraw) for text that cannot be faithfully
  // re-rendered. Returning false routes the caller to its overlay fallback rather
  // than producing garbage or painting over a scan. Only refuse on clear evidence
  // so normal horizontal visible edits are never blocked.
  //   (a) Type3 fonts — glyphs are content-stream procedures, not byte→glyph.
  //   (b) invisible text (Tr 3 / 7) — OCR layer over a scanned image.
  //   (c) vertical writing mode — a page-space horizontal redraw would misplace it.
  if (
    isType3Font(doc, pageIndex, target.fontKey) ||
    target.renderMode === 3 || target.renderMode === 7 ||
    isVerticalWritingFont(doc, pageIndex, target.fontKey)
  ) {
    return false;
  }

  // Subset / embedded / CID fonts carry only the glyphs the document originally
  // used and map byte codes to them through a custom encoding. Blindly
  // overwriting the bytes with new ASCII (Path 1) renders wrong/blank glyphs and
  // breaks text extraction — the heading "data loss" bug. For such fonts, skip
  // the literal byte-swap and rely on glyph reuse (Path 2) or a standard-font
  // redraw (Path 3).
  const byteSwapUnsafe = isByteSwapUnsafeFont(doc, pageIndex, target.fontKey);

  // F1: Path 1 (literal byte swap) and Path 2 (subset glyph reuse) mutate ONLY the
  // show-op payload — they cannot apply a restyle (bold/italic/family/color/size). When
  // the caller requests one, skip them and force the isolated Path-3 redraw, which DOES
  // apply `style` and emits its own color/font inside a q…Q block (so it never bleeds
  // onto neighbouring text the way an in-place color/Tf rewrite would). No style ⇒
  // Path 1/2 exactly as before (byte-identical).
  const wantsRestyle = !!style && (
    style.bold !== undefined || style.italic !== undefined ||
    style.fontFamily !== undefined || style.color !== undefined ||
    style.fontSize !== undefined
  );

  // Decoration prep (captures the ORIGINAL text width BEFORE Path 1/2 mutate the op);
  // the returned mutator resizes the matched underline/strike rule, applied just
  // before each path's writeBack so it rides the SAME atomic SourcePdf.bytes swap.
  const applyDeco = prepareDecorationResize(doc, pageIndex, found, opts?.adjustDecorations ?? false);

  // Path 1: ASCII literal in-stream replacement (only safe for standard,
  // non-embedded fonts where byte code == ASCII).
  if (!wantsRestyle && !byteSwapUnsafe && replaceShowOpInPlace(ops[target.opIndex], newText)) {
    blankAllNearby(ops, textOps, target, target.opIndex, targetPayload);
    if (applyDeco) await applyDeco(newText, ops);
    writeBack(doc, pageIndex, found);
    return true;
  }

  // Path 2: Subset glyph reuse via ToUnicode CMap.
  const cmapText = getPageFontToUnicode(doc, pageIndex, target.fontKey);
  if (!wantsRestyle && cmapText) {
    const forward = parseToUnicodeCMap(cmapText);
    const bytesPerCode = detectCMapBytesPerCode(cmapText);
    const reverseMap = new Map<string, number>();
    for (const [code, uni] of forward) reverseMap.set(uni, code);
    const hexEncoded = encodeWithSubset(newText, reverseMap, bytesPerCode);
    if (hexEncoded !== null && replaceShowOpHex(ops[target.opIndex], hexEncoded)) {
      blankAllNearby(ops, textOps, target, target.opIndex, targetPayload);
      if (applyDeco) await applyDeco(newText, ops);
      writeBack(doc, pageIndex, found);
      return true;
    }
  }

  // Path 3: Font-matched fallback — blank the original and redraw with the best
  // standard font. The redraw is appended as explicit text operators to the SAME
  // page content stream and written back in a single pass. (Using pdf-lib's
  // page.drawText() here would orphan the redraw: writeBack/setPageContent has
  // already replaced the page /Contents, so pdf-lib's drawText appends to a
  // stream no longer referenced by the page — the new text renders nowhere and
  // is not even text-extractable. Verified on a real CID-font heading.)
  if (found.xObjectName) {
    // The target lives inside a Form XObject (its own coordinate space + subset
    // font). A page-space redraw would misplace it, and re-encoding into the
    // subset font isn't possible. Refuse WITHOUT blanking so the original text is
    // preserved; the caller falls back to an overlay text box. Never delete
    // without a visible replacement.
    return false;
  }

  // Arabic (and other complex scripts) cannot be faithfully redrawn here: the
  // standard Latin fallback font substitutes '?' per codepoint, and pdf-lib
  // drawText performs no contextual shaping or bidi. Path 2 above already handled
  // the faithful case (editing within an existing Arabic subset font); anything
  // reaching here would corrupt. Refuse WITHOUT blanking → the caller's overlay
  // path renders it with an embedded Arabic font + shaping + bidi (Phase C).
  if (isArabicText(newText)) {
    return false;
  }

  // B-3: any other non-WinAnsi text (CJK, Cyrillic, emoji, …) cannot be encoded
  // by the WinAnsi standard-font fallback — it would paint '?' glyphs. Refuse
  // WITHOUT blanking so the original stays; the caller renders it via overlay.
  if (hasNonWinAnsi(newText)) {
    return false;
  }

  // F9: build the redraw (and resize the decoration) BEFORE blanking the original.
  // The standard-font embed/encode can throw for a CP1252-high char whose base-14
  // AFM lacks a width (€/Œ); doing it AFTER blanking would destroy the original with
  // no replacement (silent data loss). On any failure, refuse cleanly (return false →
  // the caller's overlay fallback) with the original op untouched. On success the
  // emitted ops are identical to before — blank + appended redraw — so byte-output and
  // all existing Path-3 guards are unchanged.
  let redraw: string;
  try {
    // Color precedence: style override > parseable in-stream fill > sampled
    // fallback (scn/Separation/spot) > black.
    const { r: cr, g: cg, b: cb } = resolveRedrawColor(style?.color, target.fillColor, fallbackColor);

    // Font: style bold/italic/fontFamily override font detection from PDF.
    const baseName = getPageFontBaseName(doc, pageIndex, target.fontKey).replace(/^\//, '');
    const descriptor = getPageFontDescriptor(doc, pageIndex, target.fontKey);
    const baseFlags = descriptor?.flags ?? 0;
    const effectiveName = style ? buildEffectiveFontName(baseName, style) : baseName;
    const effectiveFlags = style ? buildEffectiveFlags(baseFlags, style) : baseFlags;
    const stdFont = matchStandardFont(effectiveName, effectiveFlags);
    const font = await doc.embedFont(stdFont);
    const resName = addPageFontResource(doc, pageIndex, font.ref);
    const size = style?.fontSize ?? target.fontSize ?? 12;
    // Encode through the embedded font so its (WinAnsi) encoding is honoured —
    // handles accented Latin text, not just pure ASCII.
    const showOperand = font.encodeText(newText).toString();
    // A2: recover the original fill/stroke alpha from the active ExtGState so
    // semi-transparent (watermark/faded) text is not redrawn opaque. Only emit a
    // `gs` when alpha is actually < 1 → opaque/no-gs text stays byte-identical.
    let gsName: string | undefined;
    if (target.extGStateName) {
      const a = lookupExtGStateAlpha(doc, pageIndex, target.extGStateName);
      if ((a.ca !== undefined && a.ca < 1) || (a.CA !== undefined && a.CA < 1)) {
        gsName = addPageExtGStateResource(doc, pageIndex, { ca: a.ca, CA: a.CA });
      }
    }
    redraw = buildPath3Redraw({
      resName, size, color: { r: cr, g: cg, b: cb },
      originX: target.origin.x, originY: target.origin.y, showOperand,
      charSpacing: target.charSpacing, wordSpacing: target.wordSpacing,
      hScale: target.hScale, textRise: target.textRise,
      renderMode: target.renderMode, strokeColor: target.strokeColor,
      lineWidth: target.lineWidth, gsName,
    });
    // Path 3 redraws in a STANDARD font → measure the decoration in the proxy (forceProxy).
    if (applyDeco) await applyDeco(newText, ops, true);
  } catch {
    return false; // overlay fallback — original text untouched
  }

  // Redraw is guaranteed; now it is safe to remove the original.
  blankShowOp(ops[target.opIndex]);
  blankAllNearby(ops, textOps, target, target.opIndex, targetPayload);
  // F3: when only the target op was blanked (no shadow duplicates) the byte-splice
  // preserves the rest of the stream verbatim and appends the redraw; if blankAllNearby
  // touched more ops, buildStreamContent falls back to serializeOps (today's output).
  // `redraw` already starts with '\n'. Path 3 is page-stream only (XObject refused above).
  setPageContent(doc, pageIndex, buildStreamContent(found, redraw));

  // Slice B — honest substitution signal. Path 3 redraws in a base-14 standard
  // font. That is a genuine, lossy substitution ONLY when the ORIGINAL font was
  // non-standard (subset / CID / embedded FontFile / Differences-encoded) — i.e.
  // `byteSwapUnsafe`. When the original is already a plain standard font (e.g. a
  // base-14 Helvetica that merely couldn't be byte-swapped in place, or a
  // bold/italic restyle of one), it is redrawn in the SAME standard family, so
  // there is nothing to warn about → return plain `true`. Path 1/2 also return
  // `true` (original font kept); refuse paths return `false`.
  return byteSwapUnsafe ? 'substituted' : true;
}

/**
 * Build the Path-3 standard-font redraw block: an isolated `q … Q` text object at
 * the original baseline. Re-emits captured graphics state (`Tc`/`Tw`/`Tz`/`Ts`) when
 * present so condensed/spaced/super-subscript text keeps its metrics; omitted state
 * leaves the page defaults. Pure → jsdom-unit-testable.
 */
export function buildPath3Redraw(p: {
  resName: string;
  size: number;
  color: { r: number; g: number; b: number };
  originX: number;
  originY: number;
  showOperand: string;
  charSpacing?: number;
  wordSpacing?: number;
  hScale?: number;
  textRise?: number;
  // Stroked/outline text (F2): re-emit the render mode, stroke color (raw op string,
  // already suffixed with RG/G/K) and line width so a redraw keeps its outline.
  renderMode?: number;
  strokeColor?: string;
  lineWidth?: number;
  // A2: name of an ExtGState resource carrying the original fill/stroke alpha;
  // emitted first so the redraw inherits the same transparency. Absent → opaque.
  gsName?: string;
}): string {
  const state =
    (p.gsName ? `/${p.gsName} gs\n` : '') +
    (p.charSpacing !== undefined ? `${fmtNum(p.charSpacing)} Tc\n` : '') +
    (p.wordSpacing !== undefined ? `${fmtNum(p.wordSpacing)} Tw\n` : '') +
    (p.hScale !== undefined ? `${fmtNum(p.hScale)} Tz\n` : '') +
    (p.textRise !== undefined ? `${fmtNum(p.textRise)} Ts\n` : '') +
    (p.renderMode ? `${p.renderMode} Tr\n` : '') +
    (p.strokeColor !== undefined ? `${p.strokeColor}\n` : '') +
    (p.lineWidth !== undefined ? `${fmtNum(p.lineWidth)} w\n` : '');
  return (
    `\nq\n${fmtNum(p.color.r)} ${fmtNum(p.color.g)} ${fmtNum(p.color.b)} rg\nBT\n` +
    `/${p.resName} ${fmtNum(p.size)} Tf\n` +
    state +
    `1 0 0 1 ${fmtNum(p.originX)} ${fmtNum(p.originY)} Tm\n` +
    `${p.showOperand} Tj\nET\nQ`
  );
}

/**
 * Capture the inputs needed to resize the decoration rule for an edit, returning an
 * async mutator (or null when there is nothing to do). The OLD text is decoded NOW,
 * before Path 1/2 mutate the show op; the proxy font is embedded lazily inside the
 * mutator so a later-refused edit never embeds an unused font. The mutator rewrites
 * the matched `re` op's width operand in place — applied just before writeBack.
 */
function prepareDecorationResize(
  doc: PDFDocument,
  pageIndex: number,
  found: EditTarget,
  adjust: boolean,
): null | ((newText: string, opsArr: CsOp[], forceProxy?: boolean) => Promise<void>) {
  if (!adjust) return null;
  const { ops, target } = found;
  if (locateDecorationRects(ops).length === 0) return null;
  // F13: an unbalanced q/Q (a `Q` popping an empty stack) leaves the CTM stale, so
  // every decoration's user-space geometry on this stream is unreliable. Refuse the
  // resize (the text edit itself does not depend on the CTM-stack balance).
  if (ctmStackUnderflows(ops)) return null;
  // F6: a super/subscript run carries a text rise (Ts); its reported baseline
  // (origin.y, with no rise applied) makes the band-match low-confidence and could
  // match an unrelated nearby rule. Refuse to mutate geometry — leave the rule as-is
  // (safe no-op) rather than resize/erase the wrong one.
  if (target.textRise) return null;
  // F10: a sheared/rotated/non-uniformly-scaled text matrix (textMatrix × CTM) makes the
  // reported baseline + derived font size unreliable, so an axis-aligned decoration rule
  // would be mis-matched/mis-sized. Refuse to touch geometry (the text edit still
  // proceeds). Mirrors the F5 mirror + F6 text-rise gates; reuses the already-set
  // `tilted` flag (locateTextOps) that addDecorationAt already gates on.
  if (target.tilted) return null;
  // Decode the original text now (before any path mutates the op) to measure its width.
  const cmapText = getPageFontToUnicode(doc, pageIndex, target.fontKey);
  const forward = cmapText ? parseToUnicodeCMap(cmapText) : null;
  const bytesPerCode = cmapText ? detectCMapBytesPerCode(cmapText) : 2;
  const byteSwapSafe = !isByteSwapUnsafeFont(doc, pageIndex, target.fontKey);
  const oldText = decodeShowOpText(ops[target.opIndex], forward, bytesPerCode, byteSwapSafe);
  if (!oldText) return null;

  // Reverse the ToUnicode map (unicode→code) so we can measure with the font's OWN
  // glyph advances — exact for the embedded font Path 1/2 keep, unlike a proxy whose
  // per-glyph metrics differ (the trailing-underline bug). Scoped to fonts carrying a
  // ToUnicode map; without one (e.g. base-14 Helvetica) we keep the proxy estimate.
  const reverseMap = new Map<string, number>();
  if (forward) for (const [code, uni] of forward) if (!reverseMap.has(uni)) reverseMap.set(uni, code);
  const glyphWidths = getPageFontGlyphWidths(doc, pageIndex, target.fontKey);

  // forceProxy: Path 3 redraws the text in a STANDARD font, so the proxy IS the render
  // font there and embedded advances would be wrong. Path 1/2 keep the embedded font.
  return async (newText, opsArr, forceProxy = false) => {
    const rules = locateDecorationRects(opsArr);
    if (rules.length === 0) return;
    const size = target.fontSize || 12;
    let oldW: number | undefined, newW: number | undefined;
    if (!forceProxy && glyphWidths && reverseMap.size > 0) {
      const eo = embeddedTextWidth(oldText, size, reverseMap, glyphWidths);
      const en = embeddedTextWidth(newText, size, reverseMap, glyphWidths);
      if (eo !== null && en !== null && eo > 1e-3) {
        oldW = eo;
        newW = en;
      }
    }
    if (oldW === undefined || newW === undefined) {
      // Fallback: proxy standard font (exact for Path 3's redraw; an approximation for
      // an embedded font whose metrics differ, but better than leaving the rule frozen).
      const baseName = getPageFontBaseName(doc, pageIndex, target.fontKey).replace(/^\//, '');
      const flags = getPageFontDescriptor(doc, pageIndex, target.fontKey)?.flags ?? 0;
      const proxy = await doc.embedFont(matchStandardFont(baseName, flags));
      try {
        oldW = proxy.widthOfTextAtSize(oldText, size);
        newW = proxy.widthOfTextAtSize(newText, size);
      } catch {
        return; // proxy can't encode the text → leave the decoration unchanged
      }
    }
    const match = matchDecorationForText(rules, target, oldW);
    if (!match) return;
    // forceProxy ⇒ Path 3 redrew the WHOLE run in the proxy/standard font, starting at
    // the original left edge, so the underline must span the REDRAWN width — anchor to
    // the measured new width directly (× the Tz horizontal scale that the redraw also
    // applies). Scaling R_old by the ratio OVERSHOOTS here: R_old came from the ORIGINAL
    // EMBEDDED font (R_old ≠ proxyWidth(oldText)), so R_old × proxyNew/proxyOld ≠ proxyNew
    // — the real-file trailing-underline bug on no-ToUnicode CID fonts. Path 1/2 keep the
    // embedded font (R_old = embedded oldW), where the ratio is correct, so leave them be.
    const newUserWidth = forceProxy
      ? newW * ((target.hScale ?? 100) / 100)
      : adjustedRuleWidth(match.rule.width, oldW, newW);
    if (newUserWidth === null) return;
    // Local segment length = user-space width divided out by the CTM x-scale.
    const newLocalWidth = newUserWidth / (match.rule.ctmScaleX || 1);
    if (match.rule.kind === 'rect') {
      const reOp = opsArr[match.rule.reOpIndex];
      const tok = reOp?.operands[match.rule.widthOperandIndex];
      if (reOp?.operator === 're' && tok) {
        tok.value = newLocalWidth;
        tok.raw = fmtNum(newLocalWidth);
      }
    } else {
      // Stroked line: move the `l` endpoint x relative to the fixed `m` anchor,
      // preserving the original draw direction (left→right or right→left).
      const lOp = opsArr[match.rule.lineOpIndex];
      const tok = lOp?.operands[match.rule.endpointOperandIndex];
      if (lOp?.operator === 'l' && tok) {
        const curEnd = tok.value ?? match.rule.anchorLocalX;
        const dir = Math.sign(curEnd - match.rule.anchorLocalX) || 1;
        const newEnd = match.rule.anchorLocalX + dir * newLocalWidth;
        tok.value = newEnd;
        tok.raw = fmtNum(newEnd);
      }
    }
  };
}

/** Format a number for a content stream (trim noise, no exponent). */
function fmtNum(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

/** A subset font has a 6-uppercase-letter tag prefix, e.g. "ABCDEF+Arial". */
export function isSubsetFontName(baseName: string): boolean {
  return /^[A-Z]{6}\+/.test(baseName.replace(/^\//, ''));
}

/** Resolve a page's font resource entry dict for a given font key. */
function getPageFontEntry(doc: PDFDocument, pageIndex: number, fontKey: string): PDFDict | null {
  try {
    const page = doc.getPage(pageIndex);
    const name = fontKey.replace(/^\//, '');
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const resources = doc.context.lookup((page.node as any).Resources()) as any;
    if (!resources?.get) return null;
    const fontDictRaw = resources.get(PDFName.of('Font'));
    if (!fontDictRaw) return null;
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const fontDict = doc.context.lookup(fontDictRaw) as any;
    if (!fontDict?.get) return null;
    const entryRaw = fontDict.get(PDFName.of(name));
    if (!entryRaw) return null;
    return doc.context.lookup(entryRaw) as PDFDict;
  } catch {
    return null;
  }
}

// oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
function descriptorHasFontFile(desc: any): boolean {
  if (!desc?.get) return false;
  return ['FontFile', 'FontFile2', 'FontFile3'].some(k => !!desc.get(PDFName.of(k)));
}

/** A glyph-advance table for a page font, keyed by show-op code (glyph code unit). */
export interface GlyphWidths {
  /** Advance width in 1000-unit glyph space; falls back to the font default. */
  get(code: number): number;
}

/**
 * Read a page font's OWN glyph advances so the decoration resize can measure text in
 * the font that actually renders it — Path 1/2 keep the embedded font, whose metrics
 * (e.g. tabular digits ~25% wider than Helvetica) differ from any proxy standard font.
 * Using a proxy ratio mis-sizes the underline whenever an edit changes the character
 * mix (the trailing-underline bug). Returns null when no usable width table exists
 * (e.g. base-14 fonts with no /Widths → the proxy IS exact there) or for a non-Identity
 * CID encoding (where the show code is not the CID our /W table is keyed by).
 *   • Type0/CID: DescendantFonts[0] /W (+ /DW default 1000), Identity-H/V only.
 *   • Simple font: /Widths indexed by (code − /FirstChar).
 */
export function getPageFontGlyphWidths(doc: PDFDocument, pageIndex: number, fontKey: string): GlyphWidths | null {
  const entry = getPageFontEntry(doc, pageIndex, fontKey);
  if (!entry?.get) return null;
  const ctx = doc.context;
  try {
    const subtype = entry.get(PDFName.of('Subtype'))?.toString() ?? '';
    if (subtype.includes('Type0')) {
      // Only Identity encodings guarantee show-code == CID (the /W key).
      const enc = entry.get(PDFName.of('Encoding'))?.toString() ?? '';
      if (!/Identity/.test(enc)) return null;
      // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib dicts are untyped
      const desc = ctx.lookup(entry.get(PDFName.of('DescendantFonts'))) as any;
      const d0 = desc?.get ? ctx.lookup(desc.get(0)) : null;
      // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib dicts are untyped
      const cid = d0 as any;
      if (!cid?.get) return null;
      const dwRaw = ctx.lookup(cid.get(PDFName.of('DW')));
      const defaultW = dwRaw instanceof PDFNumber ? dwRaw.asNumber() : 1000;
      const map = parseCidWArray(ctx, ctx.lookup(cid.get(PDFName.of('W'))));
      if (!map) return null;
      return { get: code => map.get(code) ?? defaultW };
    }
    // Simple font: /Widths array indexed by char code − /FirstChar.
    const widthsRaw = ctx.lookup(entry.get(PDFName.of('Widths')));
    const firstRaw = ctx.lookup(entry.get(PDFName.of('FirstChar')));
    if (!(widthsRaw instanceof PDFArray) || !(firstRaw instanceof PDFNumber)) return null;
    const first = firstRaw.asNumber();
    const arr = widthsRaw.asArray();
    const map = new Map<number, number>();
    for (let i = 0; i < arr.length; i++) {
      const w = ctx.lookup(arr[i]);
      if (w instanceof PDFNumber) map.set(first + i, w.asNumber());
    }
    return map.size > 0 ? { get: code => map.get(code) ?? 0 } : null;
  } catch {
    return null;
  }
}

/** Parse a CIDFont /W array (both `c [w …]` and `cFirst cLast w` forms) → CID→width map. */
function parseCidWArray(ctx: PDFDocument['context'], W: unknown): Map<number, number> | null {
  if (!(W instanceof PDFArray)) return null;
  const arr = W.asArray();
  const map = new Map<number, number>();
  let i = 0;
  while (i < arr.length) {
    const a = ctx.lookup(arr[i]);
    const next = ctx.lookup(arr[i + 1]);
    if (!(a instanceof PDFNumber)) break;
    if (next instanceof PDFArray) {
      const cFirst = a.asNumber();
      const ws = next.asArray();
      for (let j = 0; j < ws.length; j++) {
        const w = ctx.lookup(ws[j]);
        if (w instanceof PDFNumber) map.set(cFirst + j, w.asNumber());
      }
      i += 2;
    } else if (next instanceof PDFNumber) {
      const w = ctx.lookup(arr[i + 2]);
      if (w instanceof PDFNumber) for (let c = a.asNumber(); c <= next.asNumber(); c++) map.set(c, w.asNumber());
      i += 3;
    } else {
      break;
    }
  }
  return map.size > 0 ? map : null;
}

/**
 * Sum of glyph advances for `text` in text-space units at `size`, using a font's OWN
 * width table. Each char is mapped to its show code via `reverseMap` (unicode→code,
 * the same map Path 2 uses to re-encode). Returns null if any char is unmapped — the
 * caller then falls back to the proxy-font estimate. Pure.
 */
export function embeddedTextWidth(
  text: string,
  size: number,
  reverseMap: Map<string, number>,
  widths: GlyphWidths,
): number | null {
  let total = 0;
  for (const ch of text) {
    const code = reverseMap.get(ch);
    if (code === undefined) return null;
    total += widths.get(code);
  }
  return (total / 1000) * size;
}

/**
 * Whether overwriting a show op's bytes with new ASCII (the literal in-place
 * edit) would corrupt the glyphs. True for fonts that don't guarantee a plain
 * byte→ASCII mapping: subset-tagged fonts, CID/Type0 fonts, and any font with an
 * embedded program (its encoding may remap byte codes to arbitrary glyphs).
 * Such fonts must be edited via glyph reuse or a standard-font redraw instead.
 */
export function isByteSwapUnsafeFont(doc: PDFDocument, pageIndex: number, fontKey: string): boolean {
  if (isSubsetFontName(getPageFontBaseName(doc, pageIndex, fontKey))) return true;
  const entry = getPageFontEntry(doc, pageIndex, fontKey);
  if (!entry?.get) return false;
  const subtype = entry.get(PDFName.of('Subtype'))?.toString() ?? '';
  if (subtype.includes('Type0')) return true; // CID fonts never use plain byte=ASCII
  // F14: a non-standard byte→glyph map (`/Encoding << /Differences […] >>`) means the
  // byte code is NOT plain ASCII even WITHOUT an embedded program — e.g. a simple
  // TrueType/Type1 font relying on a system font but remapping codes via Differences.
  // Path-1 byte-swap assumes byte==ASCII and would paint the wrong glyphs for remapped
  // codes, so treat any Differences-bearing encoding as byte-swap-unsafe.
  const enc = doc.context.lookup(entry.get(PDFName.of('Encoding')));
  if (enc instanceof PDFDict && enc.get(PDFName.of('Differences'))) return true;
  // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
  const topDesc = doc.context.lookup(entry.get(PDFName.of('FontDescriptor'))) as any;
  if (descriptorHasFontFile(topDesc)) return true;
  // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
  const descendants = doc.context.lookup(entry.get(PDFName.of('DescendantFonts'))) as any;
  if (descendants?.get) {
    const d0 = doc.context.lookup(descendants.get(0));
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const dDesc = doc.context.lookup((d0 as any)?.get?.(PDFName.of('FontDescriptor'))) as any;
    if (descriptorHasFontFile(dDesc)) return true;
  }
  return false;
}

/**
 * Whether a font is a Type3 font. Type3 fonts define glyphs as content-stream
 * procedures (CharProcs) rather than a byte→glyph encoding, so neither a literal
 * byte-swap nor a standard-font redraw can faithfully edit them — the engine
 * must refuse a true edit and let the caller fall back to an overlay (A5).
 */
export function isType3Font(doc: PDFDocument, pageIndex: number, fontKey: string): boolean {
  const entry = getPageFontEntry(doc, pageIndex, fontKey);
  if (!entry?.get) return false;
  return (entry.get(PDFName.of('Subtype'))?.toString() ?? '') === '/Type3';
}

/**
 * Whether a font uses vertical writing mode (WMode 1). Detected from a Type0
 * font's /Encoding when it is a predefined vertical CMap name (ends in `-V`,
 * e.g. Identity-V, GBK-EUC-V). A page-space horizontal redraw would misplace
 * vertical text, so such ops are refused (A5). Conservative: only true on clear
 * evidence (a named vertical CMap); embedded-stream CMaps are not inspected.
 */
export function isVerticalWritingFont(doc: PDFDocument, pageIndex: number, fontKey: string): boolean {
  const entry = getPageFontEntry(doc, pageIndex, fontKey);
  if (!entry?.get) return false;
  if ((entry.get(PDFName.of('Subtype'))?.toString() ?? '') !== '/Type0') return false;
  const enc = entry.get(PDFName.of('Encoding'));
  if (!enc) return false;
  // A name encoding serializes as "/Identity-V"; a stream CMap won't match.
  return /-V$/.test(enc.toString());
}

/**
 * Add a font ref to a page's /Resources/Font dict under a fresh name, creating
 * the Resources and Font dicts if absent. Returns the resource name (no slash).
 */
function addPageFontResource(doc: PDFDocument, pageIndex: number, fontRef: PDFRef): string {
  const node = doc.getPage(pageIndex).node;
  const resources = node.get(PDFName.of('Resources'));
  let resDict: PDFDict;
  if (resources) {
    resDict = doc.context.lookup(resources) as PDFDict;
  } else {
    resDict = PDFDict.fromMapWithContext(new Map(), doc.context);
    node.set(PDFName.of('Resources'), resDict);
  }
  const fontRaw = resDict.get(PDFName.of('Font'));
  let fontDict: PDFDict;
  if (fontRaw) {
    fontDict = doc.context.lookup(fontRaw) as PDFDict;
  } else {
    fontDict = PDFDict.fromMapWithContext(new Map(), doc.context);
    resDict.set(PDFName.of('Font'), fontDict);
  }
  let i = 0;
  let name = `GSEdit${i}`;
  while (fontDict.get(PDFName.of(name))) name = `GSEdit${++i}`;
  fontDict.set(PDFName.of(name), fontRef);
  return name;
}

/**
 * A2 — add (or reuse) a page `/ExtGState` resource holding fill/stroke alpha and
 * return its name. Mirrors {@link addPageFontResource}'s resource-dict insertion so a
 * Path-3 redraw can re-apply the original text's transparency via `/<name> gs`.
 */
export function addPageExtGStateResource(
  doc: PDFDocument, pageIndex: number, alpha: { ca?: number; CA?: number },
): string {
  const node = doc.getPage(pageIndex).node;
  const resources = node.get(PDFName.of('Resources'));
  let resDict: PDFDict;
  if (resources) {
    resDict = doc.context.lookup(resources) as PDFDict;
  } else {
    resDict = PDFDict.fromMapWithContext(new Map(), doc.context);
    node.set(PDFName.of('Resources'), resDict);
  }
  const egRaw = resDict.get(PDFName.of('ExtGState'));
  let egDict: PDFDict;
  if (egRaw) {
    egDict = doc.context.lookup(egRaw) as PDFDict;
  } else {
    egDict = PDFDict.fromMapWithContext(new Map(), doc.context);
    resDict.set(PDFName.of('ExtGState'), egDict);
  }
  let i = 0;
  let name = `GSAlpha${i}`;
  while (egDict.get(PDFName.of(name))) name = `GSAlpha${++i}`;
  const gs = PDFDict.fromMapWithContext(new Map(), doc.context);
  if (alpha.ca !== undefined) gs.set(PDFName.of('ca'), doc.context.obj(alpha.ca));
  if (alpha.CA !== undefined) gs.set(PDFName.of('CA'), doc.context.obj(alpha.CA));
  egDict.set(PDFName.of(name), gs);
  return name;
}

/**
 * A2 — read the fill (`ca`) / stroke (`CA`) alpha from a page's named ExtGState
 * resource. Returns `{}` on any miss (no resource, no such name, no alpha keys) so
 * the caller treats it as fully opaque. Pure read; never throws.
 */
export function lookupExtGStateAlpha(
  doc: PDFDocument, pageIndex: number, name: string,
): { ca?: number; CA?: number } {
  try {
    const node = doc.getPage(pageIndex).node;
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib dict internals are untyped here
    const resources = doc.context.lookup(node.get(PDFName.of('Resources'))) as any;
    if (!resources?.get) return {};
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib dict internals are untyped here
    const egDict = doc.context.lookup(resources.get(PDFName.of('ExtGState'))) as any;
    if (!egDict?.get) return {};
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib dict internals are untyped here
    const gs = doc.context.lookup(egDict.get(PDFName.of(name))) as any;
    if (!gs?.get) return {};
    const out: { ca?: number; CA?: number } = {};
    const ca = gs.get(PDFName.of('ca'))?.value?.();
    const CA = gs.get(PDFName.of('CA'))?.value?.();
    if (typeof ca === 'number') out.ca = ca;
    if (typeof CA === 'number') out.CA = CA;
    return out;
  } catch {
    return {};
  }
}

/**
 * Look up the /BaseFont name for a font resource in a page's /Resources/Font dict.
 * The BaseFont name (e.g. "/ABCDEF+MyriadPro-Bold") often contains the real font name
 * even when pdfjs assigns an opaque internal id. Returns empty string on any failure.
 */
export function getPageFontBaseName(doc: PDFDocument, pageIndex: number, fontKey: string): string {
  try {
    const page = doc.getPage(pageIndex);
    const name = fontKey.replace(/^\//, '');
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const resources = doc.context.lookup((page.node as any).Resources()) as any;
    if (!resources?.get) return '';
    const fontDictRaw = resources.get(PDFName.of('Font'));
    if (!fontDictRaw) return '';
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const fontDict = doc.context.lookup(fontDictRaw) as any;
    if (!fontDict?.get) return '';
    const fontEntryRaw = fontDict.get(PDFName.of(name));
    if (!fontEntryRaw) return '';
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const fontEntry = doc.context.lookup(fontEntryRaw) as any;
    if (!fontEntry?.get) return '';
    return fontEntry.get(PDFName.of('BaseFont'))?.toString() ?? '';
  } catch {
    return '';
  }
}

// ── Phase C: page rotation + XObject-aware location ───────────────────────────

/**
 * Return the page rotation in degrees (0 / 90 / 180 / 270).
 * Returns 0 on any error or for pages without an explicit /Rotate entry.
 */
export function getPageRotation(doc: PDFDocument, pageIndex: number): 0 | 90 | 180 | 270 {
  try {
    const page = doc.getPage(pageIndex);
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    if (angle === 90 || angle === 180 || angle === 270) return angle;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Decode a Form XObject's content stream.
 * Returns null when the name doesn't resolve to a Form XObject on the page.
 */
function getFormXObjectContent(
  doc: PDFDocument,
  pageIndex: number,
  xobjName: string
): string | null {
  try {
    const page = doc.getPage(pageIndex);
    const name = xobjName.replace(/^\//, '');
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const resources = doc.context.lookup((page.node as any).Resources()) as any;
    if (!resources?.get) return null;
    const xobjDictRaw = resources.get(PDFName.of('XObject'));
    if (!xobjDictRaw) return null;
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const xobjDict = doc.context.lookup(xobjDictRaw) as any;
    if (!xobjDict?.get) return null;
    const streamRef = xobjDict.get(PDFName.of(name));
    if (!streamRef) return null;
    const stream = doc.context.lookup(streamRef);
    if (!(stream instanceof PDFRawStream)) return null;
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const subtype = (stream.dict as any).get(PDFName.of('Subtype'));
    if (subtype?.toString() !== '/Form') return null;
    const bytes = decodePDFRawStream(stream).decode();
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  } catch {
    return null;
  }
}

/**
 * Read the /Matrix entry of a Form XObject (the 6-element transform array).
 * Returns the identity matrix when no /Matrix entry is present.
 */
function getFormXObjectMatrix(
  doc: PDFDocument,
  pageIndex: number,
  xobjName: string
): Matrix {
  try {
    const page = doc.getPage(pageIndex);
    const name = xobjName.replace(/^\//, '');
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const resources = doc.context.lookup((page.node as any).Resources()) as any;
    if (!resources?.get) return [...IDENTITY];
    const xobjDictRaw = resources.get(PDFName.of('XObject'));
    if (!xobjDictRaw) return [...IDENTITY];
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const xobjDict = doc.context.lookup(xobjDictRaw) as any;
    if (!xobjDict?.get) return [...IDENTITY];
    const streamRef = xobjDict.get(PDFName.of(name));
    if (!streamRef) return [...IDENTITY];
    const stream = doc.context.lookup(streamRef);
    if (!(stream instanceof PDFRawStream)) return [...IDENTITY];
    // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib internals (PDFDocument/PDFRef/dict objects) are untyped here
    const matrixVal = (stream.dict as any).get(PDFName.of('Matrix'));
    if (!matrixVal) return [...IDENTITY];
    const arr = doc.context.lookup(matrixVal);
    if (!(arr instanceof PDFArray)) return [...IDENTITY];
    const vals = [0,1,2,3,4,5].map(i => {
      const item = arr.get(i);
      return (item as { value?: () => number }).value?.() ?? (i === 0 || i === 3 ? 1 : 0);
    });
    return vals as Matrix;
  } catch {
    return [...IDENTITY];
  }
}

/**
 * Locate all text ops in a page including those inside Form XObjects.
 * XObject-sourced ops are flagged with `inXObject: true`.
 * XObject ops have opIndex = -1 (they cannot be directly edited via the page stream).
 */
export function locatePageTextOps(
  doc: PDFDocument,
  pageIndex: number
): TextOpInfo[] {
  const content = getPageContent(doc, pageIndex);
  if (!content) return [];

  const directOps = groupOps(tokenizeContentStream(content));
  const result: TextOpInfo[] = locateTextOps(directOps);

  // Recurse into Form XObjects (depth-limited to 5)
  function recurse(xOps: ReturnType<typeof groupOps>, depth: number): TextOpInfo[] {
    if (depth >= 5) return [];
    const xResults: TextOpInfo[] = [];
    for (const op of xOps) {
      if (op.operator !== 'Do') continue;
      const xobjName = op.operands[0]?.raw ?? '';
      if (!xobjName) continue;
      const xContent = getFormXObjectContent(doc, pageIndex, xobjName);
      if (!xContent) continue;
      const xMatrix = getFormXObjectMatrix(doc, pageIndex, xobjName);
      const innerOps = groupOps(tokenizeContentStream(xContent));
      const innerInfos = locateTextOps(innerOps);
      for (const info of innerInfos) {
        const transformed = applyMatrixToPoint(xMatrix, info.origin.x, info.origin.y);
        xResults.push({ ...info, origin: transformed, opIndex: -1, inXObject: true });
      }
      xResults.push(...recurse(innerOps, depth + 1));
    }
    return xResults;
  }

  result.push(...recurse(directOps, 0));
  return result;
}
