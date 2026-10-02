/**
 * audit-gate — the deploy gate's `npm audit` step, with a NARROW, expiring exemption list.
 *
 * `npm audit --audit-level=high` blocks every deploy on a high/critical advisory, which is deliberate (CLAUDE.md § Git & CI)
 * — but it also blocks on one that has NO patched release, where no override can help (node-forge <= 1.4.0, 2026-10-02).
 * This keeps the gate exactly as strict for everything else: it fails on any high/critical advisory unless
 * `scripts/audit-gate-allowlist.json` names that advisory id for that package, with a reason and an expiry date.
 *
 * Fails closed: an audit run that produced no verdict (network error, an `error` object, unparseable output) is a failure,
 * as is a malformed allowlist entry. An exemption is VOID once npm audit reports a fix available (`fixAvailable`), or past its expiry;
 * one whose advisory has gone is reported as stale (remove it), never silently kept.
 * Never run it with `--offline`: the cached database reported a clean tree against a vulnerable one (2026-09-04).
 *
 * Exit: 0 pass, 1 an unexempted advisory, 2 no verdict (could not run / malformed input).
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const BLOCKING = new Set(['high', 'critical']);
/** A severity string, lower-cased, or undefined when it is not one npm uses (so it can never silently pass). */
const severityOf = v => (typeof v === 'string' && Object.hasOwn(RANK, v.toLowerCase()) ? v.toLowerCase() : undefined);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^GHSA(-[0-9a-z]{4}){3}$/;

/** The advisory id is the last path segment of an advisory url; the collection segment itself (`.../advisories/`) is not one. */
function idOf(url) {
  const last = typeof url === 'string' ? url.split('/').filter(Boolean).pop() : undefined;
  return last && last !== 'advisories' ? last : undefined;
}

/**
 * @param {unknown} report `npm audit --json` output (auditReportVersion 2)
 * @param {unknown} allowlist `[{ id, package, expires: 'YYYY-MM-DD', reason }]`
 * @param {string} today `YYYY-MM-DD`
 * @returns {{ ok: boolean, failing: string[], exempted: string[], stale: string[], problems: string[] }}
 */
export function evaluate(report, allowlist, today) {
  const failing = [];
  const exempted = [];
  const stale = [];
  const problems = [];

  const entries = [];
  for (const [i, e] of (Array.isArray(allowlist) ? allowlist : []).entries()) {
    const good = e && typeof e.id === 'string' && ID.test(e.id) && typeof e.package === 'string' && e.package
      && typeof e.expires === 'string' && DATE.test(e.expires) && typeof e.reason === 'string' && e.reason.trim();
    if (good) entries.push(e);
    else problems.push(`allowlist entry ${i} is malformed (needs a GHSA id, a package, an expires date and a reason)`);
  }
  if (allowlist !== undefined && !Array.isArray(allowlist)) problems.push('the allowlist is not an array');

  const r = report;
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    problems.push('the audit produced no report');
  } else if (r.error) {
    problems.push(`the audit reported an error: ${typeof r.error === 'object' ? (r.error.summary ?? r.error.code ?? 'unknown') : String(r.error)}`);
  } else if (!r.vulnerabilities || typeof r.vulnerabilities !== 'object' || Array.isArray(r.vulnerabilities)) {
    problems.push('the audit report has no `vulnerabilities` object');
  }
  if (problems.length && !(r && typeof r === 'object' && r.vulnerabilities && typeof r.vulnerabilities === 'object')) {
    return { ok: false, failing, exempted, stale, problems };
  }

  // Advisory objects live on the node where they originate; the nodes that depend on it list its package NAME as a string.
  // Judging by advisory (id + package) therefore counts each once and cannot be hidden behind a chain of names. Everything
  // here fails CLOSED (round 7): a severity it does not know, an advisory with no usable id, and a blocking node whose chain
  // never reaches an advisory object are failures or problems, never skips.
  const nodes = r.vulnerabilities;
  const advisories = new Map(); // `${id}|${name}` -> { id, name, severity, fixable }
  const hasAdvisory = (name, visited = new Set()) => {
    if (visited.has(name)) return false;
    visited.add(name);
    const node = nodes[name];
    if (!node || typeof node !== 'object') return false;
    return (Array.isArray(node.via) ? node.via : []).some(v => (v && typeof v === 'object') || (typeof v === 'string' && hasAdvisory(v, visited)));
  };
  for (const [key, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') { problems.push(`vulnerability entry ${key} is not an object`); continue; }
    const nodeName = node.name ?? key;
    const nodeSev = severityOf(node.severity);
    if (!nodeSev) problems.push(`vulnerability ${nodeName} has no usable severity (${JSON.stringify(node.severity)})`);
    if (nodeSev && BLOCKING.has(nodeSev) && !hasAdvisory(key)) problems.push(`vulnerability ${nodeName} (${nodeSev}) has no advisory behind it`);
    // A node's severity is the worst of the advisories behind it. A blocking node whose via entries are ALL advisory objects and
    // none of them blocking disagrees with its own evidence: a problem, not a pass (round 8).
    const vias = Array.isArray(node.via) ? node.via : [];
    if (nodeSev && BLOCKING.has(nodeSev) && vias.length && vias.every(v => v && typeof v === 'object')
      && !vias.some(v => BLOCKING.has(severityOf(v.severity)))) problems.push(`vulnerability ${nodeName} is ${nodeSev} but none of its advisories is`);
    for (const via of Array.isArray(node.via) ? node.via : []) {
      if (!via || typeof via !== 'object') continue;
      const name = via.name ?? nodeName;
      const severity = severityOf(via.severity) ?? nodeSev;
      if (!severity) continue; // both the advisory's and the node's severity are unusable: the node-level problem above already fails the gate
      const id = idOf(via.url);
      if (!id) {
        if (BLOCKING.has(severity)) failing.push(`unidentified advisory (${name}, ${severity})`);
        continue;
      }
      const k = `${id}|${name}`;
      const prev = advisories.get(k);
      // Only an explicit `false` means no fix exists; a missing field must not keep the exemption alive (round 8).
      const fixable = node.fixAvailable !== false;
      if (!prev) advisories.set(k, { id, name, severity, fixable });
      else {
        if (RANK[severity] > RANK[prev.severity]) prev.severity = severity;
        prev.fixable = prev.fixable || fixable;
      }
    }
  }
  const seen = new Set(advisories.keys());
  for (const { id, name, severity, fixable } of advisories.values()) {
    if (!BLOCKING.has(severity)) continue;
    const hit = entries.find(e => e.id === id && e.package === name && today <= e.expires);
    // The exemption exists because no fix does. npm audit reports `fixAvailable` false until one ships, then true or
    // `{ name, version, isSemVerMajor }`: from then on the exemption is void, so the bump is prompted by the gate itself.
    if (hit && !fixable) exempted.push(`${id} (${name})`);
    else if (hit) failing.push(`${id} (${name}, ${severity}) — a fix is available: bump the package and remove its allowlist entry`);
    else failing.push(`${id} (${name}, ${severity})`);
  }
  for (const e of entries) if (!seen.has(`${e.id}|${e.package}`)) stale.push(e.id);
  return { ok: failing.length === 0 && problems.length === 0, failing, exempted, stale, problems };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let allowlist;
  try {
    allowlist = JSON.parse(readFileSync(join(root, 'scripts', 'audit-gate-allowlist.json'), 'utf8'));
  } catch (err) {
    console.error(`audit-gate: cannot read the allowlist: ${err.message}`);
    process.exit(2);
  }
  // npm audit exits 1 when it finds anything; the JSON on stdout is the verdict, the status is not.
  const run = spawnSync('npm', ['audit', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.error(`audit-gate: npm audit gave no JSON (status ${run.status}): ${(run.stderr || run.stdout || '').slice(0, 400)}`);
    process.exit(2);
  }
  const today = new Date().toISOString().slice(0, 10);
  const res = evaluate(report, allowlist, today);
  for (const e of res.exempted) console.log(`audit-gate: EXEMPT ${e} (see scripts/audit-gate-allowlist.json)`);
  for (const s of res.stale) console.log(`audit-gate: STALE exemption ${s} — the advisory is gone, remove it from the allowlist`);
  for (const p of res.problems) console.error(`audit-gate: ${p}`);
  for (const f of res.failing) console.error(`audit-gate: FAIL ${f}`);
  if (res.problems.length) process.exit(2);
  if (res.failing.length) process.exit(1);
  console.log(`audit-gate: ok (${res.exempted.length} exempted)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
