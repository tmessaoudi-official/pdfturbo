/**
 * Shared URL-scheme allowlist (#QA-2026-06-23 P3). A URL carrying an explicit scheme is trusted
 * only when that scheme is http/https/mailto; a schemeless URL (relative path, anchor, query,
 * empty) is allowed. Rejects javascript:/data:/vbscript:/file:/etc.
 *
 * Obfuscation hardening: browsers strip ASCII tab/newline anywhere in a URL and trim leading C0
 * control chars BEFORE parsing the scheme, so `java<TAB>script:` or `<SOH>javascript:` would
 * otherwise execute. We drop every C0 control char (code point <= 0x1F) and trim before reading
 * the scheme — a legitimate URL never contains those, so this only defeats the obfuscation.
 *
 * Used by the PDF Link-annotation renderer (`textLayer`), the Word-paste sanitiser (`wordPaste`),
 * and the Markdown hyperlink writer (`safeMdUrl`).
 */
export function isAllowedUrlScheme(url: string): boolean {
  const cleaned = Array.from(url)
    .filter(c => c.charCodeAt(0) > 0x1f)
    .join('')
    .trim();
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  return !m || /^(https?|mailto)$/i.test(m[1]);
}
