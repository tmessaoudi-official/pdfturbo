import { describe, expect, it } from 'vitest';
import {
  BYTE_RANGE_SENTINEL,
  byteRangeReplacement,
  collectSignedBytes,
  computeByteRange,
  findByteRangeToken,
  findContentsSlot,
  indexOfAscii,
  signatureToPaddedHex,
} from '../../src/signing/byteRange';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('indexOfAscii', () => {
  it('finds an ASCII needle', () => {
    expect(indexOfAscii(enc('hello /Contents world'), '/Contents')).toBe(6);
  });
  it('returns -1 when absent', () => {
    expect(indexOfAscii(enc('nothing here'), '/Contents')).toBe(-1);
  });
  it('respects the from offset', () => {
    expect(indexOfAscii(enc('aXaXa'), 'a', 1)).toBe(2);
  });
});

describe('findContentsSlot', () => {
  it('locates a /Contents <...> slot and reports hex length', () => {
    const slot = findContentsSlot(enc('<< /Type /Sig /Contents <0000> /X 1 >>'));
    const src = '<< /Type /Sig /Contents <0000> /X 1 >>';
    expect(src[slot.open]).toBe('<');
    expect(src[slot.close]).toBe('>');
    expect(slot.hexLength).toBe(4);
  });

  it('tolerates whitespace between key and "<"', () => {
    const slot = findContentsSlot(enc('/Contents   <ABCD>'));
    expect(slot.hexLength).toBe(4);
  });

  it('throws when /Contents is missing', () => {
    expect(() => findContentsSlot(enc('no signature dict here'))).toThrow();
  });

  it('throws when the closing ">" is missing', () => {
    expect(() => findContentsSlot(enc('/Contents <00000'))).toThrow();
  });
});

describe('computeByteRange', () => {
  it('spans the whole file except the hex payload (brackets included)', () => {
    // index:           0123456789...
    const src = 'AB/Contents <0000> CD';
    const slot = findContentsSlot(enc(src));
    const range = computeByteRange(slot, src.length);
    // open is at index of '<', len1 includes through '<'
    expect(range[0]).toBe(0);
    expect(range[1]).toBe(slot.open + 1);
    expect(range[2]).toBe(slot.close);
    expect(range[3]).toBe(src.length - slot.close);
    // The two spans together must skip exactly the 4 hex chars between < and >.
    expect(range[1] + range[3]).toBe(src.length - slot.hexLength);
  });
});

describe('findByteRangeToken', () => {
  it('locates the /ByteRange [ … ] token span', () => {
    const src = 'x /ByteRange [ 9999999999 9999999999 9999999999 9999999999 ] y';
    const tok = findByteRangeToken(enc(src));
    expect(src.slice(tok.start, tok.end)).toBe(
      '/ByteRange [ 9999999999 9999999999 9999999999 9999999999 ]',
    );
  });

  it('throws when /ByteRange is absent', () => {
    expect(() => findByteRangeToken(enc('no byterange here'))).toThrow();
  });
});

describe('byteRangeReplacement', () => {
  it('produces a string padded to EXACTLY the target length', () => {
    const sentinelToken = `/ByteRange [ ${BYTE_RANGE_SENTINEL} ${BYTE_RANGE_SENTINEL} ${BYTE_RANGE_SENTINEL} ${BYTE_RANGE_SENTINEL} ]`;
    const real = byteRangeReplacement([0, 840, 17224, 600], sentinelToken.length);
    expect(real.length).toBe(sentinelToken.length);
  });

  it('embeds the real numbers in pdf-lib array form', () => {
    const target = 80;
    const real = byteRangeReplacement([0, 840, 17224, 600], target);
    expect(real.startsWith('/ByteRange [ 0 840 17224 600 ]')).toBe(true);
  });

  it('throws when the real string is longer than the reserved span', () => {
    expect(() => byteRangeReplacement([0, 840, 17224, 600], 10)).toThrow();
  });
});

describe('collectSignedBytes', () => {
  it('concatenates the two covered spans, skipping the payload', () => {
    const src = enc('AB<CD>EF'); // skip indices 3..4 ('CD')
    // range: [0, 3, 5, 3] → 'AB<' + '>EF'
    const out = collectSignedBytes(src, [0, 3, 5, 3]);
    expect(new TextDecoder().decode(out)).toBe('AB<>EF');
  });
});

describe('signatureToPaddedHex', () => {
  it('hex-encodes and right-pads with zeros to capacity', () => {
    const hex = signatureToPaddedHex(new Uint8Array([0xde, 0xad]), 8);
    expect(hex).toBe('dead0000');
  });

  it('throws when the signature is larger than the slot', () => {
    expect(() => signatureToPaddedHex(new Uint8Array([1, 2, 3]), 4)).toThrow();
  });

  it('round-trips: padded hex length equals capacity', () => {
    const hex = signatureToPaddedHex(new Uint8Array([1, 2, 3, 4]), 32);
    expect(hex.length).toBe(32);
  });
});
