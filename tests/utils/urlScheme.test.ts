import { describe, it, expect } from 'vitest';
import { isAllowedUrlScheme } from '../../src/utils/urlScheme';

describe('isAllowedUrlScheme', () => {
  it('allows http, https, mailto (case-insensitive)', () => {
    expect(isAllowedUrlScheme('http://x.test')).toBe(true);
    expect(isAllowedUrlScheme('https://x.test/a?b=1#c')).toBe(true);
    expect(isAllowedUrlScheme('mailto:a@b.test')).toBe(true);
    expect(isAllowedUrlScheme('HTTPS://X.TEST')).toBe(true);
  });

  it('allows schemeless relative / anchor / query / empty URLs', () => {
    expect(isAllowedUrlScheme('/page')).toBe(true);
    expect(isAllowedUrlScheme('#section')).toBe(true);
    expect(isAllowedUrlScheme('foo/bar.html')).toBe(true);
    expect(isAllowedUrlScheme('?q=1')).toBe(true);
    expect(isAllowedUrlScheme('')).toBe(true);
  });

  it('blocks javascript / data / vbscript / file schemes', () => {
    expect(isAllowedUrlScheme('javascript:alert(1)')).toBe(false);
    expect(isAllowedUrlScheme('data:text/html,<script>x</script>')).toBe(false);
    expect(isAllowedUrlScheme('vbscript:msgbox(1)')).toBe(false);
    expect(isAllowedUrlScheme('file:///etc/passwd')).toBe(false);
    expect(isAllowedUrlScheme('JaVaScRiPt:alert(1)')).toBe(false);
  });

  it('blocks control-char / whitespace obfuscated schemes (browsers strip those before parsing)', () => {
    expect(isAllowedUrlScheme('java\tscript:alert(1)')).toBe(false);
    expect(isAllowedUrlScheme('java\nscript:alert(1)')).toBe(false);
    expect(isAllowedUrlScheme('javascript:alert(1)')).toBe(false);
    expect(isAllowedUrlScheme('  javascript:alert(1)')).toBe(false);
  });
});
