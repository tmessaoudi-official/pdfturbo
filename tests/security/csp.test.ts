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

describe('pad.html (phone-signature-pad step 4) — the same CSP, a base-path icon, no service worker', () => {
  const PAD_HTML = resolve(__dirname, '../../pad.html');
  const csp = (file: string) => {
    const m = readFileSync(file, 'utf8').match(/http-equiv=["']Content-Security-Policy["']\s+content=(["'])([\s\S]*?)\1/i);
    if (!m) throw new Error(`no Content-Security-Policy meta tag in ${file}`);
    return m[2];
  };

  it('carries exactly the CSP of index.html (a second page must not be a weaker door)', () => {
    expect(csp(PAD_HTML)).toBe(csp(INDEX_HTML));
  });

  it('links its icon relative to the base path (a root /favicon.ico would 404 under /pdfturbo/)', () => {
    expect(readFileSync(PAD_HTML, 'utf8')).toMatch(/<link rel="icon"[^>]*href="\.\/icon\.svg"/);
  });

  it('its entry never registers the service worker (the phone must not download the editor)', () => {
    const html = readFileSync(PAD_HTML, 'utf8');
    const src = html.match(/<script type="module" src="([^"]+)"/)?.[1];
    expect(src).toBe('/src/padMain.ts');
    expect(readFileSync(resolve(__dirname, '../..', 'src/padMain.ts'), 'utf8')).not.toMatch(/pwa-register|serviceWorker/);
  });
});
