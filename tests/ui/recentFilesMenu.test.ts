// @vitest-environment jsdom
/**
 * #54b — the File-menu recents and the picker-first open.
 *
 * The two cases worth writing are the ones whose failure is a bad EXPERIENCE rather than an
 * exception: cancelling the native dialog must not summon a second one, and a remembered handle
 * must be re-authorised at click time rather than probed on load.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openViaPicker, renderRecentFiles, OPEN_TYPES, type RecentMenuCtx } from '../../src/ui/recentFilesMenu';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { addRecentFile, clearRecentFiles, listRecentFiles } from '../../src/infra/recentFiles';
import type { IErrorReporter } from '../../src/core/errorReporter';

type G = typeof globalThis & { showOpenFilePicker?: unknown };
const g = globalThis as G;

/** Prototype methods, not own properties — see the note in tests/infra/recentFiles.test.ts. */
class Handle {
  constructor(public name: string, public key: string) {}
  getFile(): Promise<File> { return Promise.resolve(new File(['x'], this.name, { type: 'application/pdf' })); }
  isSameEntry(o: unknown): Promise<boolean> { return Promise.resolve((o as { key?: string }).key === this.key); }
  queryPermission(): Promise<PermissionState> { return Promise.resolve('granted'); }
}

function ctx(): RecentMenuCtx & { loaded: File[][]; warns: string[] } {
  const loaded: File[][] = [];
  const warns: string[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    loaded, warns, container,
    loadFiles: (files) => { loaded.push(files); return Promise.resolve(); },
    closeMenu: () => {},
    reportError: {
      info() {}, silent() {},
      warn(key: string) { warns.push(key); },
      error(key: string) { warns.push(key); },
    } as unknown as IErrorReporter,
  };
}

beforeEach(async () => { await clearRecentFiles(); });
afterEach(() => { delete g.showOpenFilePicker; document.body.replaceChildren(); });

describe('openViaPicker', () => {
  it('reports "fallback" when the API is absent, so the hidden input can take over', async () => {
    expect(await openViaPicker(ctx())).toBe('fallback');
  });

  it('reports "cancelled" — NOT "fallback" — when the user dismisses the dialog', async () => {
    // The whole reason pickOpenFiles distinguishes the two. Returning 'fallback' here would answer
    // the user's "no thanks" by immediately opening a second, different file dialog.
    g.showOpenFilePicker = () => Promise.reject(new DOMException('x', 'AbortError'));
    expect(await openViaPicker(ctx())).toBe('cancelled');
  });

  it('loads the chosen file and remembers it', async () => {
    g.showOpenFilePicker = () => Promise.resolve([new Handle('a.pdf', 'ka')]);
    const c = ctx();
    expect(await openViaPicker(c)).toBe('opened');
    expect(c.loaded[0].map(f => f.name)).toEqual(['a.pdf']);
    expect((await listRecentFiles()).map(r => r.name)).toEqual(['a.pdf']);
  });

  it('does not remember a file it could not read, and warns', async () => {
    class Denied extends Handle {
      override queryPermission(): Promise<PermissionState> { return Promise.resolve('denied'); }
      requestPermission(): Promise<PermissionState> { return Promise.resolve('denied'); }
    }
    g.showOpenFilePicker = () => Promise.resolve([new Denied('b.pdf', 'kb')]);
    const c = ctx();
    expect(await openViaPicker(c)).toBe('cancelled');
    expect(c.loaded).toHaveLength(0);
    expect(c.warns).toContain('toast.recentFileUnavailable');
    expect(await listRecentFiles()).toHaveLength(0);
  });
});

describe('the picker type filter', () => {
  it('covers every MIME the fallback <input type=file> accepts', () => {
    // The two lists live in different files, so nothing but this notices them diverging. They DID:
    // OPEN_TYPES was PDF + PNG only, so on Chromium the native dialog refused a JPEG that the
    // fallback input accepts and `loadFiles` converts — the enhanced path worse than the plain one.
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    const accept = /<input[^>]*id="fileInput"[^>]*accept="([^"]*)"/.exec(html)?.[1];
    expect(accept, 'could not read #fileInput accept from index.html').toBeTruthy();
    const wanted = (accept as string).split(',').map(x => x.trim()).filter(Boolean);
    const offered = OPEN_TYPES.map(t => t.mime);
    expect(wanted.filter(m => !offered.includes(m))).toEqual([]);
  });

  it('passes those types to the picker, not a narrower hardcoded set', () => {
    // Pins the WIRING as well as the constant: OPEN_TYPES could be right and the call site could
    // pass something else.
    let seen: Array<{ accept: Record<string, string[]> }> | undefined;
    g.showOpenFilePicker = (opts?: { types?: Array<{ accept: Record<string, string[]> }> }) => {
      seen = opts?.types;
      return Promise.reject(new DOMException('x', 'AbortError'));
    };
    return openViaPicker(ctx()).then(() => {
      const mimes = (seen ?? []).flatMap(t => Object.keys(t.accept));
      expect(mimes).toEqual(OPEN_TYPES.map(t => t.mime));
    });
  });
});

describe('renderRecentFiles', () => {
  it('renders nothing when the browser cannot remember handles', async () => {
    // No open picker ⇒ no handles can ever exist ⇒ the File menu must gain no dead affordance.
    await addRecentFile(new Handle('a.pdf', 'ka') as never);
    const c = ctx();
    await renderRecentFiles(c);
    expect(c.container.children).toHaveLength(0);
  });

  it('renders nothing when there are no recents', async () => {
    g.showOpenFilePicker = () => Promise.resolve([]);
    const c = ctx();
    await renderRecentFiles(c);
    expect(c.container.children).toHaveLength(0);
  });

  it('renders one labelled button per recent, newest first', async () => {
    g.showOpenFilePicker = () => Promise.resolve([]);
    await addRecentFile(new Handle('old.pdf', 'k1') as never);
    await addRecentFile(new Handle('new.pdf', 'k2') as never);
    const c = ctx();
    await renderRecentFiles(c);
    const btns = Array.from(c.container.querySelectorAll('button'));
    expect(btns.map(b => b.textContent)).toEqual(['new.pdf', 'old.pdf']);
    // Labelled group, so a bare file name is announced with its heading.
    const group = c.container.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-labelledby')).toBe('recentFilesLabel');
    expect(c.container.querySelector('#recentFilesLabel')).not.toBeNull();
  });

  it('writes the name as TEXT — a filename is untrusted input', async () => {
    g.showOpenFilePicker = () => Promise.resolve([]);
    await addRecentFile(new Handle('<img src=x onerror=alert(1)>.pdf', 'k') as never);
    const c = ctx();
    await renderRecentFiles(c);
    const btn = c.container.querySelector('button') as HTMLButtonElement;
    expect(btn.querySelector('img')).toBeNull();
    expect(btn.textContent).toContain('<img');
  });

  it('drops a recent whose handle can no longer be read, instead of leaving a row that always fails', async () => {
    g.showOpenFilePicker = () => Promise.resolve([]);
    class Gone extends Handle {
      override getFile(): Promise<File> { return Promise.reject(new DOMException('gone', 'NotFoundError')); }
    }
    await addRecentFile(new Gone('gone.pdf', 'kg') as never);
    const c = ctx();
    await renderRecentFiles(c);
    (c.container.querySelector('button') as HTMLButtonElement).click();
    await vi.waitFor(async () => { expect(await listRecentFiles()).toHaveLength(0); });
    expect(c.warns).toContain('toast.recentFileUnavailable');
  });
});
