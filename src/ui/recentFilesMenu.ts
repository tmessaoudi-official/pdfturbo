/**
 * #54b — "Open…" via the native picker, plus a recent-files list in the File menu.
 *
 * Progressive enhancement, exactly like the save side: where `showOpenFilePicker` exists the user
 * gets the native dialog AND the file is remembered; everywhere else the hidden `<input type=file>`
 * is untouched and there are simply no recents. Nothing here is required for opening a document.
 *
 * Two behaviours are easy to get wrong and are pinned by tests:
 *
 *  - **A dismissed picker must NOT fall through to the input.** Cancelling would otherwise be
 *    answered with a second file dialog. `pickOpenFiles` distinguishes `'cancelled'` from
 *    `'unavailable'` for this single reason.
 *  - **A remembered handle is re-authorised at click time, never speculatively.** `requestPermission`
 *    needs transient user activation, so probing on startup would either throw or train the user to
 *    dismiss a prompt they never asked for.
 */
import type { IErrorReporter } from '../core/errorReporter';
import { pickOpenFiles, ensureReadPermission, canUseFsOpen, type FsOpenHandle } from '../utils/fileSystemAccess';
import { addRecentFile, listRecentFiles, removeRecentFile } from '../infra/recentFiles';
import { t } from '../utils/i18n';

/** What the menu needs from the app — deliberately narrow, so this stays unit-testable. */
export interface RecentMenuCtx {
  /** The DocumentLoader's shared entry point (`loadFiles`), not the input-event one. */
  loadFiles(files: File[]): Promise<void>;
  reportError: IErrorReporter;
  /** The `<div>` inside the File menu that holds the list. */
  container: HTMLElement;
  /** Close the File menu after a choice. */
  closeMenu(): void;
}

const OPEN_TYPES = [
  { description: 'PDF document', mime: 'application/pdf', ext: '.pdf' },
  { description: 'Image', mime: 'image/png', ext: '.png' },
];

/** Outcome of the picker-first open, so the caller knows whether to use the fallback input. */
export type OpenOutcome = 'opened' | 'cancelled' | 'fallback';

/**
 * Open through the native picker. Returns `'fallback'` when the API is unavailable or refused — and
 * ONLY then should the caller click the hidden input.
 *
 * Must be invoked directly from the click handler: `pickOpenFiles` is the first await, so the
 * transient user activation that the picker requires is still live.
 */
export async function openViaPicker(ctx: RecentMenuCtx): Promise<OpenOutcome> {
  const picked = await pickOpenFiles(OPEN_TYPES);
  if (picked === 'unavailable') return 'fallback';
  if (picked === 'cancelled') return 'cancelled';

  const files: File[] = [];
  for (const handle of picked) {
    const file = await fileFromHandle(handle, ctx);
    if (file) files.push(file);
  }
  if (files.length === 0) return 'cancelled';
  await ctx.loadFiles(files);
  // Remembered only AFTER the load: a file that could not be opened is not worth offering again.
  for (const handle of picked) await addRecentFile(handle);
  await renderRecentFiles(ctx);
  return 'opened';
}

/** Read a handle, re-authorising first. Reports and returns null when it cannot be read. */
async function fileFromHandle(handle: FsOpenHandle, ctx: RecentMenuCtx): Promise<File | null> {
  if (!await ensureReadPermission(handle)) {
    ctx.reportError.warn('toast.recentFileUnavailable', { name: handle.name });
    return null;
  }
  try {
    return await handle.getFile();
  } catch (err) {
    // The entry moved, was deleted, or the grant lapsed between the check and the read.
    ctx.reportError.warn('toast.recentFileUnavailable', { name: handle.name });
    void err;
    return null;
  }
}

/**
 * Re-render the recent list into `ctx.container`. Safe to call at any time; renders nothing when the
 * browser has no open picker (there can be no handles to remember) or when the list is empty, so the
 * File menu gains no dead affordance on Firefox or Safari.
 */
export async function renderRecentFiles(ctx: RecentMenuCtx): Promise<void> {
  ctx.container.replaceChildren();
  if (!canUseFsOpen()) return;
  const recents = await listRecentFiles();
  if (recents.length === 0) return;

  const label = document.createElement('div');
  label.className = 'file-menu-label';
  label.id = 'recentFilesLabel';
  label.textContent = t('toolbar.recentFiles');
  ctx.container.appendChild(label);

  const group = document.createElement('div');
  // The buttons are a labelled group so the short file names are announced with their heading —
  // the same `role="group"` + `aria-labelledby` pattern the sign X/Y/W/H row uses.
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', 'recentFilesLabel');

  for (const r of recents) {
    const btn = document.createElement('button');
    btn.className = 'file-menu-item file-menu-recent';
    btn.type = 'button';
    // textContent, never innerHTML: the name comes from the user's filesystem.
    btn.textContent = r.name;
    btn.title = r.name;
    btn.dataset.recentId = r.id;
    btn.addEventListener('click', () => {
      ctx.closeMenu();
      void (async () => {
        const file = await fileFromHandle(r.handle, ctx);
        if (!file) {
          // Unreadable: drop it rather than leaving a row that fails every time it is clicked.
          await removeRecentFile(r.id);
          await renderRecentFiles(ctx);
          return;
        }
        await ctx.loadFiles([file]);
        await addRecentFile(r.handle);   // move to the front
        await renderRecentFiles(ctx);
      })();
    });
    group.appendChild(btn);
  }
  ctx.container.appendChild(group);
}
