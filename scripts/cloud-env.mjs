// Is this a claude.ai cloud session, and which browser do the browser suite and the QA sweep launch there?
// Kit plan row 33 (CR6), CLAUDE.md § "A cloud session".
//
// The test is the claude-code-setup kit's own (its lib/cloud-home.sh): CLAUDE_CODE_REMOTE=true AND HOME resolving to
// /root — a stray export on the PC must not count, and the checkout path decides nothing.
//
// The cloud has no Google Chrome, so `channel: 'chrome'` cannot work there. `.claude/cloud-setup.sh` installs
// Playwright's own Chromium (the revision pinned by the lockfile's playwright-core, `--no-shell`), and
// `channel: 'chromium'` launches that FULL build: with no channel, a headless launch would look for
// chromium-headless-shell instead (playwright-core's getExecutableName). Everywhere else — the developer's PC and the
// GitHub runner — the system Google Chrome, unchanged.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/** `realpath -m`: follow symlinks where the path exists, else normalise it. */
function resolvePath(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** @param {Record<string, string | undefined>} env */
export function isClaudeCloud(env) {
  if (env.CLAUDE_CODE_REMOTE !== 'true' || !env.HOME) return false;
  return resolvePath(env.HOME) === '/root';
}

/** @param {Record<string, string | undefined>} env @returns {{ channel: 'chromium' | 'chrome' }} */
export function browserLaunchOptions(env) {
  return isClaudeCloud(env) ? { channel: 'chromium' } : { channel: 'chrome' };
}
