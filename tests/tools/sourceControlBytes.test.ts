/**
 * TEST-1 (review 2026-10-07). A raw control byte in a source file makes git treat the file as binary: every diff of
 * `src/core/undoRedoController.ts` read "Binary files differ" because of one literal NUL in a template string, so no
 * review could see a change to undo/redo. Source text spells such a character as an escape (`\u0000`). Binary assets
 * under `src/` (a font) are exempt by extension, so a new TEXT extension is scanned without anyone adding it here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const BINARY = new Set(['.ttf', '.otf', '.woff', '.woff2', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.wasm', '.pdf', '.traineddata']);
// Tab, line feed and carriage return are text; every other C0 control and DEL is not.
// oxlint-disable-next-line no-control-regex -- matching control characters is this guard's whole purpose
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** `file:line 0xNN` for every raw control byte in `text`. */
function controlBytes(file: string, text: string): string[] {
  return [...text.matchAll(CONTROL)].map(m => `${file}:${text.slice(0, m.index).split('\n').length} 0x${m[0].charCodeAt(0).toString(16).padStart(2, '0')}`);
}

describe('no raw control bytes in source text (TEST-1)', () => {
  it('src/ holds none outside binary assets', () => {
    const files = readdirSync('src', { recursive: true, encoding: 'utf8' })
      .map(f => join('src', f)).filter(f => extname(f) !== '' && !BINARY.has(extname(f).toLowerCase()));
    expect(files.length, 'the walk reached the sources').toBeGreaterThan(150);
    expect(files.flatMap(f => controlBytes(f, readFileSync(f, 'latin1')))).toEqual([]);
  });

  it('control: the scan reports a NUL and a DEL by file and line, and lets tab, LF and CR pass', () => {
    expect(controlBytes('x.ts', 'a\tb\r\nc\x00d\ne\x7F')).toEqual(['x.ts:2 0x00', 'x.ts:3 0x7f']);
  });
});
