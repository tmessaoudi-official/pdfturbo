/**
 * Task 1 — pure find/replace matching core. Builds ProseMirror docs with docxSchema
 * and asserts findMatches() over the flattened per-textblock string (so a match can
 * span runs/marks), plus capture-group replacement expansion. No DOM needed.
 */
import { describe, it, expect } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { docxSchema as s } from '../../src/docx/docxSchema';
import { findMatches, expandReplacement, MAX_MATCHES, type FindOptions } from '../../src/docx/findReplace';

const PLAIN: FindOptions = { caseSensitive: false, wholeWord: false, regex: false };
const opt = (o: Partial<FindOptions>): FindOptions => ({ ...PLAIN, ...o });

function para(...children: PMNode[]): PMNode {
  return s.node('paragraph', null, children.length ? children : undefined);
}
function doc(...blocks: PMNode[]): PMNode {
  return s.node('doc', null, blocks);
}
function bold(text: string): PMNode {
  return s.text(text, [s.marks.strong.create()]);
}

function matchesOf(d: PMNode, q: string, o: FindOptions) {
  const r = findMatches(d, q, o);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.matches;
}

describe('findReplace — findMatches', () => {
  it('finds every plain occurrence (case-insensitive default)', () => {
    const m = matchesOf(doc(para(s.text('a b a b'))), 'a', PLAIN);
    expect(m.map(x => x.from)).toEqual([1, 5]);
  });

  it('case-sensitive toggle narrows matches', () => {
    const d = doc(para(s.text('Foo foo')));
    expect(matchesOf(d, 'foo', opt({ caseSensitive: false }))).toHaveLength(2);
    const cs = matchesOf(d, 'foo', opt({ caseSensitive: true }));
    expect(cs).toHaveLength(1);
    expect(cs[0].from).toBe(5); // the lowercase "foo" after the space
  });

  it('whole-word rejects matches inside larger words', () => {
    const m = matchesOf(doc(para(s.text('cat category'))), 'cat', opt({ wholeWord: true }));
    expect(m).toHaveLength(1);
    expect(m[0].from).toBe(1); // standalone "cat", not the "cat" in "category"
  });

  it('regex mode matches and captures groups', () => {
    const m = matchesOf(doc(para(s.text('2026-06-20'))), '(\\d{4})-(\\d{2})', opt({ regex: true }));
    expect(m).toHaveLength(1);
    expect(m[0].groups).toEqual(['2026', '06']);
  });

  it('invalid regex returns a typed error, never throws', () => {
    const r = findMatches(doc(para(s.text('x'))), '(', opt({ regex: true }));
    expect(r).toEqual({ ok: false, error: 'invalid-regex' });
  });

  it('empty query returns empty-query error', () => {
    expect(findMatches(doc(para(s.text('x'))), '', PLAIN)).toEqual({ ok: false, error: 'empty-query' });
  });

  it('matches a span that crosses marks (bold + plain)', () => {
    const m = matchesOf(doc(para(bold('Hel'), s.text('lo'))), 'Hello', PLAIN);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ from: 1, to: 6 });
  });

  it('does not match across a paragraph boundary', () => {
    const d = doc(para(s.text('Hello')), para(s.text('World')));
    expect(matchesOf(d, 'HelloWorld', PLAIN)).toHaveLength(0);
    expect(matchesOf(d, 'lloWor', PLAIN)).toHaveLength(0);
  });

  it('finds matches in a later block at the correct position', () => {
    const d = doc(para(s.text('Hello')), para(s.text('World')));
    const m = matchesOf(d, 'World', PLAIN);
    expect(m).toHaveLength(1);
    expect(m[0].from).toBe(8); // para1 nodeSize 7 → para2 content starts at 8
  });

  it('caps a broad query at MAX_MATCHES and flags truncation', () => {
    // A single block with more occurrences than the cap (e.g. typing "." in regex
    // mode, or a long repeated run) must not accumulate unbounded matches/decorations.
    const d = doc(para(s.text('a'.repeat(MAX_MATCHES + 100))));
    const r = findMatches(d, 'a', PLAIN);
    if (!r.ok) throw new Error('expected ok');
    expect(r.matches).toHaveLength(MAX_MATCHES);
    expect(r.truncated).toBe(true);
  });

  it('does not flag truncation when matches fit under the cap', () => {
    const r = findMatches(doc(para(s.text('a a a'))), 'a', PLAIN);
    if (!r.ok) throw new Error('expected ok');
    expect(r.matches).toHaveLength(3);
    expect(r.truncated).toBeFalsy();
  });

  it('caps a broad regex query at MAX_MATCHES too', () => {
    const d = doc(para(s.text('x'.repeat(MAX_MATCHES + 50))));
    const r = findMatches(d, '.', opt({ regex: true }));
    if (!r.ok) throw new Error('expected ok');
    expect(r.matches).toHaveLength(MAX_MATCHES);
    expect(r.truncated).toBe(true);
  });
});

describe('findReplace — expandReplacement', () => {
  it('expands $1/$2 from capture groups', () => {
    expect(expandReplacement('$2/$1', ['a', 'b'])).toBe('b/a');
  });
  it('returns the template unchanged when there are no groups', () => {
    expect(expandReplacement('plain', undefined)).toBe('plain');
  });
  it('replaces a missing group with empty string', () => {
    expect(expandReplacement('$1$3', ['a', 'b'])).toBe('a');
  });
});
