// @vitest-environment jsdom
/**
 * #54b — remembered file handles. The behaviour that matters is de-duplication by IDENTITY (not by
 * name) and failing soft, because both failure modes are silent: a name-keyed list opens the WRONG
 * document, and a throw here would break the open flow for a feature that is pure convenience.
 */
import 'fake-indexeddb/auto';   // a real IndexedDB implementation, not a stub
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { addRecentFile, listRecentFiles, removeRecentFile, clearRecentFiles, RECENT_CAP } from '../../src/infra/recentFiles';
import type { FsOpenHandle } from '../../src/utils/fileSystemAccess';

/**
 * A fake handle, shaped like the real thing on the one axis that matters here: its methods live on
 * the PROTOTYPE, not as own properties.
 *
 * That is not a stylistic choice. IndexedDB stores values by structured clone, which throws
 * `DataCloneError` on a function-valued own property — so a fake built with `{ getFile: () => … }`
 * makes every `put` fail and every list come back empty. A real `FileSystemFileHandle` is a platform
 * object with prototype methods and IS cloneable, which is the whole premise of this feature.
 *
 * The consequence for these tests, stated because it bounds what they can prove: the clone keeps own
 * enumerable properties only, so a handle read back out of the store here has `name` and `key` but no
 * methods. That is a jsdom artefact — a browser round-trips the live handle — so anything that CALLS
 * a method on a STORED handle (permission re-request, re-reading the file) is covered by the real
 * browser guard instead, never here.
 */
class FakeHandle {
  constructor(public name: string, public key: string) {}
  getFile(): Promise<File> { return Promise.resolve(new File([], this.name)); }
  isSameEntry(other: unknown): Promise<boolean> {
    return Promise.resolve((other as { key?: string }).key === this.key);
  }
}
/** Same, without `isSameEntry` — the implementations that do not expose it. */
class BareHandle {
  constructor(public name: string, public key: string) {}
  getFile(): Promise<File> { return Promise.resolve(new File([], this.name)); }
}
/** Same, but its identity check REJECTS — a handle whose entry has gone away. */
class StaleHandle extends FakeHandle {
  override isSameEntry(): Promise<boolean> { return Promise.reject(new Error('stale')); }
}
const fakeHandle = (name: string, key = name): FsOpenHandle =>
  new FakeHandle(name, key) as unknown as FsOpenHandle;
const bareHandle = (name: string, key = name): FsOpenHandle =>
  new BareHandle(name, key) as unknown as FsOpenHandle;

describe('recentFiles', () => {
  beforeEach(async () => { await clearRecentFiles(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('remembers a handle and returns it', async () => {
    await addRecentFile(fakeHandle('a.pdf'));
    const list = await listRecentFiles();
    expect(list.map(r => r.name)).toEqual(['a.pdf']);
  });

  it('orders newest first', async () => {
    await addRecentFile(fakeHandle('old.pdf'));
    await addRecentFile(fakeHandle('new.pdf'));
    expect((await listRecentFiles()).map(r => r.name)).toEqual(['new.pdf', 'old.pdf']);
  });

  it('orders correctly even when several are added within the SAME millisecond', async () => {
    // The clock is frozen deliberately. Opening a multi-file selection adds every handle inside one
    // millisecond, `Date.now()` ties, and a stable sort then falls back to insertion order — so the
    // list came out oldest-first for exactly the case that adds more than one entry.
    //
    // Without the freeze this case is a COIN FLIP: it caught the defect on a fast run and passed on
    // a slower one where the two adds landed in different milliseconds. A guard that depends on how
    // busy the machine is cannot pin anything (CLAUDE.md § "A flaky gate"), so the tie is forced
    // rather than hoped for.
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      await addRecentFile(fakeHandle('first.pdf', 'k1'));
      await addRecentFile(fakeHandle('second.pdf', 'k2'));
      await addRecentFile(fakeHandle('third.pdf', 'k3'));
      expect((await listRecentFiles()).map(r => r.name))
        .toEqual(['third.pdf', 'second.pdf', 'first.pdf']);
    } finally {
      now.mockRestore();
    }
  });

  it('de-duplicates by isSameEntry, moving the existing entry to the front', async () => {
    await addRecentFile(fakeHandle('a.pdf'));
    await addRecentFile(fakeHandle('b.pdf'));
    await addRecentFile(fakeHandle('a.pdf'));           // same entry, a NEW handle object
    const list = await listRecentFiles();
    expect(list.map(r => r.name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('keeps two DIFFERENT files that share a name — the whole reason identity is not the name', async () => {
    // `invoice.pdf` from two folders. A name-keyed list collapses these into one row and then
    // opens whichever handle it kept, i.e. silently the wrong document.
    await addRecentFile(fakeHandle('invoice.pdf', '/work/invoice.pdf'));
    await addRecentFile(fakeHandle('invoice.pdf', '/home/invoice.pdf'));
    expect(await listRecentFiles()).toHaveLength(2);
  });

  it('adds without de-duplication when isSameEntry is unavailable', async () => {
    // A duplicate row is cosmetic; opening the wrong file is not. So the fallback is to add.
    await addRecentFile(bareHandle('a.pdf'));
    await addRecentFile(bareHandle('a.pdf'));
    expect(await listRecentFiles()).toHaveLength(2);
  });

  it(`trims to ${RECENT_CAP}, dropping the oldest`, async () => {
    for (let i = 0; i < RECENT_CAP + 3; i++) await addRecentFile(fakeHandle(`f${i}.pdf`, `k${i}`));
    const list = await listRecentFiles();
    expect(list).toHaveLength(RECENT_CAP);
    expect(list[0].name).toBe(`f${RECENT_CAP + 2}.pdf`);
    expect(list.map(r => r.name)).not.toContain('f0.pdf');
  });

  it('forgets one entry', async () => {
    await addRecentFile(fakeHandle('a.pdf'));
    await addRecentFile(fakeHandle('b.pdf', 'kb'));
    const [first] = await listRecentFiles();
    await removeRecentFile(first.id);
    expect((await listRecentFiles()).map(r => r.name)).toEqual(['a.pdf']);
  });

  it('survives a handle whose isSameEntry REJECTS — a stale entry must not break the list', async () => {
    await addRecentFile(fakeHandle('a.pdf'));
    await addRecentFile(new StaleHandle('b.pdf', 'kb') as unknown as FsOpenHandle);
    expect((await listRecentFiles()).map(r => r.name)).toEqual(['b.pdf', 'a.pdf']);
  });

  it('does not throw when the handle cannot be structured-cloned, and keeps the existing list', async () => {
    // Found by getting the case above wrong: attaching a method as an OWN property makes the object
    // un-cloneable, and IndexedDB rejects it with DataCloneError. Remembering is best-effort — the
    // document the user just opened is already open — so the add is dropped and nothing is lost.
    await addRecentFile(fakeHandle('a.pdf'));
    const uncloneable = fakeHandle('b.pdf', 'kb');
    (uncloneable as { own?: unknown }).own = () => undefined;   // own function property
    await expect(addRecentFile(uncloneable)).resolves.toBeUndefined();
    expect((await listRecentFiles()).map(r => r.name)).toEqual(['a.pdf']);
  });
});
