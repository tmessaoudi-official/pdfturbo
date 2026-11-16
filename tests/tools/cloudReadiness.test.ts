// Cloud readiness (kit plan row 33, docs/plans/cloud-readiness.plan.md). Text pins, not a run: the cloud side is only
// proven by a real cloud session. What they hold:
// - CLAUDE.md (I1, ruled 2026-11-16): the master-only rule is scoped to the developer's machine, a « A cloud session »
//   section says what the kit enforces (a harness branch, never master; land.sh; unsigned, no trailer; the proxy CA;
//   the toolchain hook), and the wording the ruling replaced cannot come back.
// - deploy.yml (I13): a pushed cloud branch runs the checks, and no path from a non-master ref deploys. The REAL
//   guard is the github-pages environment's master-only branch policy (a GitHub setting): a branch can edit this file,
//   so these pins keep master's own copy honest, they do not stop a branch.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const flat = (s: string): string => s.replace(/\s+/g, ' ');
const claudeMd = readFileSync('CLAUDE.md', 'utf8');
const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');

/** A `## ` section of CLAUDE.md, from its heading to the next `## ` heading. */
function section(heading: string): string {
  const start = claudeMd.indexOf(`\n## ${heading}`);
  expect(start, `CLAUDE.md has no "## ${heading}" section`).toBeGreaterThan(0);
  const end = claudeMd.indexOf('\n## ', start + 4);
  return claudeMd.slice(start, end < 0 ? undefined : end);
}

describe('CLAUDE.md — the I1 branch ruling and the cloud section', () => {
  it('the master-only rule is scoped to the developer machine', () => {
    const text = flat(claudeMd);
    expect(text.includes('**`master` is the only branch.**'), 'the unscoped rule').toBe(false);
    expect(text.includes("**On the developer's machine, `master` is the only branch.**"), 'the scoped rule').toBe(true);
    expect(text.includes('Single branch `master`;'), '§ Git & CI').toBe(false);
  });

  it('the wording the ruling and the kit replaced is gone', () => {
    const text = flat(claudeMd);
    for (const stale of [
      're-signs its commits and force-pushes',
      'In a cloud session there is no `deny` list at all',
      'In a cloud session only the last two remain',
      'that environment is dead',
    ]) {
      expect(text.includes(stale), stale).toBe(false);
    }
  });

  it('a « A cloud session » section states what a cloud session must do', () => {
    const cloud = flat(section('A cloud session'));
    for (const term of [
      'CLAUDE_CODE_REMOTE', // the kit's detection
      'claude/', 'ccr-', 'never `master`', 'pull request', // the branch rule
      'land.sh /stack/projects/pdfturbo', // how it lands
      'unsigned', '`Co-Authored-By`', '`Claude-Session`', // identity and trailers
      '`master-signed`', // the real guarantee
      '`.claude/cloud-setup.sh`', '/tmp/pdfturbo-cloud-setup.done', // the toolchain hook and its marker
      'NODE_EXTRA_CA_CERTS', 'CCS_EXTRA_CA_FILE', // the proxy CA for an in-session download
      'core.hooksPath', // CR5: the project hook replaces the kit's pre-push hook
    ]) {
      expect(cloud.includes(term), term).toBe(true);
    }
  });
});

/** The lines of one YAML block: the line matching `head` and every following line indented deeper than it. */
function block(text: string, head: RegExp): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => head.test(l));
  expect(i, `no line matches ${head}`).toBeGreaterThanOrEqual(0);
  const indent = lines[i].search(/\S/);
  const out = [lines[i]];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() !== '' && l.search(/\S/) <= indent) break;
    out.push(l);
  }
  return out.join('\n');
}

/** `branches: [a, 'b/**']` under a trigger, as a list of names. */
function branches(trigger: 'push' | 'pull_request'): string[] {
  const on = block(deploy, /^on:/);
  const list = block(on, new RegExp(`^ {2}${trigger}:`)).match(/branches:\s*\[([^\]]*)\]/)?.[1];
  expect(list, `${trigger} has no inline branches list`).toBeDefined();
  return (list ?? '').split(',').map((b) => b.trim().replace(/^['"]|['"]$/g, ''));
}

const MASTER_ONLY = "github.ref == 'refs/heads/master'";

describe('deploy.yml — cloud branches get the checks, never a deploy', () => {
  it('a push to a cloud branch triggers the workflow', () => {
    expect(branches('push').sort()).toEqual(['ccr-*', 'claude/**', 'cloud/**', 'master']);
  });

  it('pull requests still target master only', () => {
    expect(branches('pull_request')).toEqual(['master']);
  });

  it('the deploy job runs only for master and is the one job holding the github-pages environment', () => {
    const job = block(deploy, /^ {2}deploy:/);
    expect(block(job, /^ {4}if:/)).toContain(MASTER_ONLY);
    expect(block(job, /^ {4}environment:/)).toMatch(/name:\s*github-pages/);
    expect(deploy.match(/^\s+environment:/gm)).toHaveLength(1);
    expect(deploy.match(/actions\/deploy-pages@/g)).toHaveLength(1);
    expect(job).toContain('actions/deploy-pages@');
  });

  it('the Pages artifact is uploaded only for master', () => {
    const lines = deploy.split('\n');
    const at = lines.findIndex((l) => l.includes('actions/upload-pages-artifact@'));
    expect(at).toBeGreaterThan(0);
    // the step's `- if:` line opens the same step, just above its `uses:`
    expect(lines[at - 1]).toMatch(/^\s+- if: /);
    expect(lines[at - 1]).toContain(MASTER_ONLY);
  });

  it('runs are grouped per ref, so a cloud push cannot cancel a running master deploy', () => {
    const group = block(deploy, /^concurrency:/).match(/group:\s*(\S.*)$/m)?.[1];
    expect(group).toContain('${{ github.ref }}');
  });
});
