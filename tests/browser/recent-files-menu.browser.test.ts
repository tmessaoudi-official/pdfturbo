/**
 * Limits row 11 (real Chrome) — the File menu's recent-files list LAYS OUT as a list.
 *
 * jsdom has no layout, so `tests/ui/recentFilesMenu.test.ts` can pin the structure (a labelled group of
 * buttons, then the "Clear recent files" action outside it) but not where the buttons land. They landed
 * side by side: `.file-menu-recents` is a column flexbox, but the buttons sit one level down inside the
 * `role="group"` wrapper, which was a plain block, so they flowed inline — found in the row-11 screenshot.
 */
import '../../src/styles/base.css';
import { describe, it, expect, afterEach } from 'vitest';
import { renderRecentFiles, type RecentMenuCtx } from '../../src/ui/recentFilesMenu';
import { addRecentFile, clearRecentFiles } from '../../src/infra/recentFiles';
import type { IErrorReporter } from '../../src/core/errorReporter';

type G = typeof globalThis & { showOpenFilePicker?: unknown };
const g = globalThis as G;

class Handle {
  constructor(public name: string, public key: string) {}
  getFile(): Promise<File> { return Promise.resolve(new File(['x'], this.name, { type: 'application/pdf' })); }
  isSameEntry(o: unknown): Promise<boolean> { return Promise.resolve((o as { key?: string }).key === this.key); }
}

afterEach(async () => { delete g.showOpenFilePicker; await clearRecentFiles(); document.body.replaceChildren(); });

describe('recent files menu layout (limits row 11)', () => {
  it('stacks every recent and the Clear action vertically, left-aligned', async () => {
    g.showOpenFilePicker = () => Promise.resolve([]);
    await clearRecentFiles();
    for (const n of ['c.pdf', 'b.pdf', 'a.pdf']) await addRecentFile(new Handle(n, n) as never);

    // The real menu markup: a column dropdown holding the recents container.
    const drop = document.createElement('div');
    drop.className = 'file-menu-dropdown';
    drop.style.display = 'flex';
    drop.style.position = 'static';
    const container = document.createElement('div');
    container.className = 'file-menu-recents';
    drop.appendChild(container);
    document.body.appendChild(drop);

    const ctx: RecentMenuCtx = {
      container, loadFiles: () => Promise.resolve(), closeMenu: () => {},
      reportError: { info() {}, silent() {}, warn() {}, error() {} } as unknown as IErrorReporter,
    };
    await renderRecentFiles(ctx);

    const rows = [...container.querySelectorAll<HTMLElement>('button.file-menu-recent'),
      container.querySelector<HTMLElement>('button.file-menu-clear-recents') as HTMLElement];
    expect(rows).toHaveLength(4);
    const boxes = rows.map(r => r.getBoundingClientRect());
    for (let i = 1; i < boxes.length; i++) {
      // Each row starts below the previous one ends, and all share the same left edge.
      expect(boxes[i].top, `row ${i} top`).toBeGreaterThanOrEqual(boxes[i - 1].bottom - 0.5);
      expect(Math.abs(boxes[i].left - boxes[0].left), `row ${i} left`).toBeLessThan(0.5);
    }
  });
});
