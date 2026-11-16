// scripts/cloud-env.mjs (kit plan row 33, CR6): the one place that decides "this is a claude.ai cloud session" and
// which browser the browser suite and the QA sweep launch there. The cloud branch itself can only run in the cloud;
// these pin the decision and that both users ask it.
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { browserLaunchOptions, isClaudeCloud } from '../../scripts/cloud-env.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'cloud-env-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('isClaudeCloud — the kit test: CLAUDE_CODE_REMOTE=true AND HOME resolving to /root', () => {
  it('is true for the cloud session', () => {
    expect(isClaudeCloud({ CLAUDE_CODE_REMOTE: 'true', HOME: '/root' })).toBe(true);
    expect(isClaudeCloud({ CLAUDE_CODE_REMOTE: 'true', HOME: '/root/' })).toBe(true);
  });

  it('follows a HOME that is a symlink to /root', () => {
    const link = join(tmp, 'home-link');
    symlinkSync('/root', link);
    expect(isClaudeCloud({ CLAUDE_CODE_REMOTE: 'true', HOME: link })).toBe(true);
  });

  it('is false for a stray CLAUDE_CODE_REMOTE on the PC (HOME is not /root)', () => {
    expect(isClaudeCloud({ CLAUDE_CODE_REMOTE: 'true', HOME: '/home/developer' })).toBe(false);
  });

  it('is false without CLAUDE_CODE_REMOTE=true, even as root', () => {
    expect(isClaudeCloud({ HOME: '/root' })).toBe(false);
    expect(isClaudeCloud({ CLAUDE_CODE_REMOTE: '1', HOME: '/root' })).toBe(false);
    expect(isClaudeCloud({ CLAUDE_CODE_REMOTE: 'false', HOME: '/root' })).toBe(false);
  });

  it('is false with no HOME at all', () => {
    expect(isClaudeCloud({ CLAUDE_CODE_REMOTE: 'true' })).toBe(false);
    expect(isClaudeCloud({ CLAUDE_CODE_REMOTE: 'true', HOME: '' })).toBe(false);
  });
});

describe('browserLaunchOptions', () => {
  it('the cloud launches Playwright\'s full pinned Chromium (no channel would pick chromium-headless-shell)', () => {
    expect(browserLaunchOptions({ CLAUDE_CODE_REMOTE: 'true', HOME: '/root' })).toEqual({ channel: 'chromium' });
  });

  it('the PC and CI keep the system Google Chrome', () => {
    expect(browserLaunchOptions({ HOME: '/home/developer' })).toEqual({ channel: 'chrome' });
    expect(browserLaunchOptions({ CLAUDE_CODE_REMOTE: 'true', HOME: '/home/runner' })).toEqual({ channel: 'chrome' });
  });
});

describe('both browser users ask the chooser', () => {
  it('vitest.browser.config.ts launches what browserLaunchOptions returns', () => {
    const cfg = readFileSync('vitest.browser.config.ts', 'utf8');
    expect(cfg).toMatch(/import \{ browserLaunchOptions \} from '\.\/scripts\/cloud-env\.mjs';/);
    expect(cfg).toContain('playwright({ launchOptions: browserLaunchOptions(process.env) })');
    expect(cfg.includes("launchOptions: { channel: 'chrome' }"), 'the old hard-coded channel').toBe(false);
  });

  it('qa-sweep.mjs falls back to browserLaunchOptions, not a hard-coded channel', () => {
    const sweep = readFileSync('scripts/qa-sweep.mjs', 'utf8');
    expect(sweep).toMatch(/import \{ browserLaunchOptions \} from '\.\/cloud-env\.mjs';/);
    const fn = sweep.slice(sweep.indexOf('function resolveBrowser()'), sweep.indexOf('\n}\n', sweep.indexOf('function resolveBrowser()')));
    expect(fn).toContain('return browserLaunchOptions(process.env);');
    expect(fn.includes("return { channel: 'chrome' };"), 'the old hard-coded fallback').toBe(false);
  });
});
