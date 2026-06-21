import { describe, it, expect } from 'vitest';
import { applyTextCase } from '../../src/utils/textCase';

describe('applyTextCase', () => {
  it('uppercases / lowercases', () => {
    expect(applyTextCase('aB cD', 'upper')).toBe('AB CD');
    expect(applyTextCase('aB cD', 'lower')).toBe('ab cd');
  });

  it('title-cases each whitespace-delimited word, preserving newlines/spacing', () => {
    expect(applyTextCase('hello   world', 'title')).toBe('Hello   World');
    expect(applyTextCase('one two\nthree', 'title')).toBe('One Two\nThree');
  });

  it('handles empty strings and whitespace-only strings', () => {
    expect(applyTextCase('', 'title')).toBe('');
    expect(applyTextCase('   ', 'title')).toBe('   ');
    expect(applyTextCase('\n\n', 'title')).toBe('\n\n');
  });

  it('handles single character words', () => {
    expect(applyTextCase('a b c', 'title')).toBe('A B C');
    expect(applyTextCase('a', 'upper')).toBe('A');
    expect(applyTextCase('A', 'lower')).toBe('a');
  });

  it('preserves mixed whitespace in title case', () => {
    expect(applyTextCase('hello\t\nworld', 'title')).toBe('Hello\t\nWorld');
    expect(applyTextCase('a\r\nb', 'title')).toBe('A\r\nB');
  });
});
