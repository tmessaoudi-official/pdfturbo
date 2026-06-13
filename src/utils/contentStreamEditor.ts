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
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  rgb,
} from '@cantoo/pdf-lib';

import type { CsToken, CsOp, TextOpInfo } from '../types/contentStream';
export type { CsToken, CsOp, TextOpInfo } from '../types/contentStream';

/** Radius (PDF points) within which secondary show ops are blanked as shadows. */
const SHADOW_RADIUS = 4;

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

type Matrix = [number, number, number, number, number, number];
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

const SHOW_OPS = new Set(['Tj', 'TJ', "'", '"']);

/** Walk ops tracking PDF text state; return every text-showing op with its origin and fill color. */
export function locateTextOps(ops: CsOp[]): TextOpInfo[] {
  const found: TextOpInfo[] = [];
  let textMatrix: Matrix = [...IDENTITY];
  let lineMatrix: Matrix = [...IDENTITY];
  let fontKey = '';
  let fontSize = 0;
  let leading = 0;
  let fillColor: string | undefined;

  const num = (t: CsToken | undefined): number => t?.value ?? 0;

  ops.forEach((op, opIndex) => {
    switch (op.operator) {
      case 'BT':
        textMatrix = [...IDENTITY];
        lineMatrix = [...IDENTITY];
        break;
      case 'Tf':
        fontKey = op.operands[0]?.raw ?? '';
        fontSize = num(op.operands[1]);
        break;
      case 'TL':
        leading = num(op.operands[0]);
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
        break;
      case 'g':
        fillColor = op.operands.map(t => t.raw).join(' ') + ' g';
        break;
      case 'k':
        fillColor = op.operands.map(t => t.raw).join(' ') + ' k';
        break;
      case 'sc':
      case 'scn':
        fillColor = op.operands.map(t => t.raw).join(' ') + ' ' + op.operator;
        break;
      case 'cs':
        // Color space change — color value no longer reliable; reset.
        fillColor = undefined;
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
        origin: { x: textMatrix[4], y: textMatrix[5] },
        fontKey,
        fontSize: fontSize * vScale,
        fillColor,
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
    const firstStr = arr.items.find(t => t.type === 'string');
    if (!firstStr) return false; // all hex → can't replace safely
    const encoded = encodeLiteralString(newText);
    arr.raw = `[${encoded}]`;
    arr.items = [{ type: 'string', raw: encoded }];
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
 * Blank all show ops within SHADOW_RADIUS of `primaryOrigin`, skipping the op
 * at `excludeOpIndex` (already handled separately by the caller).
 */
function blankAllNearby(
  ops: CsOp[],
  textOps: TextOpInfo[],
  primaryOrigin: { x: number; y: number },
  excludeOpIndex: number
): void {
  for (const t of textOps) {
    if (t.opIndex === excludeOpIndex) continue;
    const dist = Math.hypot(t.origin.x - primaryOrigin.x, t.origin.y - primaryOrigin.y);
    if (dist <= SHADOW_RADIUS) blankShowOp(ops[t.opIndex]);
  }
}

// ── Public edit API ────────────────────────────────────────────────────────────

interface EditTarget {
  ops: CsOp[];
  target: TextOpInfo;
  textOps: TextOpInfo[];
}

function findTarget(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  tolerance: number
): EditTarget | null {
  const content = getPageContent(doc, pageIndex);
  if (!content) return null;
  const ops = groupOps(tokenizeContentStream(content));
  const textOps = locateTextOps(ops);

  let best: TextOpInfo | null = null;
  let bestDist = Infinity;
  for (const t of textOps) {
    const dist = Math.hypot(t.origin.x - point.x, t.origin.y - point.y);
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best ? { ops, target: best, textOps } : null;
}

/**
 * Locate the text-show op nearest to `point` without modifying anything.
 * Lets callers test whether a true edit is possible before offering it.
 */
export async function findTextOpAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  tolerance = 5
): Promise<TextOpInfo | null> {
  return findTarget(doc, pageIndex, point, tolerance)?.target ?? null;
}

/**
 * Truly delete the text op nearest to `point` (PDF coords, baseline origin).
 * Also blanks shadow ops within SHADOW_RADIUS of the target to remove outline effects.
 * Returns false when no show op lies within `tolerance`.
 */
export async function deleteTextAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  tolerance = 5
): Promise<boolean> {
  const found = findTarget(doc, pageIndex, point, tolerance);
  if (!found) return false;

  blankShowOp(found.ops[found.target.opIndex]);
  blankAllNearby(found.ops, found.textOps, found.target.origin, found.target.opIndex);
  setPageContent(doc, pageIndex, serializeOps(found.ops));
  return true;
}

/**
 * Truly replace the text op nearest to `point`.
 *
 * Strategy:
 *   - ASCII literal strings: replace in-place (preserves original font/size/color).
 *   - Hex-encoded strings: blank then redraw with detected color at detected size.
 * Shadow ops within SHADOW_RADIUS are always blanked regardless of strategy.
 */
export async function replaceTextAt(
  doc: PDFDocument,
  pageIndex: number,
  point: { x: number; y: number },
  newText: string,
  tolerance = 5
): Promise<boolean> {
  const found = findTarget(doc, pageIndex, point, tolerance);
  if (!found) return false;

  const { ops, target, textOps } = found;
  const replaced = replaceShowOpInPlace(ops[target.opIndex], newText);

  if (replaced) {
    // In-stream path: font/size/color all preserved; just blank shadows and write back.
    blankAllNearby(ops, textOps, target.origin, target.opIndex);
    setPageContent(doc, pageIndex, serializeOps(ops));
  } else {
    // Fallback path: blank everything in the target area, then append a new drawText.
    blankShowOp(ops[target.opIndex]);
    blankAllNearby(ops, textOps, target.origin, target.opIndex);
    setPageContent(doc, pageIndex, serializeOps(ops));

    let drawColor: ReturnType<typeof rgb> | undefined;
    if (target.fillColor) {
      const c = parseFillColorToRgb(target.fillColor);
      if (c) drawColor = rgb(c.r, c.g, c.b);
    }

    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(pageIndex);
    page.drawText(newText, {
      x: target.origin.x,
      y: target.origin.y,
      size: target.fontSize || 12,
      font,
      ...(drawColor ? { color: drawColor } : {}),
    });
  }

  return true;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resources = doc.context.lookup((page.node as any).Resources()) as any;
    if (!resources?.get) return '';
    const fontDictRaw = resources.get(PDFName.of('Font'));
    if (!fontDictRaw) return '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fontDict = doc.context.lookup(fontDictRaw) as any;
    if (!fontDict?.get) return '';
    const fontEntryRaw = fontDict.get(PDFName.of(name));
    if (!fontEntryRaw) return '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fontEntry = doc.context.lookup(fontEntryRaw) as any;
    if (!fontEntry?.get) return '';
    return fontEntry.get(PDFName.of('BaseFont'))?.toString() ?? '';
  } catch {
    return '';
  }
}
