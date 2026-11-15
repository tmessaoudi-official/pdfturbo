// The QA sweep's "signature: draw → clear → cancel" scenario (R4-3, ruled 2026-11-12 22:57) is the only route by which
// the deploy gate clicks the ✍ modal's Clear and Cancel: with phonePad ON the crawl finds both hidden (panel round 4
// K12). Removing it, or leaving it defined but never run, would leave the gate green with two controls silently gone
// (phone-signature-pad row 8, panel round 5 K3). These pin the wiring; the scenario's behaviour is proven by the
// recorded sweep runs (var/claude/r4-3/), not here — driving it needs a browser and a served app.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sweep = readFileSync('scripts/qa-sweep.mjs', 'utf8');
const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
const NAME = "name: 'signature: draw → clear → cancel'";

/** The `scenarios` array literal: from its opening to the `picked` selection that follows it. */
function scenariosArray(): string {
  const start = sweep.indexOf('const scenarios = [');
  const end = sweep.indexOf('const picked = SCENARIO_ONLY', start);
  expect([start > 0, end > start]).toEqual([true, true]);
  return sweep.slice(start, end);
}

describe('the sweep runs the signature scenario and records Clear and Cancel', () => {
  it('the scenario is an element of the scenarios array — not a definition beside it', () => {
    expect(sweep.split(NAME)).toHaveLength(2); // defined exactly once
    expect(scenariosArray()).toContain(NAME);
  });

  it('it clicks and records BOTH controls, in that order, through control()', () => {
    const arr = scenariosArray();
    const body = arr.slice(arr.indexOf(NAME));
    const next = body.indexOf('\n      {\n        name:', 1); // the next scenario, if any comes after it
    const own = next > 0 ? body.slice(0, next) : body;
    const clear = own.indexOf("await control('clearSignature',");
    const cancel = own.indexOf("await control('cancelSignature',");
    expect([clear > 0, cancel > clear]).toEqual([true, true]);
    // control() is what turns a click into a report line: the id is clicked and recorded, never only checked.
    expect(own).toMatch(/const control = async \(id, check\) => \{[\s\S]*?await pg\.click\(`#\$\{id\}`\);[\s\S]*?record\(failure \? 'FAIL' : 'PASS', id,/);
  });

  it('every picked scenario is run, and the deploy gate does not turn scenarios off', () => {
    expect(sweep).toMatch(/: scenarios;\n[\s\S]*?for \(const s of picked\) \{[\s\S]*?await s\.run\(page\);/);
    expect(sweep).toMatch(/^const SCENARIOS = !has\('--no-scenarios'\);$/m);
    const line = deploy.split('\n').filter((l) => /npm run qa:sweep\b/.test(l) && !l.trim().startsWith('#'));
    expect(line).toHaveLength(1);
    expect(line[0]).not.toMatch(/--no-scenarios|--scenario\b/);
  });
});
