// The QA sweep's phone pad pass detects a BUILT app by sw.js's body; with no built worker it records the worker checks
// as SKIP (right on a dev server). In CI that SKIP would be silent: a build that stopped emitting the worker would turn
// "the pad is not precached" into a SKIP and still pass. `--require-sw` makes it a FAIL, and the deploy gate passes it
// (milestone panel round 1, 2026-11-11). The behaviour is proven by running the sweep against a dev server with the
// flag (the plan records the red run); these pin the wiring.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
const sweep = readFileSync('scripts/qa-sweep.mjs', 'utf8');

describe('--require-sw', () => {
  it('the deploy gate runs the sweep with --require-sw (and --allow-destructive)', () => {
    const lines = deploy.split('\n').filter((l) => /npm run qa:sweep\b/.test(l) && !l.trim().startsWith('#'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\s--require-sw(\s|$)/);
    expect(lines[0]).toMatch(/\s--allow-destructive(\s|$)/);
  });

  it('the sweep parses the flag and turns the no-worker SKIP into a FAIL with it', () => {
    // Bound (round 2): text pins. `has` and `argv` are pinned too, so a `has` that ignores its argument goes red; the
    // FAIL itself is proven by the recorded live run, not by a test (driving it needs a build with no worker).
    expect(sweep).toMatch(/^const argv = process\.argv\.slice\(2\);$/m);
    expect(sweep).toMatch(/^const has = n => argv\.includes\(n\);$/m);
    expect(sweep).toMatch(/const REQUIRE_SW = has\('--require-sw'\);/);
    expect(sweep).toMatch(/record\(REQUIRE_SW \? 'FAIL' : 'SKIP', 'pad: service worker'/);
  });
});
