// @vitest-environment node
/**
 * WS8 step 3 — one viewer-check verdict per source, shared by every load of it (docs/plans/ws8-viewer-check.plan.md).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hasViewerVerdict, inheritViewerVerdict, prewarmViewerVerdict, viewerVerdict } from '../../src/utils/viewerVerdict';
import { buildXrefShapePdf } from './_invalidObjectFixture';

describe('viewerVerdict', () => {
  it('computes once per bytes object and hands every caller the same promise', async () => {
    const bytes = buildXrefShapePdf('dupFirst');
    expect(hasViewerVerdict(bytes)).toBe(false);
    prewarmViewerVerdict(bytes);
    expect(hasViewerVerdict(bytes)).toBe(true);
    const a = viewerVerdict(bytes);
    expect(viewerVerdict(bytes)).toBe(a);
    expect((await a).pages).toEqual([1]);
  });

  it('keys by identity: equal bytes in another array are checked on their own', () => {
    const bytes = buildXrefShapePdf('clean');
    prewarmViewerVerdict(bytes);
    expect(hasViewerVerdict(bytes.slice(0))).toBe(false);
  });

  it('keeps a rejected verdict — the same bytes fail the same way every time', async () => {
    const junk = new TextEncoder().encode('not a pdf');
    const first = viewerVerdict(junk);
    await expect(first).rejects.toBeTruthy();
    expect(viewerVerdict(junk)).toBe(first);
  });

  it('lets edited bytes inherit their source\'s verdict, and never overwrites one they already have', async () => {
    const source = buildXrefShapePdf('clean');
    const edited = buildXrefShapePdf('dupFirst'); // stands in for bytes pdf-lib wrote from `source`
    inheritViewerVerdict(source, edited);
    expect(hasViewerVerdict(edited)).toBe(false); // nothing to inherit yet

    const verdict = viewerVerdict(source);
    inheritViewerVerdict(source, edited);
    expect(viewerVerdict(edited)).toBe(verdict);
    expect((await viewerVerdict(edited)).pages).toEqual([]);

    const own = buildXrefShapePdf('clean');
    const ownVerdict = viewerVerdict(own);
    inheritViewerVerdict(edited, own);
    expect(viewerVerdict(own)).toBe(ownVerdict);
  });
});

// A source that enters the model without a prewarm is still checked — on its first export, which then waits seconds
// for pdf.js. So every place a source enters is pinned; `git grep` finds them, so a new one cannot be missed silently.
describe('every source entering the document model starts its verdict', () => {
  it('follows each addSourcePdf(doc, bytes, …) with prewarmViewerVerdict(bytes)', () => {
    const files = execFileSync('git', ['grep', '-l', 'addSourcePdf(', '--', 'src/'], { encoding: 'utf8' })
      .split('\n').filter(f => f && !f.endsWith('documentModel.ts'));
    const calls: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = /addSourcePdf\(\s*\w+\s*,\s*(\w+)/.exec(line);
        if (!m) return;
        const warmed = lines.slice(i + 1, i + 4).some(l => l.includes(`prewarmViewerVerdict(${m[1]})`));
        calls.push(`${f}:${i + 1} ${warmed ? 'warmed' : 'NOT WARMED'}`);
      });
    }
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.filter(c => c.endsWith('NOT WARMED'))).toEqual([]);
  });
});
