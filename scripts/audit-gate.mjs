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
import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  // What a node's chain reaches: the worst severity among the advisory OBJECTS behind it (-1: none) and whether a string `via`
  // names a package the report does not list. An advisory object with no usable severity counts as its node's.
  const reach = (name, visited = new Set()) => {
    const out = { max: -1, dangling: false };
    if (visited.has(name)) return out;
    visited.add(name);
    const node = nodes[name];
    if (!node || typeof node !== 'object') { out.dangling = true; return out; }
    for (const v of Array.isArray(node.via) ? node.via : []) {
      if (v && typeof v === 'object') out.max = Math.max(out.max, RANK[severityOf(v.severity) ?? severityOf(node.severity)] ?? -1);
      else if (typeof v === 'string') {
        const sub = reach(v, visited);
        out.max = Math.max(out.max, sub.max);
        out.dangling ||= sub.dangling;
      }
    }
    return out;
  };
  for (const [key, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') { problems.push(`vulnerability entry ${key} is not an object`); continue; }
    const nodeName = node.name ?? key;
    const nodeSev = severityOf(node.severity);
    if (!nodeSev) problems.push(`vulnerability ${nodeName} has no usable severity (${JSON.stringify(node.severity)})`);
    // A blocking node must be explained by a blocking advisory reachable through its chain (round 9: npm's own rule is that a node's
    // severity is the worst of its advisories, so anything else is corrupt or forged input), and a chain must not end at a package the
    // report does not list.
    if (nodeSev && BLOCKING.has(nodeSev)) {
      const got = reach(key);
      if (got.max < 0) problems.push(`vulnerability ${nodeName} (${nodeSev}) has no advisory behind it`);
      else if (!BLOCKING.has(Object.keys(RANK).find(k => RANK[k] === got.max))) problems.push(`vulnerability ${nodeName} is ${nodeSev} but none of its advisories is`);
      if (got.dangling) problems.push(`vulnerability ${nodeName} refers to a package the report does not list`);
    }
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
  // The report's own per-severity package counts must agree with the nodes it lists: a truncated report (`vulnerabilities: {}`
  // beside `metadata.vulnerabilities.high: 2`) is no verdict, not a pass (round 9).
  const counts = r.metadata && typeof r.metadata === 'object' ? r.metadata.vulnerabilities : undefined;
  if (counts && typeof counts === 'object') {
    for (const level of BLOCKING) {
      const listed = Object.values(nodes).filter(n => n && typeof n === 'object' && severityOf(n.severity) === level).length;
      if (counts[level] !== undefined && counts[level] !== listed) problems.push(`the report counts ${counts[level]} ${level} vulnerabilities but lists ${listed}`);
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

// Run when launched as a script, also through a symlink: `import.meta.url` is the REAL path while `argv[1]` keeps the link, and a
// plain comparison made a symlinked launch exit 0 without auditing anything (round 9). A launch that cannot be resolved fails closed.
function launchedAsScript() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (launchedAsScript()) main();
