/**
 * The deploy gate's audit step (scripts/audit-gate.mjs). `npm audit --audit-level=high` blocks every deploy on a high
 * advisory, including one with NO patched release (node-forge, 2026-10-02) — so the gate may exempt a named advisory, and the
 * ways that exemption can go wrong are what these cases pin: it must be keyed on the advisory id AND the package, must
 * expire, must never cover a different advisory of the same package, and an audit run that did not produce a verdict
 * (an `error` object, no `vulnerabilities`) must FAIL, not pass.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script, no type declarations (the same precedent as tests/ocr/ocrAssets.test.ts)
import { evaluate } from '../../scripts/audit-gate.mjs';

const GHSA = 'GHSA-86w9-cpqp-85rv';
const adv = (name: string, id: string, severity: string) => ({ source: 1, name, dependency: name, title: 't', url: `https://github.com/advisories/${id}`, severity, range: '*' });
const report = (vulns: Record<string, unknown>) => ({ auditReportVersion: 2, vulnerabilities: vulns });
const vuln = (name: string, severity: string, via: unknown[]) => ({ name, severity, via, effects: [], range: '*', nodes: [`node_modules/${name}`], fixAvailable: false });
const allow = (over: Record<string, unknown> = {}) => [{ id: GHSA, package: 'node-forge', expires: '2026-12-31', reason: 'r', ...over }];
const TODAY = '2026-10-02';

describe('audit gate', () => {
  it('a clean report passes', () => {
    expect(evaluate(report({}), [], TODAY).ok).toBe(true);
  });

  it('a high advisory that is not exempted FAILS and is named', () => {
    const r = evaluate(report({ 'node-forge': vuln('node-forge', 'high', [adv('node-forge', GHSA, 'high')]) }), [], TODAY);
    expect(r.ok).toBe(false);
    expect(r.failing).toEqual([`${GHSA} (node-forge, high)`]);
  });

  it('the same advisory, exempted by id and package, before its expiry, passes and is reported as exempted', () => {
    const r = evaluate(report({ 'node-forge': vuln('node-forge', 'high', [adv('node-forge', GHSA, 'high')]) }), allow(), TODAY);
    expect(r.ok).toBe(true);
    expect(r.exempted).toEqual([`${GHSA} (node-forge)`]);
  });

  it('an exemption is VOID once a fix is available: the gate fails and says to bump (the removal trigger is mechanical)', () => {
    for (const fixAvailable of [true, { name: 'node-forge', version: '1.4.1', isSemVerMajor: false }]) {
      const node = { ...vuln('node-forge', 'high', [adv('node-forge', GHSA, 'high')]), fixAvailable };
      const r = evaluate(report({ 'node-forge': node }), allow(), TODAY);
      expect(r.ok, JSON.stringify(fixAvailable)).toBe(false);
      expect(r.failing, JSON.stringify(fixAvailable)).toEqual([`${GHSA} (node-forge, high) — a fix is available: bump the package and remove its allowlist entry`]);
    }
  });

  it('control: fixAvailable false keeps the exemption', () => {
    const node = { ...vuln('node-forge', 'high', [adv('node-forge', GHSA, 'high')]), fixAvailable: false };
    expect(evaluate(report({ 'node-forge': node }), allow(), TODAY).ok).toBe(true);
  });

  it('an EXPIRED exemption fails again', () => {
    const r = evaluate(report({ 'node-forge': vuln('node-forge', 'high', [adv('node-forge', GHSA, 'high')]) }), allow({ expires: '2026-10-01' }), TODAY);
    expect(r.ok).toBe(false);
  });

  it('the exemption does not cover a DIFFERENT advisory of the same package', () => {
    const r = evaluate(report({ 'node-forge': vuln('node-forge', 'high', [adv('node-forge', GHSA, 'high'), adv('node-forge', 'GHSA-aaaa-bbbb-cccc', 'high')]) }), allow(), TODAY);
    expect(r.ok).toBe(false);
    expect(r.failing).toEqual(['GHSA-aaaa-bbbb-cccc (node-forge, high)']);
  });

  it('the exemption does not cover the same id reported for a DIFFERENT package', () => {
    const r = evaluate(report({ other: vuln('other', 'high', [adv('other', GHSA, 'high')]) }), allow(), TODAY);
    expect(r.ok).toBe(false);
  });

  it('a critical advisory fails like a high one; a moderate one does not (the --audit-level=high contract)', () => {
    expect(evaluate(report({ a: vuln('a', 'critical', [adv('a', 'GHSA-1111-2222-3333', 'critical')]) }), [], TODAY).ok).toBe(false);
    expect(evaluate(report({ a: vuln('a', 'moderate', [adv('a', 'GHSA-1111-2222-3333', 'moderate')]) }), [], TODAY).ok).toBe(true);
  });

  it('a TRANSITIVE chain is judged by its advisory, not hidden behind package names (the brace-expansion shape)', () => {
    const r = evaluate(report({
      'brace-expansion': vuln('brace-expansion', 'high', [adv('brace-expansion', 'GHSA-mh99-v99m-4gvg', 'high')]),
      minimatch: vuln('minimatch', 'high', ['brace-expansion']),
      jake: vuln('jake', 'high', ['minimatch']),
    }), [], TODAY);
    expect(r.ok).toBe(false);
    expect(r.failing).toEqual(['GHSA-mh99-v99m-4gvg (brace-expansion, high)']);
  });

  it('an unknown or missing severity FAILS CLOSED; case does not matter (round 7, P2)', () => {
    const one = (severity: string | undefined) => evaluate(report({ a: vuln('a', severity as string, [{ ...adv('a', 'GHSA-1111-2222-3333', 'x'), severity }]) }), [], TODAY);
    expect(one('HIGH').ok, 'HIGH').toBe(false);
    expect(one('HIGH').failing, 'HIGH').toEqual(['GHSA-1111-2222-3333 (a, high)']);
    for (const bad of ['banana', undefined, '']) {
      const r = one(bad as string | undefined);
      expect(r.ok, String(bad)).toBe(false);
      expect(r.problems.length, String(bad)).toBeGreaterThan(0);
    }
    for (const fine of ['info', 'low', 'moderate']) expect(one(fine).ok, fine).toBe(true);
  });

  it('a NODE with a bogus severity fails the gate even when its advisory object carries a valid one', () => {
    for (const nodeSev of ['banana', undefined]) {
      const r = evaluate(report({ a: vuln('a', nodeSev as string, [adv('a', 'GHSA-1111-2222-3333', 'low')]) }), [], TODAY);
      expect(r.ok, String(nodeSev)).toBe(false);
      expect(r.problems.length, String(nodeSev)).toBeGreaterThan(0);
    }
  });

  it('a high advisory object with NO usable id is not skipped: it fails, named as unidentified (round 7, P2)', () => {
    for (const via of [{ name: 'a', severity: 'high' }, { name: 'a', severity: 'high', url: '' }, { name: 'a', severity: 'critical', url: 'https://github.com/advisories/' }]) {
      const r = evaluate(report({ a: vuln('a', 'high', [via]) }), allow(), TODAY);
      expect(r.ok, JSON.stringify(via)).toBe(false);
      expect(r.failing[0], JSON.stringify(via)).toMatch(/^unidentified advisory \(a, (high|critical)\)$/);
    }
    // a non-blocking object with no id is harmless
    expect(evaluate(report({ a: vuln('a', 'low', [{ name: 'a', severity: 'low' }]) }), [], TODAY).ok).toBe(true);
  });

  it('the same advisory seen at two severities is judged by the WORST (round 7, P3)', () => {
    const r = evaluate(report({
      x: vuln('x', 'low', [adv('p', 'GHSA-1111-2222-3333', 'low')]),
      y: vuln('y', 'high', [adv('p', 'GHSA-1111-2222-3333', 'high')]),
    }), [], TODAY);
    expect(r.ok).toBe(false);
    expect(r.failing).toEqual(['GHSA-1111-2222-3333 (p, high)']);
  });

  it('a blocking node whose chain never reaches an advisory object FAILS CLOSED (an unresolvable via)', () => {
    for (const via of [[], ['no-such-node'], [null]]) {
      const r = evaluate(report({ a: vuln('a', 'high', via as unknown[]) }), [], TODAY);
      expect(r.ok, JSON.stringify(via)).toBe(false);
      expect(r.problems.length, JSON.stringify(via)).toBeGreaterThan(0);
    }
    // a cycle between names must not hang or pass
    const cyc = evaluate(report({ a: vuln('a', 'high', ['b']), b: vuln('b', 'high', ['a']) }), [], TODAY);
    expect(cyc.ok).toBe(false);
  });

  it('an exemption whose advisory no longer appears is reported stale, and does not fail', () => {
    const r = evaluate(report({}), allow(), TODAY);
    expect(r.ok).toBe(true);
    expect(r.stale).toEqual([GHSA]);
  });

  it('FAILS CLOSED when the audit produced no verdict', () => {
    for (const bad of [null, undefined, 'text', {}, { error: { code: 'ENOTFOUND', summary: 'no network' } }, { vulnerabilities: 'x' }]) {
      const r = evaluate(bad, allow(), TODAY);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(r.problems.length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });

  it('an `error` object FAILS even when the report also carries an empty `vulnerabilities` (the second guard must not be the only one)', () => {
    const r = evaluate({ error: { code: 'EAUDITNOPJSON', summary: 'x' }, vulnerabilities: {} }, [], TODAY);
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it('a malformed allowlist entry fails the gate instead of being skipped', () => {
    const r = evaluate(report({}), [{ id: GHSA, package: 'node-forge', reason: 'no expiry given' }], TODAY);
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBeGreaterThan(0);
  });
});
