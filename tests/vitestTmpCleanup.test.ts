import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { afterEach, describe, expect, it } from 'vitest';
import setup from './vitestTmpCleanup';

// A stand-in for the one TestProject field the global setup reads.
const fakeProject = (tmpDir: unknown) => ({ vitest: { _tmpDir: tmpDir } }) as unknown as TestProject;

describe('vitestTmpCleanup (row 44: vitest 5 never removes its root _tmpDir)', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('removes the root _tmpDir, module-cache subdirectories included, at teardown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vtc-'));
    made.push(dir);
    mkdirSync(join(dir, 'client'));
    writeFileSync(join(dir, 'client', 'deadbeef'), 'cached module');
    const teardown = setup(fakeProject(dir));
    expect(existsSync(dir)).toBe(true); // setup itself deletes nothing
    await teardown();
    expect(existsSync(dir)).toBe(false);
  });

  it('teardown is a no-op when vitest never created the directory', async () => {
    await expect(setup(fakeProject(join(tmpdir(), 'vtc-never-created')))()).resolves.toBeUndefined();
  });

  it.each([
    ['missing', undefined],
    ['not a string', 42],
    ['empty', ''],
  ])('refuses to start when _tmpDir is %s (a vitest upgrade changed the field)', (_label, value) => {
    expect(() => setup(fakeProject(value))).toThrow(/_tmpDir/);
  });

  it.each([
    ['outside the temp dir', '/etc/vitest-x'],
    ['nested below a child of the temp dir', join(tmpdir(), 'a', 'b')],
    ['the temp dir itself', tmpdir()],
    ['a parent-relative escape', join(tmpdir(), '..', 'vitest-x')],
  ])('refuses a path %s', (_label, value) => {
    expect(() => setup(fakeProject(value))).toThrow(/direct child of/);
  });
});
