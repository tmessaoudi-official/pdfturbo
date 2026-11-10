// PTSIG v1 — the phone-signature-pad wire format (docs/plans/phone-signature-pad.plan.md, Decisions Log 2026-11-10).
//
// The phone draws a signature and shows it as one to four QR codes; the PC webcam reads them back. Each QR carries one
// FRAME as base45 text (RFC 9285), which stays inside the QR alphanumeric set: that mode is 2–7 QR versions smaller
// than byte mode for the same text (measured, plan step 1).
//
// Frame (at most 606 bytes = 909 base45 characters, the measured v19 EC-M budget):
//   0–1  magic 'PT'        2  version (1)        3  frame index (high nibble) / frame total (low nibble, 1..4)
//   4–7  CRC-32 (IEEE, big-endian) of the WHOLE body — every frame of one sequence carries the same value, so it is
//        also the sequence id that keeps frames of two different signatures apart
//   8..  this frame's slice of the body (at most 598 bytes)
//
// Body: gridWidth varint, gridHeight varint (the longer side is exactly 1023), colour (3 bytes RGB), line width (1 byte,
// quarter grid units, 1..255), strokeCount varint, then per stroke a pointCount varint and that many zigzag-varint
// (dx, dy) pairs. Every point is relative to the previous one, the first point of a stroke to the previous stroke's
// end (the first of all to 0,0). Varints are unsigned LEB128, canonical, at most 3 bytes.
//
// THE CRC DETECTS MISREADS; IT AUTHENTICATES NOTHING. Anyone can build a frame with a valid CRC, so the body parser
// behind it treats every byte as hostile: counts are capped before anything is read or allocated, every point is
// range-checked, trailing bytes are refused. A decoded signature is only ever drawn onto a canvas.

export const PTSIG_LIMITS = {
  maxFrames: 4,
  maxFrameChars: 909,
  maxFrameBytes: 606,
  headerBytes: 8,
  maxBodyBytesPerFrame: 598,
  gridMax: 1023,
  maxStrokes: 256,
  maxPointsPerStroke: 1024,
  maxVarintBytes: 3,
  maxTolerance: 4,
} as const;

export type PtsigErrorCode =
  | 'base45'
  | 'too-large'
  | 'truncated'
  | 'magic'
  | 'version'
  | 'range'
  | 'mixed'
  | 'incomplete'
  | 'crc'
  | 'limit'
  | 'trailing'
  | 'empty';

export class PtsigError extends Error {
  readonly code: PtsigErrorCode;
  constructor(code: PtsigErrorCode, message: string) {
    super(`PTSIG ${code}: ${message}`);
    this.name = 'PtsigError';
    this.code = code;
  }
}

export interface SignaturePoint {
  x: number;
  y: number;
}

/** A signature as drawn: surface size and line width in the same units as the points (CSS pixels). */
export interface SignatureInput {
  width: number;
  height: number;
  /** `#rrggbb` */
  color: string;
  lineWidth: number;
  strokes: SignaturePoint[][];
}

/** A decoded signature on its grid: integer points with 0 ≤ x ≤ gridWidth, 0 ≤ y ≤ gridHeight. */
export interface DecodedSignature {
  gridWidth: number;
  gridHeight: number;
  color: string;
  /** In grid units (a multiple of 0.25). */
  lineWidth: number;
  strokes: SignaturePoint[][];
}

export interface FrameHeader {
  index: number;
  total: number;
  crc: number;
}

const MAGIC0 = 0x50; // 'P'
const MAGIC1 = 0x54; // 'T'
const VERSION = 1;

// ---- base45 (RFC 9285) --------------------------------------------------------------------------------------------

const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const B45_INDEX = new Map<string, number>([...B45].map((c, i) => [c, i]));

export function base45Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    let n = bytes[i] * 256 + bytes[i + 1];
    const c = n % 45;
    n = (n - c) / 45;
    const d = n % 45;
    const e = (n - d) / 45;
    out += B45[c] + B45[d] + B45[e];
  }
  if (bytes.length % 2) {
    const n = bytes[bytes.length - 1];
    out += B45[n % 45] + B45[Math.floor(n / 45)];
  }
  return out;
}

export function base45Decode(text: string): Uint8Array {
  if (text.length % 3 === 1) throw new PtsigError('base45', `length ${text.length} is 3n+1`);
  const digit = (i: number): number => {
    const v = B45_INDEX.get(text[i]);
    if (v === undefined) throw new PtsigError('base45', `character at ${i} is outside the alphabet`);
    return v;
  };
  const out = new Uint8Array(Math.floor(text.length / 3) * 2 + (text.length % 3 === 2 ? 1 : 0));
  let o = 0;
  for (let i = 0; i < text.length; i += 3) {
    if (i + 2 < text.length) {
      const n = digit(i) + digit(i + 1) * 45 + digit(i + 2) * 2025;
      if (n > 0xffff) throw new PtsigError('base45', `chunk at ${i} overflows 16 bits`);
      out[o++] = n >> 8;
      out[o++] = n & 0xff;
    } else {
      const n = digit(i) + digit(i + 1) * 45;
      if (n > 0xff) throw new PtsigError('base45', `final chunk overflows 8 bits`);
      out[o++] = n;
    }
  }
  return out;
}

// ---- CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320) ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- encoder ------------------------------------------------------------------------------------------------------

/** Distance from p to the SEGMENT a–b (not the infinite line, so a closed stroke keeps its far points). */
function segmentDistance(p: SignaturePoint, a: SignaturePoint, b: SignaturePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker with an explicit stack: a point survives when it deviates by MORE than `tolerance`. */
function simplify(points: SignaturePoint[], tolerance: number): SignaturePoint[] {
  const n = points.length;
  if (n < 3) return points;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i], points[a], points[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

const isFinitePositive = (v: number): boolean => Number.isFinite(v) && v > 0;

interface Prepared {
  gridW: number;
  gridH: number;
  rgb: [number, number, number];
  lineQuarters: number;
  strokes: SignaturePoint[][];
}

/** Validate, normalise to the grid, quantise, clamp and drop consecutive repeats. Tolerance-independent. */
function prepare(sig: SignatureInput): Prepared {
  if (!/^#[0-9a-fA-F]{6}$/.test(sig.color)) throw new PtsigError('range', 'colour must be #rrggbb');
  if (!isFinitePositive(sig.width) || !isFinitePositive(sig.height)) throw new PtsigError('range', 'surface size must be positive');
  if (!isFinitePositive(sig.lineWidth)) throw new PtsigError('range', 'line width must be positive');
  const { gridMax } = PTSIG_LIMITS;
  const landscape = sig.width >= sig.height;
  const scale = gridMax / Math.max(sig.width, sig.height);
  const gridW = landscape ? gridMax : Math.max(1, Math.min(gridMax, Math.round(sig.width * scale)));
  const gridH = landscape ? Math.max(1, Math.min(gridMax, Math.round(sig.height * scale))) : gridMax;
  const strokes: SignaturePoint[][] = [];
  for (const stroke of sig.strokes) {
    const out: SignaturePoint[] = [];
    for (const p of stroke) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new PtsigError('range', 'non-finite coordinate');
      const x = Math.max(0, Math.min(gridW, Math.round(p.x * scale)));
      const y = Math.max(0, Math.min(gridH, Math.round(p.y * scale)));
      const last = out[out.length - 1];
      if (!last || last.x !== x || last.y !== y) out.push({ x, y });
    }
    if (out.length) strokes.push(out);
  }
  if (!strokes.length) throw new PtsigError('empty', 'no points to encode');
  const hex = sig.color.slice(1);
  return {
    gridW,
    gridH,
    rgb: [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)],
    lineQuarters: Math.max(1, Math.min(255, Math.round(sig.lineWidth * scale * 4))),
    strokes,
  };
}

function pushVarint(out: number[], n: number): void {
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
}

function bodyOf(p: Prepared, tolerance: number): Uint8Array {
  const strokes = p.strokes.map((s) => simplify(s, tolerance));
  if (strokes.length > PTSIG_LIMITS.maxStrokes) throw new PtsigError('too-large', `${strokes.length} strokes`);
  const out: number[] = [];
  pushVarint(out, p.gridW);
  pushVarint(out, p.gridH);
  out.push(...p.rgb, p.lineQuarters);
  pushVarint(out, strokes.length);
  let px = 0;
  let py = 0;
  for (const s of strokes) {
    if (s.length > PTSIG_LIMITS.maxPointsPerStroke) throw new PtsigError('too-large', `a stroke of ${s.length} points`);
    pushVarint(out, s.length);
    for (const { x, y } of s) {
      const dx = x - px;
      const dy = y - py;
      pushVarint(out, dx < 0 ? -2 * dx - 1 : 2 * dx);
      pushVarint(out, dy < 0 ? -2 * dy - 1 : 2 * dy);
      px = x;
      py = y;
    }
  }
  if (out.length > PTSIG_LIMITS.maxFrames * PTSIG_LIMITS.maxBodyBytesPerFrame)
    throw new PtsigError('too-large', `${out.length} body bytes`);
  return Uint8Array.from(out);
}

/** The body at one RDP tolerance (grid units). Throws `too-large` when it would break a cap. */
export function encodeSignatureBody(sig: SignatureInput, tolerance: number): Uint8Array {
  return bodyOf(prepare(sig), tolerance);
}

/**
 * Encode as 1–4 frames: the fewest frames over RDP tolerances 1..4, then the lowest tolerance achieving that count.
 * Throws `empty` (nothing drawn), `range` (bad input) or `too-large` (no tolerance fits four frames).
 */
export function encodeSignatureFrames(sig: SignatureInput): { frames: string[]; tolerance: number } {
  const prepared = prepare(sig);
  const per = PTSIG_LIMITS.maxBodyBytesPerFrame;
  let best: { body: Uint8Array; tolerance: number; frames: number } | null = null;
  for (let t = 1; t <= PTSIG_LIMITS.maxTolerance; t++) {
    let body: Uint8Array;
    try {
      body = bodyOf(prepared, t);
    } catch (e) {
      if (e instanceof PtsigError && e.code === 'too-large') continue;
      throw e;
    }
    const frames = Math.ceil(body.length / per);
    if (!best || frames < best.frames) best = { body, tolerance: t, frames };
    if (frames === 1) break;
  }
  if (!best) throw new PtsigError('too-large', 'the signature does not fit four QR codes at any tolerance');
  const crc = crc32(best.body);
  const frames: string[] = [];
  for (let i = 0; i < best.frames; i++) {
    const slice = best.body.subarray(i * per, (i + 1) * per);
    const bytes = new Uint8Array(PTSIG_LIMITS.headerBytes + slice.length);
    bytes.set([MAGIC0, MAGIC1, VERSION, (i << 4) | best.frames, crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
    bytes.set(slice, PTSIG_LIMITS.headerBytes);
    frames.push(base45Encode(bytes));
  }
  return { frames, tolerance: best.tolerance };
}

// ---- decoder ------------------------------------------------------------------------------------------------------

interface ParsedFrame extends FrameHeader {
  slice: Uint8Array;
}

function parseFrame(text: string): ParsedFrame {
  // the length cap runs BEFORE base45, so an oversized text costs nothing to refuse
  if (text.length > PTSIG_LIMITS.maxFrameChars) throw new PtsigError('too-large', `frame of ${text.length} characters`);
  const bytes = base45Decode(text);
  if (bytes.length < PTSIG_LIMITS.headerBytes) throw new PtsigError('truncated', 'frame shorter than its header');
  if (bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1) throw new PtsigError('magic', 'not a PTSIG frame');
  if (bytes[2] !== VERSION) throw new PtsigError('version', `format version ${bytes[2]}`);
  const index = bytes[3] >> 4;
  const total = bytes[3] & 0x0f;
  if (total < 1 || total > PTSIG_LIMITS.maxFrames || index >= total)
    throw new PtsigError('range', `frame ${index} of ${total}`);
  const crc = ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;
  return { index, total, crc, slice: bytes.subarray(PTSIG_LIMITS.headerBytes) };
}

/** One frame's header, for showing scan progress ("2 of 3"). Throws like the decoder on a bad frame. */
export function readFrameHeader(text: string): FrameHeader {
  const { index, total, crc } = parseFrame(text);
  return { index, total, crc };
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

function parseBody(body: Uint8Array): DecodedSignature {
  let pos = 0;
  const varint = (): number => {
    let v = 0;
    for (let i = 0; i < PTSIG_LIMITS.maxVarintBytes; i++) {
      if (pos >= body.length) throw new PtsigError('truncated', 'body ends inside a number');
      const b = body[pos++];
      v |= (b & 0x7f) << (7 * i);
      if (!(b & 0x80)) {
        if (i > 0 && b === 0) throw new PtsigError('range', 'overlong number');
        return v;
      }
    }
    throw new PtsigError('limit', `number longer than ${PTSIG_LIMITS.maxVarintBytes} bytes`);
  };
  const { gridMax } = PTSIG_LIMITS;
  const gridWidth = varint();
  const gridHeight = varint();
  if (gridWidth < 1 || gridHeight < 1 || gridWidth > gridMax || gridHeight > gridMax || Math.max(gridWidth, gridHeight) !== gridMax)
    throw new PtsigError('range', `grid ${gridWidth}x${gridHeight}`);
  if (pos + 4 > body.length) throw new PtsigError('truncated', 'body ends inside colour or width');
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  const color = `#${hex(body[pos])}${hex(body[pos + 1])}${hex(body[pos + 2])}`;
  const quarters = body[pos + 3];
  pos += 4;
  if (quarters === 0) throw new PtsigError('range', 'zero line width');
  const strokeCount = varint();
  if (strokeCount === 0) throw new PtsigError('empty', 'no strokes');
  if (strokeCount > PTSIG_LIMITS.maxStrokes) throw new PtsigError('limit', `${strokeCount} strokes`);
  const unzz = (n: number) => (n & 1 ? -(n + 1) / 2 : n / 2);
  const strokes: SignaturePoint[][] = [];
  let x = 0;
  let y = 0;
  for (let s = 0; s < strokeCount; s++) {
    const n = varint();
    if (n === 0) throw new PtsigError('empty', 'a stroke with no points');
    if (n > PTSIG_LIMITS.maxPointsPerStroke) throw new PtsigError('limit', `a stroke of ${n} points`);
    const stroke: SignaturePoint[] = [];
    for (let i = 0; i < n; i++) {
      x += unzz(varint());
      y += unzz(varint());
      if (x < 0 || x > gridWidth || y < 0 || y > gridHeight) throw new PtsigError('range', `point ${x},${y} off the grid`);
      stroke.push({ x, y });
    }
    strokes.push(stroke);
  }
  if (pos !== body.length) throw new PtsigError('trailing', `${body.length - pos} bytes after the last stroke`);
  return { gridWidth, gridHeight, color, lineWidth: quarters / 4, strokes };
}

/**
 * Decode the frames of one signature, in any order; an identical repeat of a frame is ignored (a camera reads the
 * same code many times). Every failure is a PtsigError with a code; nothing else is thrown.
 */
export function decodeSignatureFrames(texts: readonly string[]): DecodedSignature {
  if (!texts.length) throw new PtsigError('incomplete', 'no frames');
  const byIndex = new Map<number, Uint8Array>();
  let first: ParsedFrame | null = null;
  for (const text of texts) {
    const f = parseFrame(text);
    if (!first) first = f;
    else if (f.total !== first.total || f.crc !== first.crc) throw new PtsigError('mixed', 'frames of two sequences');
    const seen = byIndex.get(f.index);
    if (seen && !sameBytes(seen, f.slice)) throw new PtsigError('mixed', `two different frames ${f.index}`);
    byIndex.set(f.index, f.slice);
  }
  const head = first as ParsedFrame;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < head.total; i++) {
    const part = byIndex.get(i);
    if (!part) throw new PtsigError('incomplete', `frame ${i + 1} of ${head.total} is missing`);
    parts.push(part);
  }
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    body.set(p, o);
    o += p.length;
  }
  if (crc32(body) !== head.crc) throw new PtsigError('crc', 'checksum mismatch: a misread or a damaged code');
  return parseBody(body);
}
