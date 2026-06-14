/**
 * Sprint 3 batch 2 — Gap 7: DOCX image encoding choice (PNG bloat → JPEG for photos).
 * Pure decision function; the canvas-side alpha sampling + toDataURL is browser-tested.
 */
import { describe, it, expect } from 'vitest';
import { pickImageMime } from '../../src/utils/flowDoc';

describe('pickImageMime', () => {
  it('keeps PNG for images with an alpha channel (JPEG has no transparency)', () => {
    expect(pickImageMime({ width: 800, height: 600, hasAlpha: true })).toBe('image/png');
  });

  it('re-encodes large opaque rasters as JPEG (avoids multi-MB lossless PNG)', () => {
    expect(pickImageMime({ width: 800, height: 600, hasAlpha: false })).toBe('image/jpeg');
  });

  it('keeps PNG for small opaque images (crisp icons / line-art)', () => {
    expect(pickImageMime({ width: 64, height: 64, hasAlpha: false })).toBe('image/png');
  });

  it('treats exactly 200×200 opaque as JPEG (threshold inclusive)', () => {
    expect(pickImageMime({ width: 200, height: 200, hasAlpha: false })).toBe('image/jpeg');
  });

  it('keeps PNG for a large image WITH alpha (transparency beats size)', () => {
    expect(pickImageMime({ width: 2000, height: 2000, hasAlpha: true })).toBe('image/png');
  });
});
