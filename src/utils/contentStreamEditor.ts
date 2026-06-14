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
  PDFRawStream,
  PDFRef,
  StandardFonts,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';

import type { CsToken, CsOp, TextOpInfo } from '../types/contentStream';
export type { CsToken, CsOp, TextOpInfo } from '../types/contentStream';

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
export function tokenizeContentStream(src: string): CsToken[] {
  const tokens: CsToken[] = [];
  let i = 0;

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
      tokens.push({ type: 'comment', raw: src.slice(start, i) });
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'string', raw: readLiteralString() });
      continue;
    }

    if (ch === '<') {
      if (src[i + 1] === '<') {
        tokens.push({ type: 'dict', raw: readUntilBalanced('<<', '>>') });
      } else {
        const start = i;
        while (i < src.length && src[i] !== '>') i++;
        i++; // consume '>'
        tokens.push({ type: 'hexstring', raw: src.slice(start, i) });
      }
      continue;
    }

    if (ch === '[') {
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
      });
      continue;
    }

    if (ch === '/') {
      const start = i;
      i++;
      while (i < src.length && isRegular(src[i])) i++;
      tokens.push({ type: 'name', raw: src.slice(start, i) });
      continue;
    }

    if (/[0-9+\-.]/.test(ch)) {
      const start = i;
      i++;
      while (i < src.length && /[0-9.]/.test(src[i])) i++;
      const raw = src.slice(start, i);
      tokens.push({ type: 'number', raw, value: parseFloat(raw) });
      continue;
    }

    // Regular-character run → operator (or inline image)
    const start = i;
    while (i < src.length && isRegular(src[i])) i++;
    const word = src.slice(start, i);
    if (word === 'BI') {
      // Inline image: pass through raw up to and including 'EI'
      const eiIdx = src.indexOf('EI', i);
      const end = eiIdx === -1 ? src.length : eiIdx + 2;
      tokens.push({ type: 'inline-image', raw: src.slice(start, end) });
      i = end;
    } else {
      tokens.push({ type: 'operator', raw: word });
    }
  }

  // Inner single-token parser used by array parsing (shares `i` via closure)
  function tokenizeOne(): CsToken | null {
    const c = src[i];
    if (c === '(') return { type: 'string', raw: readLiteralString() };
    if (c === '<') {
      const start = i;
      while (i < src.length && src[i] !== '>') i++;
      i++;
      return { type: 'hexstring', raw: src.slice(start, i) };
    }
    if (c === '/') {
      const start = i;
      i++;
      while (i < src.length && isRegular(src[i])) i++;
      return { type: 'name', raw: src.slice(start, i) };
    }
    if (/[0-9+\-.]/.test(c)) {
      const start = i;
      i++;
      while (i < src.length && /[0-9.]/.test(src[i])) i++;
      const raw = src.slice(start, i);
      return { type: 'number', raw, value: parseFloat(raw) };
    }
    // operator-like word inside an array (rare) — consume to stay safe
    const start = i;
    i++;
    while (i < src.length && isRegular(src[i])) i++;
    return { type: 'operator', raw: src.slice(start, i) };
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
  for (const tok of tokens) {
    if (tok.type === 'operator') {
      ops.push({ operator: tok.raw, operands });
      operands = [];
    } else if (tok.type === 'inline-image') {
      ops.push({ operator: 'INLINE_IMAGE', operands: [tok] });
      operands = [];
    } else if (tok.type !== 'comment') {
      operands.push(tok);
    }
  }
  return ops;
}

/** Serialize a grouped ops list back to a content stream string. */
export function serializeOps(ops: CsOp[]): string {
  return ops
    .map(op =>
      op.operator === 'INLINE_IMAGE'
        ? op.operands[0].raw
        : [...op.operands.map(t => t.raw), op.operator].join(' ')
    )
    .join('\n');
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
  let fillColor: string | undefined;
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
      default:
        break;
    }

    if (SHOW_OPS.has(op.operator)) {
      if (op.operator === "'" || op.operator === '"') {
        lineMatrix = translateMatrix(0, -leading, lineMatrix);
        textMatrix = [...lineMatrix];
      }
      const vScale = Math.hypot(textMatrix[2], textMatrix[3]) || 1;
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
      });
    }
  });

  return found;
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

interface Rgb { r: number; g: number; b: number }

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

/** Replace the page's Contents with a single new uncompressed stream. */
function setPageContent(doc: PDFDocument, pageIndex: number, content: string): void {
  const page = doc.getPage(pageIndex);
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xff;
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

    const bytes = new Uint8Array(content.length);
    for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xff;

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
}

/** Write modified ops back to either the page stream or an XObject stream. */
function writeBack(doc: PDFDocument, pageIndex: number, found: EditTarget): void {
  const content = serializeOps(found.ops);
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
    const dist = Math.hypot(t.origin.x - point.x, t.origin.y - point.y);
    if (dist <= tolerance && dist < bestDist) { bestDist = dist; best = t; }
  }
  if (best) return { ops: pageOps, target: best, textOps: directTextOps };

  // Fall back: search Form XObjects referenced by Do operators in the page stream.
  interface XCandidate { dist: number; target: TextOpInfo; ops: CsOp[]; textOps: TextOpInfo[]; xObjectName: string }
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
      const ps = applyMatrixToPoint(xMatrix, t.origin.x, t.origin.y);
      const dist = Math.hypot(ps.x - point.x, ps.y - point.y);
      if (dist <= tolerance && dist < (bestX?.dist ?? Infinity)) {
        // Flag the target as XObject-sourced so callers (textEditHandler) can
        // treat it as not-truly-editable and fall back to an overlay (A1).
        bestX = { dist, target: { ...t, inXObject: true }, ops: xOps, textOps: xTextOps, xObjectName: raw.replace(/^\//, '') };
      }
    }
  }
  if (bestX) return { ops: bestX.ops, target: bestX.target, textOps: bestX.textOps, xObjectName: bestX.xObjectName };

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
 * Truly delete the text op nearest to `point` (PDF coords, baseline origin).
 * Also blanks shadow ops within SHADOW_RADIUS of the target to remove outline effects.
 * Returns false when no show op lies within `tolerance`.
 */
export function deleteTextAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  tolerance = 5
): boolean {
  const found = findTarget(doc, pageIndex, point, tolerance);
  if (!found) return false;

  const delPayload = showOpPayload(found.ops[found.target.opIndex]);
  blankShowOp(found.ops[found.target.opIndex]);
  blankAllNearby(found.ops, found.textOps, found.target, found.target.opIndex, delPayload);
  writeBack(doc, pageIndex, found);
  return true;
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
export function parseToUnicodeCMap(cmap: string): Map<number, string> {
  const result = new Map<number, string>();

  for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      result.set(hexToInt(m[1]), cmapHexToUnicodeStr(m[2]));
    }
  }

  for (const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = section[1];
    // Array ranges: <from> <to> [<d1> <d2> ...]
    const processed = body.replace(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]/g,
      (_, from, to, dsts) => {
        const f = hexToInt(from), t = hexToInt(to);
        const items = [...dsts.matchAll(/<([0-9A-Fa-f]+)>/g)];
        for (let i = 0; i <= t - f && i < items.length; i++) {
          result.set(f + i, cmapHexToUnicodeStr(items[i][1]));
        }
        return '';
      }
    );
    // Sequential ranges: <from> <to> <startDst>
    for (const m of processed.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const from = hexToInt(m[1]), to = hexToInt(m[2]), start = hexToInt(m[3]);
      for (let i = 0; i <= to - from; i++) {
        if (!result.has(from + i)) {
          result.set(from + i, String.fromCodePoint(start + i));
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
    const inner = newHex.replace(/^</, '').replace(/>$/, '');
    let cursor = 0;
    for (let hi = 0; hi < hexItems.length; hi++) {
      const isLast = hi === hexItems.length - 1;
      const origLen = hexItems[hi].raw.replace(/^</, '').replace(/>$/, '').length;
      const take = isLast ? inner.length - cursor : Math.min(origLen, inner.length - cursor);
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

export async function replaceTextAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  newText: string,
  tolerance = 5,
  style?: TextStyle
): Promise<boolean> {
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

  // Path 1: ASCII literal in-stream replacement (only safe for standard,
  // non-embedded fonts where byte code == ASCII).
  if (!byteSwapUnsafe && replaceShowOpInPlace(ops[target.opIndex], newText)) {
    blankAllNearby(ops, textOps, target, target.opIndex, targetPayload);
    writeBack(doc, pageIndex, found);
    return true;
  }

  // Path 2: Subset glyph reuse via ToUnicode CMap.
  const cmapText = getPageFontToUnicode(doc, pageIndex, target.fontKey);
  if (cmapText) {
    const forward = parseToUnicodeCMap(cmapText);
    const bytesPerCode = detectCMapBytesPerCode(cmapText);
    const reverseMap = new Map<string, number>();
    for (const [code, uni] of forward) reverseMap.set(uni, code);
    const hexEncoded = encodeWithSubset(newText, reverseMap, bytesPerCode);
    if (hexEncoded !== null && replaceShowOpHex(ops[target.opIndex], hexEncoded)) {
      blankAllNearby(ops, textOps, target, target.opIndex, targetPayload);
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

  blankShowOp(ops[target.opIndex]);
  blankAllNearby(ops, textOps, target, target.opIndex, targetPayload);

  // Color: explicit style overrides detected fill color (default black).
  let cr = 0, cg = 0, cb = 0;
  if (style?.color) {
    ({ r: cr, g: cg, b: cb } = style.color);
  } else if (target.fillColor) {
    const c = parseFillColorToRgb(target.fillColor);
    if (c) ({ r: cr, g: cg, b: cb } = c);
  }

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
  const redraw =
    `\nq\n${fmtNum(cr)} ${fmtNum(cg)} ${fmtNum(cb)} rg\nBT\n` +
    `/${resName} ${fmtNum(size)} Tf\n` +
    `1 0 0 1 ${fmtNum(target.origin.x)} ${fmtNum(target.origin.y)} Tm\n` +
    `${showOperand} Tj\nET\nQ`;
  setPageContent(doc, pageIndex, serializeOps(ops) + redraw);

  return true;
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
