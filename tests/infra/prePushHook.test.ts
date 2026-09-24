/**
 * M4 #40 — pushing to master auto-deploys to GitHub Pages with NO PR gate, and
 * the test suite otherwise runs only in CI *after* that push. The tracked
 * pre-push hook runs the three FAST gates locally first. These guard that the hook
 * exists, runs all three of them, and is auto-installed via `prepare`
 * (core.hooksPath) — and that the pinned Node version stays consistent.
 *
 * It is NOT the exact CI gate, which this header used to claim and which these cases could never
 * have caught: they assert exactly the three steps the hook runs, so the assertion and the claim
 * agreed with each other while both disagreed with `deploy.yml` (audit, ocr:assets, test:browser,
 * test:coverage:export, build and qa:sweep are also deploy-blocking). A guard that pins the same
 * three things the prose claims is not evidence the prose is true. [WS5 audit, 2026-09-04]
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('M4 #40 — pre-push gate', () => {
  it('the pre-push hook runs type-check, lint and test', () => {
    const hook = read('.githooks/pre-push');
    expect(hook).toMatch(/npm run type-check/);
    expect(hook).toMatch(/npm run lint/);
    expect(hook).toMatch(/npm run test\b/);
    expect(hook).toMatch(/^set -euo pipefail$/m); // abort on first failure
  });

  it('the hook is executable', () => {
    // Owner-execute bit set so git can run it.
    expect(statSync(resolve(ROOT, '.githooks/pre-push')).mode & 0o100).not.toBe(0);
  });

  it('package.json auto-installs the hook via prepare (core.hooksPath)', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.prepare).toMatch(/core\.hooksPath\s+\.githooks/);
  });

  // Node 26 by developer ruling 2026-09-24 (was 24). CI, .nvmrc and engines move TOGETHER: the local
  // gate runs on the .nvmrc line, so a deploy.yml that drifts from it makes a green local run say
  // nothing about CI — the 2026-09-13 localStorage red was exactly a Node-line mismatch.
  it('pins Node 26 in engines and .nvmrc, and deploy.yml uses the same line', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.engines?.node).toBe('>=26');
    const nvmrc = read('.nvmrc').trim();
    expect(nvmrc).toBe('26');
    const versions = [...read('.github/workflows/deploy.yml').matchAll(/node-version:\s*['"]?([^\s'"]+)/g)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(v).toBe(nvmrc);
  });
});
