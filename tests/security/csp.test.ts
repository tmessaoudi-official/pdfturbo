/**
 * M3 #32 — the app CSP must clamp `base-uri` and `form-action` so a markup
 * injection can neither rewrite the document base (hijacking every relative
 * asset URL) nor point form submissions at an attacker origin. Both are
 * directives that `default-src`/`script-src` do NOT cover, so they must be
 * stated explicitly. Parsed straight from the shipped index.html.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = resolve(__dirname, '../../index.html');

function cspContent(): string {
  const html = readFileSync(INDEX_HTML, 'utf8');
  // The attribute delimiter (group 1) differs from the single quotes inside the
  // CSP value ('self'/'none'), so capture up to the matching delimiter only.
  const m = html.match(/http-equiv=["']Content-Security-Policy["']\s+content=(["'])([\s\S]*?)\1/i);
  if (!m) throw new Error('no Content-Security-Policy meta tag found in index.html');
  return m[2];
}

describe('M3 #32 — CSP hardening directives', () => {
  it("declares base-uri 'none' (blocks <base> hijacking of relative URLs)", () => {
    expect(cspContent()).toMatch(/base-uri\s+'none'/);
  });

  it("declares form-action 'none' (this app has no server form target)", () => {
    expect(cspContent()).toMatch(/form-action\s+'none'/);
  });

  it('still keeps the existing object-src none + self default', () => {
    const csp = cspContent();
    expect(csp).toMatch(/object-src\s+'none'/);
    expect(csp).toMatch(/default-src\s+'self'/);
  });
});
