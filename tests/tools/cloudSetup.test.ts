// .claude/cloud-setup.sh (kit plan row 33, CR3) — the toolchain hook the claude-code-setup kit runs as root at a
// cloud environment's setup. It can only really run in the cloud; here it runs against FAKES: a temp workspace, a
// PATH whose node/npm/npx/curl are recorders and which holds no real Node, the root-owned prefix and the log dir
// relocated. Never against this checkout's node_modules. Not proven here: the real download, the real time inside
// the kit's 120 s budget, and whether a cached environment keeps a chain that was still running.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

const HOOK = resolve('.claude/cloud-setup.sh');
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

interface Fakes {
  nodeVersion?: string; // what the fake `node --version` prints
  failOn?: string; // a recorded command line that exits 1
  slowNpmCi?: number; // seconds `npm ci` sleeps
}

/** A workspace with a lockfile, a fakes dir and the env the kit gives the hook (cloud by default). */
function workspace(f: Fakes = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-setup-'));
  roots.push(root);
  const ws = join(root, 'ws');
  const bin = join(root, 'fakes');
  mkdirSync(ws);
  mkdirSync(bin);
  writeFileSync(join(ws, 'package-lock.json'), '{"lockfileVersion": 3}\n');
  const rec = (name: string, extra = '') => {
    const p = join(bin, name);
    writeFileSync(
      p,
      `#!/bin/bash\nprintf '%s\\n' "${name} $*" >> "${join(root, 'calls.log')}"\n${extra}\n` +
        (f.failOn ? `[[ "${name} $*" == "${f.failOn}" ]] && exit 1\n` : '') +
        'exit 0\n',
    );
    chmodSync(p, 0o755);
  };
  rec('node', `[[ "$1" == --version ]] && echo ${f.nodeVersion ?? 'v26.13.1'}`);
  rec('npm', `[[ "$1" == ci ]] && mkdir -p node_modules${f.slowNpmCi ? ` && sleep ${f.slowNpmCi}` : ''}`);
  rec('npx');
  rec('curl', 'for a in "$@"; do [[ "$prev" == -o ]] && printf "not the node tarball" > "$a"; prev=$a; done');
  const env: Record<string, string> = {
    PATH: `${bin}:/usr/bin:/bin`, // no real node, npm or npx is reachable
    HOME: '/root',
    CLAUDE_CODE_REMOTE: 'true',
    PDFTURBO_CLOUD_SETUP_PREFIX: join(root, 'prefix'),
    PDFTURBO_CLOUD_SETUP_LOGDIR: join(root, 'tmp'),
  };
  mkdirSync(env.PDFTURBO_CLOUD_SETUP_LOGDIR);
  const run = (over: Record<string, string | undefined> = {}) => {
    const t0 = Date.now();
    const r = spawnSync('bash', [HOOK], { cwd: ws, env: { ...env, ...over }, encoding: 'utf8', timeout: 30_000 });
    return { ...r, ms: Date.now() - t0 };
  };
  const calls = () => (existsSync(join(root, 'calls.log')) ? readFileSync(join(root, 'calls.log'), 'utf8') : '');
  const marker = join(env.PDFTURBO_CLOUD_SETUP_LOGDIR, 'pdfturbo-cloud-setup.done');
  const log = () => {
    const p = join(env.PDFTURBO_CLOUD_SETUP_LOGDIR, 'pdfturbo-cloud-setup.log');
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  };
  /** Wait for the detached chain's marker (it outlives the hook on purpose). */
  const done = async (ms = 15_000): Promise<string> => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
      if (existsSync(marker)) return readFileSync(marker, 'utf8');
    }
    throw new Error(`no marker after ${ms} ms; log:\n${log()}`);
  };
  const lockHash = createHash('sha256').update(readFileSync(join(ws, 'package-lock.json'))).digest('hex');
  return { root, ws, run, calls, done, log, marker, lockHash };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

const CHAIN = ['npm ci', 'npm run ocr:assets', 'npx playwright install --with-deps --no-shell chromium'];

describe('.claude/cloud-setup.sh', () => {
  it('is an executable regular file, as the kit requires to run it', () => {
    expect(statSync(HOOK).isFile()).toBe(true);
    expect(statSync(HOOK).mode & 0o111).toBe(0o111);
    const staged = spawnSync('git', ['ls-files', '-s', '--', '.claude/cloud-setup.sh'], { encoding: 'utf8' }).stdout;
    if (staged) expect(staged.startsWith('100755 ')).toBe(true); // once tracked, git must keep the bit
  });

  it('does nothing off the cloud — not on the PC, not with a stray CLAUDE_CODE_REMOTE', () => {
    const w = workspace();
    for (const over of [{ HOME: w.root }, { CLAUDE_CODE_REMOTE: '' }, { CLAUDE_CODE_REMOTE: 'false' }]) {
      const r = w.run(over);
      expect(r.status).toBe(0);
    }
    expect(w.calls()).toBe('');
    expect(w.log()).toBe('');
    expect(existsSync(w.marker)).toBe(false);
  });

  it('in the cloud with Node 26 present: no download, the chain runs in order, the marker says ok + the lock hash', async () => {
    const w = workspace();
    expect(w.run().status).toBe(0);
    const marker = await w.done();
    expect(marker).toBe(`ok\nlock=${w.lockHash}\n`);
    const calls = w.calls().split('\n').filter((l) => !l.startsWith('node '));
    expect(calls.filter(Boolean)).toEqual(CHAIN);
    expect(w.log()).toMatch(/node: .*v26\.13\.1/);
  });

  it('a Node that is not v26 is replaced from the pinned tarball; a bad download is refused, logged, and the chain still runs', async () => {
    const w = workspace({ nodeVersion: 'v20.19.0' });
    expect(w.run().status).toBe(0);
    expect(w.calls()).toMatch(/^curl .*--max-time \d+ .*https:\/\/nodejs\.org\/dist\/v26\.13\.1\/node-v26\.13\.1-linux-x64\.tar\.gz$/m);
    expect(w.log()).toMatch(/ERROR \| node: .*sha256/);
    expect(w.log()).toMatch(/ERROR \| node: .*v20\.19\.0 is not v26/);
    expect(existsSync(join(w.root, 'prefix', 'usr', 'local', 'bin', 'node'))).toBe(false);
    expect(await w.done()).toMatch(/^ok\n/);
  });

  it('a failing step still exits 0; the marker names the step and the chain stops there', async () => {
    const w = workspace({ failOn: 'npm run ocr:assets' });
    expect(w.run().status).toBe(0);
    expect(await w.done()).toBe(`failed\nstep=npm run ocr:assets\nlock=${w.lockHash}\n`);
    expect(w.calls()).not.toContain('npx playwright');
  });

  it('returns at once while a slow chain keeps running (the kit times the hook, not the chain)', async () => {
    const w = workspace({ slowNpmCi: 3 });
    const r = w.run();
    expect(r.status).toBe(0);
    expect(r.ms).toBeLessThan(2_500);
    expect(existsSync(w.marker)).toBe(false);
    expect(await w.done()).toMatch(/^ok\n/);
  });

  it('a second run while the chain runs only says so; a run after ok with the same lock does nothing', async () => {
    const w = workspace({ slowNpmCi: 3 });
    w.run();
    w.run();
    await w.done();
    expect(w.calls().match(/^npm ci$/gm)).toHaveLength(1);
    expect(w.log()).toContain('already running');
    w.run();
    await sleep(500);
    expect(w.calls().match(/^npm ci$/gm)).toHaveLength(1);
    expect(w.log()).toContain('already done');
  });

  it('a different lockfile after ok runs the chain again', async () => {
    const w = workspace();
    w.run();
    await w.done();
    writeFileSync(join(w.ws, 'package-lock.json'), '{"lockfileVersion": 3, "changed": true}\n');
    w.run(); // the stale marker goes before the hook returns, so done() waits for the new one
    const now = createHash('sha256').update(readFileSync(join(w.ws, 'package-lock.json'))).digest('hex');
    expect(await w.done()).toBe(`ok\nlock=${now}\n`);
    expect(w.calls().match(/^npm ci$/gm)).toHaveLength(2);
  });
});
