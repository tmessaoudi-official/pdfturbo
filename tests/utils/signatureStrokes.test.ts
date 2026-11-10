// PTSIG v1 — the phone-signature-pad wire format (docs/plans/phone-signature-pad.plan.md, Decisions Log 2026-11-10
// 20:18). The phone shows the signature as QR text; the PC webcam reads it back. Every frame the decoder sees is
// UNTRUSTED (a camera misread, another code in view, a crafted QR), so most of this file is the decoder refusing input.
//
// The handmade frames and bodies below re-implement the ruled layout independently of the module (header bytes, CRC
// byte order, varint/zigzag body), so a change to the wire format reds here even if encoder and decoder change together.
import { describe, it, expect } from 'vitest';
import {
  base45Encode,
  base45Decode,
  crc32,
  decodeSignatureFrames,
  encodeSignatureBody,
  encodeSignatureFrames,
  readFrameHeader,
  PtsigError,
  PTSIG_LIMITS,
  type SignatureInput,
} from '../../src/utils/signatureStrokes';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// ---- helpers (independent of the module under test, except base45Encode/crc32, which have their own vectors) ------

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof PtsigError) return e.code;
    throw e;
  }
  return 'ok';
}

const varint = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const zz = (n: number): number => (n < 0 ? -2 * n - 1 : 2 * n);

interface BodySpec {
  gridW?: number;
  gridH?: number;
  rgb?: [number, number, number];
  lw?: number;
  strokes: Array<Array<[number, number]>>;
}
/** Body bytes per the ruled layout; points are ABSOLUTE here and delta-encoded across strokes. */
function makeBody({ gridW = 1023, gridH = 341, rgb = [0, 0, 0x80], lw = 8, strokes }: BodySpec): number[] {
  const b = [...varint(gridW), ...varint(gridH), ...rgb, lw, ...varint(strokes.length)];
  let px = 0;
  let py = 0;
  for (const s of strokes) {
    b.push(...varint(s.length));
    for (const [x, y] of s) {
      b.push(...varint(zz(x - px)), ...varint(zz(y - py)));
      px = x;
      py = y;
    }
  }
  return b;
}
function frameBytes(index: number, total: number, crc: number, slice: number[], magic = [0x50, 0x54], version = 1): number[] {
  return [...magic, version, (index << 4) | total, (crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff, ...slice];
}
/** Seal a body into frames with a CORRECT CRC — reaches the body parser behind the integrity check. */
function seal(body: number[], per: number = PTSIG_LIMITS.maxBodyBytesPerFrame): string[] {
  const crc = crc32(Uint8Array.from(body));
  const total = Math.max(1, Math.ceil(body.length / per));
  const out: string[] = [];
  for (let i = 0; i < total; i++) out.push(base45Encode(Uint8Array.from(frameBytes(i, total, crc, body.slice(i * per, (i + 1) * per)))));
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pointer-like: dense samples (~1-3 px apart), sub-pixel jitter, fractional coordinates, repeated samples. */
function pointerSignature(seed: number, strokes: number, samples: number, width = 600, height = 200): SignatureInput {
  const r = mulberry32(seed);
  const out: SignatureInput['strokes'] = [];
  for (let s = 0; s < strokes; s++) {
    const cx = width * (0.1 + (0.8 * (s + r())) / strokes);
    const cy = height * (0.35 + 0.3 * r());
    const ax = 15 + 40 * r();
    const ay = 20 + 50 * r();
    const f1 = 0.5 + 3 * r();
    const f2 = 0.5 + 4 * r();
    const p = r() * 6.28;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * 6.28;
      if (pts.length && r() < 0.08) {
        pts.push({ ...pts[pts.length - 1] });
        continue;
      }
      pts.push({
        x: cx + ax * Math.sin(f1 * t + p) + (t - 3.14) * 6 + (r() - 0.5),
        y: cy + ay * Math.sin(f2 * t) + (r() - 0.5),
      });
    }
    out.push(pts);
  }
  return { width, height, color: '#1a237e', lineWidth: 2.5, strokes: out };
}

const pts = (...xy: Array<[number, number]>) => xy.map(([x, y]) => ({ x, y }));

// ---- base45 (RFC 9285) and CRC-32 ---------------------------------------------------------------------------------

describe('base45 (RFC 9285)', () => {
  const enc = (s: string) => base45Encode(new TextEncoder().encode(s));
  const dec = (s: string) => new TextDecoder().decode(base45Decode(s));

  it.each([
    ['AB', 'BB8'],
    ['Hello!!', '%69 VD92EX0'],
    ['base-45', 'UJCLQE7W581'],
    ['ietf!', 'QED8WEX0'],
  ])('RFC vector %j ↔ %j', (plain, coded) => {
    expect(enc(plain)).toBe(coded);
    expect(dec(coded)).toBe(plain);
  });

  it('round-trips every byte value and the empty string', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base45Decode(base45Encode(all))).toEqual(all);
    expect(base45Encode(new Uint8Array(0))).toBe('');
    expect(base45Decode('')).toEqual(new Uint8Array(0));
  });

  it('rejects a character outside the QR alphanumeric set (lower case included)', () => {
    expect(codeOf(() => base45Decode('bb8'))).toBe('base45');
    expect(codeOf(() => base45Decode('BB#'))).toBe('base45');
  });

  it('rejects a length of 3n+1 and chunks that overflow (GGW > 65535, GG > 255)', () => {
    expect(codeOf(() => base45Decode('BB8A'))).toBe('base45');
    expect(codeOf(() => base45Decode('GGW'))).toBe('base45');
    expect(codeOf(() => base45Decode('GG'))).toBe('base45');
    expect(codeOf(() => base45Decode('FGW'))).toBe('ok'); // 65535, the largest legal 3-char chunk
  });
});

describe('crc32 (IEEE)', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

// ---- decoder: handmade frames pin the wire format, then every rejection -------------------------------------------

describe('decodeSignatureFrames — the wire format', () => {
  it('decodes a handmade body: grid, colour, quarter-unit line width, strokes delta-coded across strokes', () => {
    const body = makeBody({ gridW: 1023, gridH: 341, rgb: [0x1a, 0x23, 0x7e], lw: 10, strokes: [[[10, 20], [30, 5]], [[500, 300]]] });
    expect(decodeSignatureFrames(seal(body))).toEqual({
      gridWidth: 1023,
      gridHeight: 341,
      color: '#1a237e',
      lineWidth: 2.5,
      strokes: [pts([10, 20], [30, 5]), pts([500, 300])],
    });
  });

  it('accepts a portrait grid (the longer side may be either dimension)', () => {
    const d = decodeSignatureFrames(seal(makeBody({ gridW: 341, gridH: 1023, strokes: [[[341, 1023]]] })));
    expect([d.gridWidth, d.gridHeight]).toEqual([341, 1023]);
  });

  it('readFrameHeader reads index, total and the big-endian CRC', () => {
    const body = makeBody({ strokes: [[[1, 1]]] });
    const f = seal(body)[0];
    expect(readFrameHeader(f)).toEqual({ index: 0, total: 1, crc: crc32(Uint8Array.from(body)) });
  });

  it('reassembles a multi-frame body given in any order, and tolerates an identical duplicate', () => {
    const body = makeBody({ strokes: [[[1, 1], [2, 2]]] });
    const frames = seal(body, 5); // tiny slices force several frames
    expect(frames.length).toBeGreaterThan(1);
    const want = decodeSignatureFrames(frames);
    expect(decodeSignatureFrames([...frames].reverse())).toEqual(want);
    expect(decodeSignatureFrames([frames[1], ...frames])).toEqual(want);
    expect(readFrameHeader(frames[1])).toMatchObject({ index: 1, total: frames.length });
  });
});

describe('decodeSignatureFrames — rejects untrusted input with a typed code', () => {
  const okBody = makeBody({ strokes: [[[10, 10], [20, 20]]] });
  const okCrc = crc32(Uint8Array.from(okBody));
  const raw = (bytes: number[]) => base45Encode(Uint8Array.from(bytes));
  const dec = (...frames: string[]) => codeOf(() => decodeSignatureFrames(frames));
  const decBody = (spec: BodySpec | number[]) => codeOf(() => decodeSignatureFrames(seal(Array.isArray(spec) ? spec : makeBody(spec))));

  it('too-large: a frame over 909 characters is refused BEFORE base45 decoding', () => {
    expect(PTSIG_LIMITS.maxFrameChars).toBe(909);
    expect(dec('!'.repeat(910))).toBe('too-large'); // '!' is not base45: the length check ran first
    expect(dec('A'.repeat(909))).not.toBe('too-large');
  });

  it('base45: text outside the alphabet', () => {
    expect(dec('hello')).toBe('base45');
  });

  it('incomplete: no frames at all, or a missing index', () => {
    expect(dec()).toBe('incomplete');
    const frames = seal(okBody, 4);
    expect(frames.length).toBeGreaterThan(2);
    expect(dec(...frames.slice(0, -1))).toBe('incomplete');
    expect(dec(...frames.slice(1))).toBe('incomplete');
  });

  it('truncated: a frame shorter than its 8-byte header', () => {
    expect(dec(raw([0x50, 0x54, 1, 0x01, 0, 0, 0]))).toBe('truncated');
  });

  it('magic and version', () => {
    expect(dec(raw(frameBytes(0, 1, okCrc, okBody, [0x50, 0x55])))).toBe('magic');
    expect(dec(raw(frameBytes(0, 1, okCrc, okBody, undefined, 2)))).toBe('version');
  });

  it('range: index ≥ total, total 0, total above 4', () => {
    expect(dec(raw(frameBytes(1, 1, okCrc, okBody)))).toBe('range');
    expect(dec(raw(frameBytes(0, 0, okCrc, okBody)))).toBe('range');
    expect(dec(raw(frameBytes(0, 5, okCrc, okBody)))).toBe('range');
  });

  it('crc: one flipped body byte behind an intact header', () => {
    const bad = [...okBody];
    bad[bad.length - 1] ^= 0x02;
    expect(dec(raw(frameBytes(0, 1, okCrc, bad)))).toBe('crc');
  });

  it('mixed: frames of two sequences (different CRC or total), or one index with two contents', () => {
    const a = seal(okBody, 5); // 3 frames, so a forged total of 4 is still in range
    const otherBody = makeBody({ strokes: [[[11, 10], [20, 20]]] });
    const b = seal(otherBody, 5);
    expect([a.length, b.length]).toEqual([3, 3]);
    expect(dec(a[0], b[1], ...a.slice(2))).toBe('mixed');
    const t2 = raw(frameBytes(1, a.length + 1, okCrc, okBody.slice(4, 8)));
    expect(dec(a[0], t2)).toBe('mixed');
    const forged = raw(frameBytes(0, a.length, okCrc, [9, 9, 9, 9]));
    expect(dec(...a, forged)).toBe('mixed');
  });

  it('truncated: the body ends inside a varint or before its last point', () => {
    expect(decBody(okBody.slice(0, -1))).toBe('truncated');
    expect(decBody([...okBody.slice(0, -1), 0x80])).toBe('truncated');
  });

  it('trailing: bytes after the last stroke', () => {
    expect(decBody([...okBody, 0])).toBe('trailing');
  });

  it('empty: zero strokes, or a stroke with zero points', () => {
    expect(decBody({ strokes: [] })).toBe('empty');
    expect(decBody({ strokes: [[[1, 1]], []] })).toBe('empty');
  });

  it('range: the grid — longer side not exactly 1023 (either dimension), a zero side', () => {
    expect(decBody({ gridW: 1024, gridH: 341, strokes: [[[1, 1]]] })).toBe('range');
    expect(decBody({ gridW: 1022, gridH: 341, strokes: [[[1, 1]]] })).toBe('range');
    expect(decBody({ gridW: 341, gridH: 1024, strokes: [[[1, 1]]] })).toBe('range');
    expect(decBody({ gridW: 1023, gridH: 0, strokes: [[[1, 0]]] })).toBe('range');
    expect(decBody({ gridW: 1023, gridH: 1023, strokes: [[[1, 1]]] })).toBe('ok');
  });

  it('range: a zero line width, or a point off the grid in any direction', () => {
    expect(decBody({ lw: 0, strokes: [[[1, 1]]] })).toBe('range');
    expect(decBody({ strokes: [[[1024, 1]]] })).toBe('range');
    expect(decBody({ strokes: [[[1, 342]]] })).toBe('range');
    expect(decBody({ strokes: [[[0, 0], [-1, 0]]] })).toBe('range');
    expect(decBody({ strokes: [[[0, 0], [0, -1]]] })).toBe('range');
    expect(decBody({ strokes: [[[1023, 341]]] })).toBe('ok');
  });

  it('range: an overlong (non-canonical) varint', () => {
    const b = makeBody({ strokes: [[[1, 1]]] });
    // gridW 1023 = [0xff, 0x07], gridH 341 = [0xd5, 0x02], 3 colour bytes, 1 width byte, then strokeCount
    expect([...varint(1023), ...varint(341)]).toEqual([0xff, 0x07, 0xd5, 0x02]);
    const idx = 2 + 2 + 3 + 1;
    expect(b[idx]).toBe(1);
    // strokeCount 1 re-spelt as [0x81, 0x00]: the same value in two bytes
    expect(decBody([...b.slice(0, idx), 0x81, 0x00, ...b.slice(idx + 1)])).toBe('range');
  });

  it('limit: a varint longer than 3 bytes is refused, never looped on', () => {
    const idx = 2 + 2 + 3 + 1; // strokeCount
    const b = makeBody({ strokes: [[[1, 1]]] });
    // in the grid-width slot: a 4-byte read would give 2^21, which only the grid check (range) could refuse —
    // in the strokeCount slot the stroke cap would answer 'limit' too and hide a raised byte limit (sabotage)
    expect(decBody([0x80, 0x80, 0x80, 0x01, ...b.slice(2)])).toBe('limit');
    expect(decBody([...b.slice(0, idx), ...new Array<number>(500).fill(0xff)])).toBe('limit');
  });

  it('limit: stroke and point counts are capped BEFORE any allocation or read', () => {
    expect(PTSIG_LIMITS.maxStrokes).toBe(256);
    expect(PTSIG_LIMITS.maxPointsPerStroke).toBe(1024);
    const head = makeBody({ strokes: [] }).slice(0, -1); // everything before strokeCount
    // nothing follows the count: a parser that allocated or read first would say 'truncated'
    expect(decBody([...head, ...varint(257)])).toBe('limit');
    expect(decBody([...head, ...varint(2_000_000)])).toBe('limit');
    expect(decBody([...head, 1, ...varint(1025)])).toBe('limit');
    expect(decBody([...head, ...varint(256)])).toBe('truncated');
    expect(decBody([...head, 1, ...varint(1024)])).toBe('truncated');
  });
});

// ---- encoder --------------------------------------------------------------------------------------------------------

describe('encodeSignatureFrames', () => {
  // 1023 x 511 makes the scale exactly 1, so integer input survives quantisation unchanged
  const unit = (strokes: SignatureInput['strokes'], extra: Partial<SignatureInput> = {}): SignatureInput => ({
    width: 1023,
    height: 511,
    color: '#000080',
    lineWidth: 2,
    strokes,
    ...extra,
  });

  it('round-trips exactly when nothing is simplifiable: several strokes, a dot, both grid extremes', () => {
    const strokes = [pts([10, 10], [20, 30], [30, 10], [40, 30]), pts([500, 400]), pts([1023, 0], [0, 511])];
    const { frames, tolerance } = encodeSignatureFrames(unit(strokes));
    expect(frames).toHaveLength(1);
    expect(tolerance).toBe(1);
    expect(decodeSignatureFrames(frames)).toEqual({ gridWidth: 1023, gridHeight: 511, color: '#000080', lineWidth: 2, strokes });
  });

  it('every frame is QR-alphanumeric text of at most 909 characters', () => {
    const { frames } = encodeSignatureFrames(pointerSignature(7, 30, 500));
    expect(frames.length).toBeGreaterThan(1);
    for (const f of frames) {
      expect(f.length).toBeLessThanOrEqual(909);
      expect([...f].every((c) => ALPHABET.includes(c))).toBe(true);
    }
  });

  it('normalises the longer side to exactly 1023, landscape and portrait', () => {
    const land = decodeSignatureFrames(encodeSignatureFrames({ ...unit([pts([600, 200])]), width: 600, height: 200 }).frames);
    expect([land.gridWidth, land.gridHeight]).toEqual([1023, 341]);
    expect(land.strokes).toEqual([pts([1023, 341])]);
    const port = decodeSignatureFrames(encodeSignatureFrames({ ...unit([pts([0, 600])]), width: 200, height: 600 }).frames);
    expect([port.gridWidth, port.gridHeight]).toEqual([341, 1023]);
  });

  it('clamps points drawn past the surface edge onto the grid', () => {
    const d = decodeSignatureFrames(encodeSignatureFrames(unit([pts([-5, 600], [1100, -3])])).frames);
    expect(d.strokes).toEqual([pts([0, 511], [1023, 0])]);
  });

  it('line width in quarter grid units, clamped to 1..255 quarters; colour lower-cased', () => {
    const lw = (lineWidth: number) => decodeSignatureFrames(encodeSignatureFrames(unit([pts([1, 1])], { lineWidth })).frames).lineWidth;
    expect(lw(2.6)).toBe(2.5);
    expect(lw(0.01)).toBe(0.25);
    expect(lw(1000)).toBe(63.75);
    expect(decodeSignatureFrames(encodeSignatureFrames(unit([pts([1, 1])], { color: '#AbCdEf' })).frames).color).toBe('#abcdef');
  });

  it('drops consecutive repeats after quantising, keeps a one-point stroke as a dot', () => {
    const d = decodeSignatureFrames(
      encodeSignatureFrames(unit([pts([5, 5], [5.2, 4.9], [4.8, 5.1], [9, 9]), pts([7, 7], [7, 7])])).frames,
    );
    expect(d.strokes).toEqual([pts([5, 5], [9, 9]), pts([7, 7])]);
  });

  it('simplifies with Ramer–Douglas–Peucker: collinear points go, a deviation of exactly the tolerance goes, more stays', () => {
    const d = (s: SignatureInput['strokes']) => decodeSignatureFrames(encodeSignatureFrames(unit(s)).frames).strokes;
    expect(d([pts([0, 0], [10, 10], [20, 20], [30, 30])])).toEqual([pts([0, 0], [30, 30])]);
    expect(d([pts([0, 0], [50, 1], [100, 0])])).toEqual([pts([0, 0], [100, 0])]);
    expect(d([pts([0, 0], [50, 2], [100, 0])])).toEqual([pts([0, 0], [50, 2], [100, 0])]);
    // a closed loop (first == last) keeps its far points: distance is to the segment, not an infinite line
    expect(d([pts([0, 0], [40, 0], [40, 40], [0, 0])])).toEqual([pts([0, 0], [40, 0], [40, 40], [0, 0])]);
  });

  it('a long hostile stroke (10k zigzag points, nothing to simplify) ends in a typed outcome', () => {
    // ~0.6 s per tolerance measured (var/claude/ptsig/scale.txt, n·log n); a smooth 20k stroke is ~40 ms
    const long = Array.from({ length: 10_000 }, (_, i) => ({ x: (i % 1000) * 1.0, y: i % 2 === 0 ? 100 : 106 }));
    // codeOf rethrows anything that is not a PtsigError, so a RangeError (recursion depth) fails here
    expect(['ok', 'too-large']).toContain(codeOf(() => encodeSignatureFrames(unit([long]))));
  });

  it('empty: no strokes, or only empty strokes', () => {
    expect(codeOf(() => encodeSignatureFrames(unit([])))).toBe('empty');
    expect(codeOf(() => encodeSignatureFrames(unit([[], []])))).toBe('empty');
  });

  it('range: bad colour, a non-positive surface, a non-finite coordinate', () => {
    for (const color of ['red', '#abc', '#gggggg', '#1234567'])
      expect(codeOf(() => encodeSignatureFrames(unit([pts([1, 1])], { color })))).toBe('range');
    expect(codeOf(() => encodeSignatureFrames(unit([pts([1, 1])], { width: 0 })))).toBe('range');
    expect(codeOf(() => encodeSignatureFrames(unit([pts([1, 1])], { height: -1 })))).toBe('range');
    expect(codeOf(() => encodeSignatureFrames(unit([pts([1, Number.NaN])])))).toBe('range');
    expect(codeOf(() => encodeSignatureFrames(unit([pts([1, 1])], { lineWidth: Number.POSITIVE_INFINITY })))).toBe('range');
  });

  it('too-large: random noise that no tolerance fits into 4 frames, and more than 256 strokes', () => {
    const r = mulberry32(99);
    const noise = Array.from({ length: 1000 }, () => ({ x: r() * 1023, y: r() * 511 }));
    expect(codeOf(() => encodeSignatureFrames(unit([noise])))).toBe('too-large');
    const dots = Array.from({ length: 257 }, (_, i) => pts([i, i % 500]));
    expect(codeOf(() => encodeSignatureFrames(unit(dots)))).toBe('too-large');
  });

  it('policy: the fewest frames over tolerances 1..4, then the lowest tolerance that achieves it', () => {
    const framesAt = (sig: SignatureInput, t: number): number => {
      try {
        return Math.ceil(encodeSignatureBody(sig, t).length / PTSIG_LIMITS.maxBodyBytesPerFrame);
      } catch (e) {
        if (e instanceof PtsigError && e.code === 'too-large') return Number.POSITIVE_INFINITY;
        throw e;
      }
    };
    let sawHigherTolerance = false;
    let sawMultiFrame = false;
    for (const [seed, strokes, samples] of [
      [1, 6, 120], [2, 10, 300], [3, 14, 400], [4, 20, 500], [5, 30, 500], [6, 8, 900], [7, 24, 300],
    ] as const) {
      const sig = pointerSignature(seed, strokes, samples);
      const per = [1, 2, 3, 4].map((t) => framesAt(sig, t));
      const best = Math.min(...per);
      const got = encodeSignatureFrames(sig);
      expect(got.frames).toHaveLength(best);
      expect(got.tolerance).toBe(per.indexOf(best) + 1);
      if (got.tolerance > 1) sawHigherTolerance = true;
      if (got.frames.length > 1) sawMultiFrame = true;
    }
    // the property above is vacuous unless the set exercises both branches
    expect(sawHigherTolerance).toBe(true);
    expect(sawMultiFrame).toBe(true);
  });

  it('a typical pointer-drawn signature (6 strokes, 720 raw samples, 600x200) fits one QR', () => {
    const { frames } = encodeSignatureFrames(pointerSignature(1, 6, 120));
    expect(frames).toHaveLength(1);
  });

  it('a multi-frame encoding decodes in any frame order to the same signature', () => {
    const { frames } = encodeSignatureFrames(pointerSignature(5, 30, 500));
    expect(frames.length).toBeGreaterThan(1);
    expect(decodeSignatureFrames([...frames].reverse())).toEqual(decodeSignatureFrames(frames));
  });
});

// ---- fuzz: seeded, three input classes, outcomes tallied per code -------------------------------------------------

describe('fuzz (seeded)', () => {
  const BODY_CODES = new Set(['ok', 'range', 'limit', 'trailing', 'truncated', 'empty']);

  function invariantsHold(frames: string[]): void {
    const d = decodeSignatureFrames(frames);
    expect(Math.max(d.gridWidth, d.gridHeight)).toBe(1023);
    expect(d.strokes.length).toBeGreaterThan(0);
    expect(d.strokes.length).toBeLessThanOrEqual(PTSIG_LIMITS.maxStrokes);
    for (const s of d.strokes) {
      expect(s.length).toBeGreaterThan(0);
      expect(s.length).toBeLessThanOrEqual(PTSIG_LIMITS.maxPointsPerStroke);
      for (const p of s) {
        expect(Number.isInteger(p.x) && p.x >= 0 && p.x <= d.gridWidth).toBe(true);
        expect(Number.isInteger(p.y) && p.y >= 0 && p.y <= d.gridHeight).toBe(true);
      }
    }
  }

  it('class 1 — random alphanumeric text never throws anything but a PtsigError', () => {
    const r = mulberry32(1);
    const tally: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const n = Math.floor(r() * 950);
      let s = '';
      for (let k = 0; k < n; k++) s += ALPHABET[Math.floor(r() * 45)];
      const code = codeOf(() => decodeSignatureFrames([s]));
      tally[code] = (tally[code] ?? 0) + 1;
    }
    expect(tally.ok ?? 0).toBe(0);
    expect(tally.base45).toBeGreaterThan(0);
    expect(tally['too-large']).toBeGreaterThan(0);
  });

  it('class 2 — mutated frames WITHOUT resealing are caught by the header or the CRC', () => {
    const r = mulberry32(2);
    const good = base45Decode(encodeSignatureFrames(pointerSignature(11, 6, 120)).frames[0]);
    const tally: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const b = Array.from(good);
      const at = Math.floor(r() * b.length);
      b[at] = (b[at] ^ (1 + Math.floor(r() * 255))) & 0xff;
      const code = codeOf(() => decodeSignatureFrames([base45Encode(Uint8Array.from(b))]));
      tally[code] = (tally[code] ?? 0) + 1;
    }
    expect(tally.ok ?? 0).toBe(0);
    expect(tally.crc).toBeGreaterThan(1500); // most single-byte flips land in the body
    // a flip in byte 3 can leave a legal header claiming 2-4 frames: that is 'incomplete', not an accept
    for (const c of Object.keys(tally)) expect(['crc', 'magic', 'version', 'range', 'incomplete'].includes(c)).toBe(true);
  });

  it('class 3 — mutated bodies RESEALED with a valid CRC: the parser behind the CRC refuses or yields a sane signature', () => {
    const r = mulberry32(3);
    const bases = [
      Array.from(encodeSignatureBody(pointerSignature(21, 6, 120), 1)),
      Array.from(encodeSignatureBody(pointerSignature(22, 2, 40), 1)),
      makeBody({ strokes: [[[1, 1], [2, 2]], [[3, 3]]] }),
    ];
    const tally: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) {
      const b = [...bases[i % bases.length]];
      const kind = Math.floor(r() * 5);
      const at = Math.floor(r() * b.length);
      if (kind === 0) b[at] = Math.floor(r() * 256);
      else if (kind === 1) b[at] = 0xff;
      else if (kind === 2) b.splice(at, 1 + Math.floor(r() * 4));
      else if (kind === 3) b.splice(at, 0, ...Array.from({ length: 1 + Math.floor(r() * 4) }, () => Math.floor(r() * 256)));
      else b.length = at;
      if (b.length > PTSIG_LIMITS.maxFrames * PTSIG_LIMITS.maxBodyBytesPerFrame) continue;
      const frames = seal(b);
      const code = codeOf(() => decodeSignatureFrames(frames));
      tally[code] = (tally[code] ?? 0) + 1;
      expect(BODY_CODES.has(code)).toBe(true);
      if (code === 'ok') invariantsHold(frames);
    }
    for (const c of ['ok', 'range', 'limit', 'trailing', 'truncated']) expect(tally[c] ?? 0).toBeGreaterThan(0);
  });
});
