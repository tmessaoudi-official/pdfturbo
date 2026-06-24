import { describe, it, expect } from 'vitest';
import { listMarker, applyListMarkers } from '../../src/utils/listMarkers';

describe('listMarker', () => {
  it('returns a bullet marker (ordinal ignored)', () => {
    expect(listMarker('bullet', 1)).toBe('• ');
    expect(listMarker('bullet', 7)).toBe('• ');
  });
  it('returns a 1-based ordered marker', () => {
    expect(listMarker('ordered', 1)).toBe('1. ');
    expect(listMarker('ordered', 12)).toBe('12. ');
  });
});

describe('applyListMarkers', () => {
  it('prefixes a bullet to each non-empty line', () => {
    expect(applyListMarkers('a\nb', 'bullet')).toEqual(['• a', '• b']);
  });
  it('numbers ordered lines 1-based', () => {
    expect(applyListMarkers('a\nb\nc', 'ordered')).toEqual(['1. a', '2. b', '3. c']);
  });
  it('counts ordinals over non-empty lines only; blanks pass through', () => {
    expect(applyListMarkers('a\n\nb', 'ordered')).toEqual(['1. a', '', '2. b']);
  });
  it('handles a single line', () => {
    expect(applyListMarkers('hello', 'bullet')).toEqual(['• hello']);
  });
  it('handles the empty string', () => {
    expect(applyListMarkers('', 'ordered')).toEqual(['']);
  });
});
