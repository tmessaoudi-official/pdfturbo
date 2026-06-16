/**
 * M3 #35 — every interactive <button> in index.html must expose an accessible
 * name to assistive tech: either visible alphanumeric text, or an explicit
 * aria-label / title / data-i18n / data-i18n-aria. An icon/emoji-only button
 * (e.g. "🖊 ▾") with none of these is announced as garbage by a screen reader.
 *
 * This is the durable guard for the whole class — adding a new icon-only button
 * without a label fails here, not just in manual SR testing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = resolve(__dirname, '../../index.html');

interface Btn { open: string; inner: string; }

function buttons(): Btn[] {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const out: Btn[] = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    out.push({ open: m[1], inner: m[2] });
  }
  return out;
}

/** A button has an accessible name via an explicit attribute or via visible alphanumeric text. */
function hasAccessibleName(b: Btn): boolean {
  if (/\b(aria-label|title|data-i18n|data-i18n-aria)\b/.test(b.open)) return true;
  const text = b.inner.replace(/<[^>]*>/g, ''); // strip nested tags
  return /[A-Za-z0-9؀-ۿ]/.test(text); // latin/arabic letters or digits = a real name
}

describe('M3 #35 — every button has an accessible name', () => {
  it('parses a non-trivial number of buttons from index.html', () => {
    expect(buttons().length).toBeGreaterThan(50);
  });

  it('leaves no icon/emoji-only button without an accessible name', () => {
    const unnamed = buttons()
      .filter((b) => !hasAccessibleName(b))
      .map((b) => b.open.trim().slice(0, 80));
    expect(unnamed).toEqual([]);
  });
});
