import {
  decodeSignatureFrames,
  PtsigError,
  readFrameHeader,
  type DecodedSignature,
  type FrameHeader,
  type PtsigErrorCode,
} from './signatureStrokes';

/**
 * Phone-signature-pad step 5b: turns the camera's stream of QR texts into ONE decoded signature.
 *
 * The camera reads each code many times, in any order, and may see a stray code (another QR on the desk, a misread).
 * Frames are grouped by their sequence id (the body CRC); a group decodes once every frame of it was read. A misread
 * or a broken group is DROPPED and scanning goes on; the scanner only stops on `done`. The text is never trimmed or
 * re-cased: a base45 frame may start or end with a space (plan, step-2 findings).
 */
export type CollectorEvent =
  | { kind: 'done'; sig: DecodedSignature }
  /** Frames of the group just fed that were read so far, out of its total. */
  | { kind: 'progress'; have: number; total: number }
  /** A PTSIG frame of another format version: the phone page is out of date. */
  | { kind: 'refresh' }
  /** Not a PTSIG frame at all. */
  | { kind: 'foreign' }
  /** A PTSIG group that cannot decode (a misread, or a forged/broken body): forgotten. */
  | { kind: 'dropped' };

export interface PtsigCollector {
  feed(text: string): CollectorEvent;
  reset(): void;
}

/** How a frame that fails its HEADER read is shown — every code listed, so a new code is a compile error here. */
const FRAME_ERROR: Record<PtsigErrorCode, 'foreign' | 'refresh'> = {
  base45: 'foreign',
  'too-large': 'foreign',
  truncated: 'foreign',
  magic: 'foreign',
  version: 'refresh',
  range: 'foreign',
  // the header read never throws these (they are body or group errors); listed for exhaustiveness
  mixed: 'foreign',
  incomplete: 'foreign',
  crc: 'foreign',
  limit: 'foreign',
  trailing: 'foreign',
  empty: 'foreign',
};

/** Groups held at once; the least recently FED is evicted, so junk codes cannot push out the signature being read. */
export const MAX_GROUPS = 4;

interface Group {
  total: number;
  texts: Map<number, string>;
}

export function createPtsigCollector(): PtsigCollector {
  // Map iteration order is insertion order: re-inserting a group on every feed makes the first key the least recent.
  const groups = new Map<number, Group>();

  const feed = (text: string): CollectorEvent => {
    let head: FrameHeader;
    try {
      head = readFrameHeader(text);
    } catch (e) {
      if (!(e instanceof PtsigError)) throw e;
      return { kind: FRAME_ERROR[e.code] };
    }
    const group = groups.get(head.crc) ?? { total: head.total, texts: new Map<number, string>() };
    groups.delete(head.crc);
    const seen = group.texts.get(head.index);
    if (group.total !== head.total || (seen !== undefined && seen !== text)) return { kind: 'dropped' };
    group.texts.set(head.index, text);
    if (group.texts.size < group.total) {
      groups.set(head.crc, group);
      if (groups.size > MAX_GROUPS) groups.delete(groups.keys().next().value as number);
      return { kind: 'progress', have: group.texts.size, total: group.total };
    }
    try {
      return { kind: 'done', sig: decodeSignatureFrames([...group.texts.values()]) };
    } catch (e) {
      if (!(e instanceof PtsigError)) throw e;
      return { kind: 'dropped' };
    }
  };

  return { feed, reset: () => groups.clear() };
}
