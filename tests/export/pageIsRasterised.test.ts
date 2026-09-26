/**
 * Limits row 16 — `pageIsRasterised` is the ONE decision whether the assembly rebuilds a page as an image. The export
 * branches on it and so does the sign-rect prefill, which must land on the page the signer sees.
 */
import { describe, it, expect } from 'vitest';
import { pageIsRasterised } from '../../src/export/exportPipeline';

const page = (sourcePdfId = 's1') => ({ id: 'p1', sourcePdfId });

describe('pageIsRasterised', () => {
  it('a source page with a redaction on it is rasterised', () => {
    expect(pageIsRasterised(page(), [{ pageId: 'p1', type: 'text' }, { pageId: 'p1', type: 'redaction' }])).toBe(true);
  });
  it('a redaction on ANOTHER page does not count', () => {
    expect(pageIsRasterised(page(), [{ pageId: 'p2', type: 'redaction' }, { pageId: 'p1', type: 'text' }])).toBe(false);
  });
  it('a page with no redaction is copied', () => {
    expect(pageIsRasterised(page(), [{ pageId: 'p1', type: 'highlight' }])).toBe(false);
  });
  it('a BLANK page is never rasterised — its redactions drop the covered elements instead', () => {
    expect(pageIsRasterised(page('blank'), [{ pageId: 'p1', type: 'redaction' }])).toBe(false);
  });
});
