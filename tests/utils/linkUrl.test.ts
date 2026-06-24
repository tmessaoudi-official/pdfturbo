import { describe, it, expect } from 'vitest';
import { sanitizeLinkUrl } from '../../src/utils/linkUrl';

describe('sanitizeLinkUrl', () => {
  it('passes http and https URLs through', () => {
    expect(sanitizeLinkUrl('http://example.com')).toBe('http://example.com');
    expect(sanitizeLinkUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });
  it('passes mailto links', () => {
    expect(sanitizeLinkUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
  });
  it('upgrades a bare domain to https', () => {
    expect(sanitizeLinkUrl('example.com')).toBe('https://example.com');
    expect(sanitizeLinkUrl('  github.com/x  ')).toBe('https://github.com/x');
  });
  it('rejects javascript: and other dangerous schemes', () => {
    expect(sanitizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeLinkUrl('JavaScript:alert(1)')).toBeNull();
    expect(sanitizeLinkUrl('data:text/html,x')).toBeNull();
    expect(sanitizeLinkUrl('vbscript:x')).toBeNull();
    expect(sanitizeLinkUrl('file:///etc/passwd')).toBeNull();
  });
  it('rejects empty / whitespace / non-url text', () => {
    expect(sanitizeLinkUrl('')).toBeNull();
    expect(sanitizeLinkUrl('   ')).toBeNull();
    expect(sanitizeLinkUrl('just some words')).toBeNull();
  });
});
