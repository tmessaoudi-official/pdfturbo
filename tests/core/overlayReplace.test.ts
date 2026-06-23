import { describe, it, expect } from 'vitest';
import { applyReplacement } from '../../src/core/overlayReplace';

describe('applyReplacement (PDF overlay find & replace)', () => {
  it('replaces all literal occurrences, case-sensitive', () => {
    expect(applyReplacement('foo Foo foo', 'foo', 'bar', { caseSensitive: true, regex: false })).toBe('bar Foo bar');
  });
  it('replaces all literal occurrences, case-insensitive', () => {
    expect(applyReplacement('foo Foo FOO', 'foo', 'x', { caseSensitive: false, regex: false })).toBe('x x x');
  });
  it('treats $ in a LITERAL replacement literally (not a capture ref)', () => {
    expect(applyReplacement('price', 'price', '$5', { caseSensitive: false, regex: false })).toBe('$5');
  });
  it('supports regex with capture-group replacement ($1)', () => {
    expect(applyReplacement('2026-06', '(\\d{4})-(\\d{2})', '$2/$1', { caseSensitive: true, regex: true })).toBe('06/2026');
  });
  it('returns the text unchanged for empty query, invalid regex, or a ReDoS-unsafe pattern', () => {
    expect(applyReplacement('abc', '', 'x', { caseSensitive: false, regex: false })).toBe('abc');
    expect(applyReplacement('abc', '(', 'x', { caseSensitive: false, regex: true })).toBe('abc');
    expect(applyReplacement('aaa', '(a+)+', 'x', { caseSensitive: false, regex: true })).toBe('aaa');
  });
  it('reports whether anything changed via the returned string identity', () => {
    expect(applyReplacement('abc', 'z', 'y', { caseSensitive: false, regex: false })).toBe('abc');
  });
});
