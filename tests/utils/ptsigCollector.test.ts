import { describe, expect, it } from 'vitest';
import { createPtsigCollector } from '../../src/utils/ptsigCollector';
import {
  base45Encode,
  crc32,
  decodeSignatureFrames,
  encodeSignatureBody,
  encodeSignatureFrames,
  PTSIG_LIMITS,
  type SignatureInput,
} from '../../src/utils/signatureStrokes';

// Phone-signature-pad step 5b: the camera reads the phone's QR codes one at a time, in any order, many times each,
// with stray codes in view. The collector turns that stream into ONE decoded signature, or a reason to show.

const SIG: SignatureInput = {
  width: 600,
  height: 200,
  color: '#102080',
  lineWidth: 2,
  strokes: [
    [{ x: 10, y: 10 }, { x: 200, y: 150 }, { x: 400, y: 20 }],
    [{ x: 450, y: 100 }],
  ],
};

/** Seal a body into frames of at most `per` body bytes, as the encoder does (it always uses 598). */
function seal(body: Uint8Array, per: number, opts: { version?: number; crc?: number } = {}): string[] {
  const total = Math.ceil(body.length / per);
  const crc = opts.crc ?? crc32(body);
  const out: string[] = [];
  for (let i = 0; i < total; i++) {
    const slice = body.subarray(i * per, (i + 1) * per);
    const bytes = new Uint8Array(8 + slice.length);
    bytes.set([0x50, 0x54, opts.version ?? 1, (i << 4) | total, crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
    bytes.set(slice, 8);
    out.push(base45Encode(bytes));
  }
  return out;
}

const body = encodeSignatureBody(SIG, 1);
const twoFrames = seal(body, Math.ceil(body.length / 2));
/** A frame `index` of a 2-frame sequence whose id is `crc` — a code of some other signature. */
const other = (crc: number, index = 0): string => {
  const bytes = new Uint8Array([0x50, 0x54, 1, (index << 4) | 2, crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff, 1, 2, 3]);
  return base45Encode(bytes);
};

describe('createPtsigCollector', () => {
  it('a single-frame signature is done on its first read', () => {
    const { frames } = encodeSignatureFrames(SIG);
    expect(frames).toHaveLength(1);
    const ev = createPtsigCollector().feed(frames[0]);
    expect(ev).toEqual({ kind: 'done', sig: decodeSignatureFrames(frames) });
  });

  it('a two-frame signature reports progress, then is done — in either order', () => {
    expect(twoFrames).toHaveLength(2);
    const expected = decodeSignatureFrames(twoFrames);
    const a = createPtsigCollector();
    expect(a.feed(twoFrames[0])).toEqual({ kind: 'progress', have: 1, total: 2 });
    expect(a.feed(twoFrames[1])).toEqual({ kind: 'done', sig: expected });
    const b = createPtsigCollector();
    expect(b.feed(twoFrames[1])).toEqual({ kind: 'progress', have: 1, total: 2 });
    expect(b.feed(twoFrames[0])).toEqual({ kind: 'done', sig: expected });
  });

  it('the same frame read again changes nothing', () => {
    const c = createPtsigCollector();
    c.feed(twoFrames[0]);
    expect(c.feed(twoFrames[0])).toEqual({ kind: 'progress', have: 1, total: 2 });
    expect(c.feed(twoFrames[1]).kind).toBe('done');
  });

  it('never trims the text: a frame with a trailing space is not that frame', () => {
    const { frames } = encodeSignatureFrames(SIG);
    expect(createPtsigCollector().feed(`${frames[0]} `).kind).toBe('foreign');
  });

  it('a code that is not PTSIG is foreign: a URL (not base45) and base45 with another magic', () => {
    const c = createPtsigCollector();
    expect(c.feed('https://example.org/')).toEqual({ kind: 'foreign' });
    expect(c.feed(base45Encode(new Uint8Array([0x41, 0x42, 1, 1, 0, 0, 0, 0, 9])))).toEqual({ kind: 'foreign' });
    expect(c.feed('')).toEqual({ kind: 'foreign' });
  });

  it('another format version asks for a refresh of the phone page', () => {
    expect(createPtsigCollector().feed(seal(body, 598, { version: 2 })[0])).toEqual({ kind: 'refresh' });
  });

  it('a misread (CRC mismatch) drops that group; scanning goes on and the good code still decodes', () => {
    const c = createPtsigCollector();
    const bad = body.slice();
    bad[bad.length - 1] ^= 0x01;
    expect(c.feed(seal(bad, 598, { crc: crc32(body) })[0])).toEqual({ kind: 'dropped' });
    expect(c.feed(encodeSignatureFrames(SIG).frames[0]).kind).toBe('done');
  });

  it('a body error behind a VALID crc (trailing bytes) is dropped, not thrown', () => {
    const trailing = new Uint8Array([...body, 0]);
    expect(createPtsigCollector().feed(seal(trailing, 598)[0])).toEqual({ kind: 'dropped' });
  });

  it('two different frames with one index and one crc drop the group', () => {
    const c = createPtsigCollector();
    c.feed(twoFrames[0]);
    const crc = crc32(body);
    const forged = base45Encode(new Uint8Array([0x50, 0x54, 1, 0x02, crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff, 7]));
    expect(c.feed(forged)).toEqual({ kind: 'dropped' });
    // the group is gone: the second frame alone is a new start
    expect(c.feed(twoFrames[1])).toEqual({ kind: 'progress', have: 1, total: 2 });
  });

  it('holds at most four groups: a fifth evicts the least recently FED one', () => {
    const c = createPtsigCollector();
    c.feed(twoFrames[0]); // A
    c.feed(other(1));
    c.feed(other(2));
    c.feed(other(3));
    c.feed(other(4)); // evicts A (the least recently fed)
    expect(c.feed(twoFrames[1])).toEqual({ kind: 'progress', have: 1, total: 2 });
  });

  it('a group still being read is NOT evicted by junk: feeding it again makes it recent', () => {
    const c = createPtsigCollector();
    c.feed(twoFrames[0]); // A
    c.feed(other(1));
    c.feed(other(2));
    c.feed(other(3));
    c.feed(twoFrames[0]); // A read again → most recent
    c.feed(other(4)); // evicts other(1), not A
    expect(c.feed(twoFrames[1]).kind).toBe('done');
  });

  it('a frame total that disagrees within one crc drops the group AT ONCE (not "part 2 of 3" for a group that cannot decode)', () => {
    const c = createPtsigCollector();
    const crc = crc32(body);
    const firstOfThree = base45Encode(new Uint8Array([0x50, 0x54, 1, 0x03, crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff, 1]));
    expect(c.feed(firstOfThree)).toEqual({ kind: 'progress', have: 1, total: 3 });
    expect(c.feed(twoFrames[1])).toEqual({ kind: 'dropped' });
  });

  it('reset() forgets every group', () => {
    const c = createPtsigCollector();
    c.feed(twoFrames[0]);
    c.reset();
    expect(c.feed(twoFrames[1])).toEqual({ kind: 'progress', have: 1, total: 2 });
  });

  it('the limits it relies on are the codec’s', () => {
    expect(PTSIG_LIMITS.maxFrames).toBe(4);
  });
});
