// Types for scripts/cloud-env.mjs (imported by vitest.browser.config.ts and tests/tools/cloudEnv.test.ts).
export function isClaudeCloud(env: Record<string, string | undefined>): boolean;
export function browserLaunchOptions(env: Record<string, string | undefined>): { channel: 'chromium' | 'chrome' };
