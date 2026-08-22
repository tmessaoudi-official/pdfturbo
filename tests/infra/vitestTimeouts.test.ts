/**
 * A hook doing the same expensive work as a test must get the same time budget.
 *
 * `vitest.config.ts` raises `testTimeout` to 30s because the signing tests do node-forge
 * RSA-2048 keygen and are slow — not hung — under full-suite CPU contention. But it never set
 * `hookTimeout`, so every `beforeAll` doing that identical keygen kept vitest's 10s default:
 * one third of the budget, for the same work. Three signing hooks were patched individually
 * with `}, 60_000)`; the fourth (`incrementalSigner.test.ts:106`) was missed and eventually
 * failed a real pre-push run with `Hook timed out in 10000ms`, blocking the push.
 *
 * Measured on this machine (5 samples of the failing hook's exact workload — keygen +
 * loadP12): 242–466ms idle, 564–2297ms under 8-way CPU saturation. So the operation completes
 * comfortably; only the budget was wrong, and the origin of that is this config gap rather
 * than the fourth missing argument.
 *
 * This asserts the effective config value rather than the file text, so a present-but-too-small
 * `hookTimeout` cannot satisfy it.
 */
import { describe, it, expect } from 'vitest';
import config from '../../vitest.config';

const test = (config as { test?: { testTimeout?: number; hookTimeout?: number } }).test;

describe('vitest timeouts', () => {
  it('sets an explicit hookTimeout (the 10s default is what broke the push)', () => {
    expect(test?.hookTimeout).toBeTypeOf('number');
    expect(test?.hookTimeout).toBeGreaterThan(10_000);
  });

  it('gives hooks at least the budget a test gets — they run the same keygen', () => {
    expect(test?.hookTimeout).toBeGreaterThanOrEqual(test?.testTimeout ?? 0);
  });
});
