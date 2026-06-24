/**
 * Link-URL sanitiser for overlay-text hyperlinks.
 *
 * Security: only web-safe schemes are allowed into a baked PDF `/URI` action — a
 * `javascript:` (or `data:` / `vbscript:` / `file:`) URI in a link annotation is an
 * injection vector, so anything that is not http/https/mailto (or a bare domain we can
 * safely upgrade to https) is rejected.
 */

const ALLOWED = /^(https?:|mailto:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// A bare domain-like token: contains a dot, no scheme, no whitespace (e.g. example.com/x).
const BARE_DOMAIN = /^[^\s:]+\.[^\s:]+$/;

/**
 * Returns a safe URL to embed, or `null` when the input is empty or uses a
 * non-web-safe scheme. A bare domain is upgraded to `https://`.
 */
export function sanitizeLinkUrl(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (ALLOWED.test(s)) return s;
  if (HAS_SCHEME.test(s)) return null; // some other scheme → reject
  if (BARE_DOMAIN.test(s)) return `https://${s}`;
  return null;
}
