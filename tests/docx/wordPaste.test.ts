/**
 * cleanWordHtml — pure sanitiser for HTML pasted from Word/Google Docs/web.
 * jsdom provides DOMParser, so the cleaner is fully unit-testable here.
 */
import { describe, it, expect } from 'vitest';
import { cleanWordHtml } from '../../src/docx/wordPaste';

describe('cleanWordHtml', () => {
  it('strips mso style declarations but keeps real formatting', () => {
    const dirty = '<p style="mso-margin-top-alt:auto;font-size:14pt"><b>Hi</b></p>';
    const out = cleanWordHtml(dirty);
    expect(out).not.toMatch(/mso-/);
    expect(out).toMatch(/font-size:\s*14pt/);
    expect(out).toMatch(/<b>Hi<\/b>/);
  });

  it('removes <o:p>, <xml>, <style>, <meta> and namespaced office tags', () => {
    const dirty = '<xml>junk</xml><style>.a{}</style><p>Keep<o:p></o:p></p>';
    const out = cleanWordHtml(dirty);
    expect(out).not.toMatch(/<o:p|<xml|<style|<meta/i);
    expect(out).toMatch(/Keep/);
  });

  it('unwraps downlevel-revealed list conditionals and removes hidden ones', () => {
    const dirty =
      '<![if !supportLists]><span>1.</span><![endif]>' +
      '<!--[if gte mso 9]><junk></junk><![endif]-->';
    const out = cleanWordHtml(dirty);
    expect(out).toMatch(/1\./); // revealed content survives
    expect(out).not.toMatch(/junk/); // hidden block removed
    expect(out).not.toMatch(/\[if|\[endif\]/i);
  });

  it('removes empty MsoNormal paragraphs', () => {
    const dirty = '<p class="MsoNormal">&nbsp;</p><p>Real</p>';
    const out = cleanWordHtml(dirty);
    expect(out).not.toMatch(/MsoNormal/);
    expect(out.match(/<p/g)?.length ?? 0).toBe(1);
    expect(out).toMatch(/Real/);
  });

  it('keeps headings, lists, links, underline, font-family', () => {
    const dirty =
      '<h2>T</h2><ul><li>a</li></ul>' +
      '<a href="https://x.test">L</a>' +
      "<u>u</u><span style=\"font-family:'Calibri',sans-serif\">f</span>";
    const out = cleanWordHtml(dirty);
    expect(out).toMatch(/<h2>T<\/h2>/);
    expect(out).toMatch(/<li>a<\/li>/);
    expect(out).toMatch(/href="https:\/\/x\.test"/);
    expect(out).toMatch(/<u>u<\/u>/);
    expect(out).toMatch(/font-family/);
  });

  it('drops file:// and src-less images, keeps data: images', () => {
    const dirty =
      '<img src="file:///C:/a.png">' + '<img>' + '<img src="data:image/png;base64,AAAA">';
    const out = cleanWordHtml(dirty);
    expect(out).not.toMatch(/file:\/\//);
    expect(out).toMatch(/data:image\/png/);
    expect(out.match(/<img/g)?.length ?? 0).toBe(1);
  });

  it('is total: empty, plain-text, and malformed input never throw', () => {
    expect(cleanWordHtml('')).toBe('');
    expect(cleanWordHtml('just text')).toMatch(/just text/);
    expect(() => cleanWordHtml('<p><b>unclosed')).not.toThrow();
  });

  // ── QA-2026-06-23 P2 — image src allowlist ──
  it('keeps raster data: images and remote http(s) images', () => {
    expect(cleanWordHtml('<p><img src="data:image/png;base64,iVBORw0K"></p>')).toMatch(/<img/);
    expect(cleanWordHtml('<p><img src="https://cdn.example.com/a.png"></p>')).toMatch(/<img/);
  });
  it('drops data:image/svg+xml (script vector) and non-image data: URLs', () => {
    expect(cleanWordHtml('<p><img src="data:image/svg+xml,<svg onload=alert(1)>"></p>')).not.toMatch(/<img/);
    expect(cleanWordHtml('<p><img src="data:text/html,plain"></p>')).not.toMatch(/<img/);
  });
  it('drops oversized data: image payloads', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(5_000_001);
    expect(cleanWordHtml(`<p><img src="${huge}"></p>`)).not.toMatch(/<img/);
  });

  // ── QA-2026-06-23 P3 (#15) — anchor href scheme allowlist ──
  it('keeps http(s)/mailto anchor hrefs', () => {
    expect(cleanWordHtml('<a href="https://x.test">L</a>')).toMatch(/href="https:\/\/x\.test"/);
    expect(cleanWordHtml('<a href="mailto:a@b.test">M</a>')).toMatch(/href="mailto:a@b\.test"/);
  });
  it('drops javascript:/data: anchor hrefs but keeps the link text', () => {
    const js = cleanWordHtml('<a href="javascript:alert(1)">Click</a>');
    expect(js).not.toMatch(/href=/);
    expect(js).toMatch(/Click/);
    expect(cleanWordHtml('<a href="data:text/html,x">D</a>')).not.toMatch(/href=/);
  });
});
