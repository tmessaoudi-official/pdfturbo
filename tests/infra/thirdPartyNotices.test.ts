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
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
const deps = pkg.dependencies;
const declared: Record<string, string> = { ...pkg.devDependencies, ...pkg.dependencies };
const notices = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
const lockPackages: Record<string, { version?: string }> = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')).packages;

/** package name → every version the lockfile installs it at (any depth, dev or not: a devDependency such as
 * @pdf-lib/fontkit is still bundled, and its pako with it). */
function lockVersions(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [path, entry] of Object.entries(lockPackages)) {
    if (!path || !entry.version) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    out.set(name, (out.get(name) ?? new Set()).add(entry.version));
  }
  return out;
}

/** The two "Bundled transitively" sections and the "not bundled" paragraph after them, up to the font. */
function transitiveText(): string {
  const start = notices.indexOf('### Bundled transitively');
  const end = notices.indexOf('## Bundled font');
  if (start < 0 || end < start) throw new Error('THIRD-PARTY-NOTICES.md: transitive sections not found');
  return notices.slice(start, end);
}

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

  it('each listed range is the one package.json declares — a bundled devDependency (@pdf-lib/fontkit) included', () => {
    const drift = Object.entries(declared)
      .filter(([name, range]) => listed.has(name) && listed.get(name) !== range)
      .map(([name, range]) => `${name}: notices ${listed.get(name)}, package.json ${range}`);
    expect(drift).toEqual([]);
  });

  it('every section names a package package.json declares (a removed dependency leaves the notices)', () => {
    expect([...listed.keys()].filter(name => !(name in declared))).toEqual([]);
  });

  // Completeness lens, panel round 1 (2026-11-15): seventeen transitive packages had left the lockfile with docx's
  // jszip on 2026-11-10 and stayed listed, nanoid read 5.1.16 against the lock's 6.0.1, and nothing compared them.
  it('every transitive package listed with a version is in package-lock.json at that version', () => {
    const lock = lockVersions();
    const stale = [...transitiveText().matchAll(/\*\*(@?[a-z0-9][\w./-]*)\*\* (\d[\w.-]*)/g)]
      .filter(([, name, version]) => !lock.get(name)?.has(version))
      .map(([, name, version]) => `${name} ${version} (lock: ${[...(lock.get(name) ?? [])].join(', ') || 'absent'})`);
    expect(stale).toEqual([]);
  });

  it('every package named as "not bundled" is in package-lock.json', () => {
    const lock = lockVersions();
    const para = transitiveText().slice(transitiveText().indexOf('**not bundled**'));
    const named = [...para.matchAll(/`(@?[a-z0-9][\w./-]*)`/g)].map(m => m[1]).filter(n => /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9.-]*$/.test(n)); // npm names: lowercase, no path
    expect(named.length).toBeGreaterThanOrEqual(10);
    expect(named.filter(n => !lock.has(n))).toEqual([]);
  });

  it('non-vacuity: the parse finds the pdf.js and ProseMirror sections', () => {
    expect(listed.has('pdfjs-dist')).toBe(true);
    expect(listed.has('prosemirror-view')).toBe(true);
    expect(listed.size).toBeGreaterThanOrEqual(Object.keys(deps).length);
    expect(listed.has('@pdf-lib/fontkit')).toBe(true);
    expect(lockVersions().get('pdfjs-dist')?.size).toBe(1);
    expect([...transitiveText().matchAll(/\*\*(@?[a-z0-9][\w./-]*)\*\* \d/g)].length).toBeGreaterThanOrEqual(15);
  });
});
