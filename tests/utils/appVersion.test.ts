import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_VERSION, formatVersionLabel, renderAppVersion } from '../../src/utils/appVersion';

describe('appVersion (F-B)', () => {
  it('APP_VERSION is a semver-shaped string', () => {
    // Prod build injects package.json version (e.g. "1.0.0"); the test build has no
    // Vite `define`, so it falls back to the dev marker "0.0.0-dev" — both match.
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('formatVersionLabel prefixes a "v"', () => {
    expect(formatVersionLabel('1.2.3')).toBe('v1.2.3');
  });

  it('formatVersionLabel defaults to APP_VERSION', () => {
    expect(formatVersionLabel()).toBe(`v${APP_VERSION}`);
  });

  it('renderAppVersion writes the label into the element', () => {
    const span = document.createElement('span');
    renderAppVersion(span, '2.5.0');
    expect(span.textContent).toBe('v2.5.0');
  });

  it('renderAppVersion is a no-op when the element is absent', () => {
    expect(() => renderAppVersion(null, '9.9.9')).not.toThrow();
  });

  it('index.html footer has the #appVersion mount point', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
    expect(html).toContain('id="appVersion"');
  });
});
