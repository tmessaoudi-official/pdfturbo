/**
 * Global setup (vitest.config.ts `globalSetup`) — removes the temp directory vitest 5 leaks on every run.
 *
 * Vitest 5.0.x keeps two module-fetcher caches under `os.tmpdir()`: each project's `tmpDir`, which
 * `TestProject.close()` removes, and the root instance's `_tmpDir = join(tmpdir(), nanoid())`, which
 * nothing removes (5.0.0 and 5.0.2 dist, checked 2026-09-28). Every `vitest run` therefore left a
 * `/tmp/<nanoid>/{client,ssr}/<sha1>` tree behind — 23 MB and 842 files for one full suite run, 375 of
 * them after one day of pushes. Probed the same night: this teardown runs inside `Vitest.close()`, after
 * the run settles, and the root directory is the only one left over.
 *
 * `_tmpDir` is `@internal`, so it is validated at SETUP: a vitest upgrade that renames or reshapes it
 * stops the run before any test starts, instead of silently leaking again. Drop this file once vitest
 * cleans the directory itself — the unit test's "removes" case then passes with a no-op teardown.
 */
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import type { TestProject } from 'vitest/node';

export default function setup(project: TestProject): () => Promise<void> {
  const dir = (project.vitest as unknown as { _tmpDir?: unknown })._tmpDir;
  if (typeof dir !== 'string' || dir === '') {
    throw new Error(
      `vitestTmpCleanup: vitest's root _tmpDir is ${JSON.stringify(dir)}, not a path — the field this ` +
        'setup relies on changed; re-check whether vitest now cleans its temp dir itself (row 44).',
    );
  }
  const target = resolve(dir);
  // Only ever a direct child of the temp dir: never the temp dir itself, never anything elsewhere.
  if (dirname(target) !== resolve(tmpdir()) || basename(target) === '') {
    throw new Error(`vitestTmpCleanup: refusing ${target}: it is not a direct child of ${resolve(tmpdir())}`);
  }
  return async () => {
    await rm(target, { recursive: true, force: true });
  };
}
