/**
 * THIRD-PARTY-NOTICES.md names the version range of every runtime dependency it lists. Nothing tied it to
 * `package.json`, and by 2026-11-14 ten of its lines had drifted across three upgrades (pdfjs-dist still read
 * `^6.3.289`, i18next `^26.4.2`) — found by the dependency-upgrade-2026-11 6C pass. This pins each listed range to the
 * one `package.json` declares, and every runtime dependency to a section, so a bump that forgets the notices fails here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const deps: Record<string, string> = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies;
const notices = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');

/** package name → the range the notices give for it, from each `### <name>` section's Version(s) line. */
function listedRanges(): Map<string, string> {
  const out = new Map<string, string>();
  for (const section of notices.split(/^### /m).slice(1)) {
    const head = section.split('\n', 1)[0].split(/\s/, 1)[0].toLowerCase();
    const single = /^- \*\*Version\*\*: (\S+) ·/m.exec(section);
    const multi = /^- \*\*Versions\*\*: (.+)$/m.exec(section);
    if (head === 'prosemirror' && multi) {
      for (const part of multi[1].split(' · ')) {
        const [sub, range] = part.trim().split(/\s+/);
        out.set(`prosemirror-${sub}`, range);
      }
    } else if (single) out.set(head, single[1]);
  }
  return out;
}

describe('THIRD-PARTY-NOTICES.md follows package.json', () => {
  const listed = listedRanges();

  it('every runtime dependency has a section', () => {
    expect(Object.keys(deps).filter(d => !listed.has(d))).toEqual([]);
  });

  it('each listed range is the one package.json declares', () => {
    const drift = Object.entries(deps)
      .filter(([name, range]) => listed.has(name) && listed.get(name) !== range)
      .map(([name, range]) => `${name}: notices ${listed.get(name)}, package.json ${range}`);
    expect(drift).toEqual([]);
  });

  it('non-vacuity: the parse finds the pdf.js and ProseMirror sections', () => {
    expect(listed.has('pdfjs-dist')).toBe(true);
    expect(listed.has('prosemirror-view')).toBe(true);
    expect(listed.size).toBeGreaterThanOrEqual(Object.keys(deps).length);
  });
});
