/**
 * Thumbnail keyboard activation — NATIVE, in a real browser.
 *
 * WHY THIS FILE EXISTS: the 2026-07-29 `nested-interactive` fix removed
 * `role="button"` + `tabindex="0"` from `.thumb-item` (a control containing the
 * rotate/export/delete controls) and moved the page-navigation affordance into a real
 * `<button class="thumb-nav">`. The hand-rolled Enter/Space keydown handler was DELETED, not
 * moved — a native button performs activation and suppresses Space-scrolling by itself, and
 * keeping the handler alongside that would fire `onNavigate` TWICE per Enter.
 *
 * That leaves the activation behaviour with no automated guard, because **jsdom does not
 * synthesise a click from a keydown**, so `tests/ui/pageThumbnailPanel.test.ts` can only assert
 * the structural precondition (the control is a real `<button>`). A synthetic `KeyboardEvent`
 * would not help either: dispatched events do not run a browser's default action. Only real
 * input does, which is what `userEvent` drives here over CDP.
 *
 * Without this file, deleting `.thumb-nav`'s button-ness — or reintroducing the old keydown
 * handler and double-firing — would pass every test in the repo.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { userEvent } from 'vitest/browser';
import { PageThumbnailPanel } from '../../src/ui/pageThumbnailPanel';
import { DocumentModel } from '../../src/core/documentModel';
import { initI18n } from '../../src/utils/i18n';
import type { PDFRenderer } from '../../src/infra/pdfRenderer';

function makeModel(pageCount: number): DocumentModel {
  const model = new DocumentModel();
  for (let i = 0; i < pageCount; i++) {
    model.pages.push({
      id: `page-${i}`, sourcePdfId: 'src', sourcePageNum: i + 1,
      rotation: 0, blankWidth: undefined, blankHeight: undefined,
    });
  }
  model.currentPageIndex = 0;
  return model;
}

let container: HTMLElement;
// Typed to the real callback signature: a bare ReturnType<typeof vi.fn> widens to
// Mock<Constructable | Procedure>, which tsc rejects against (index: number) => void.
let onNavigate: Mock<(index: number) => void>;
let panel: PageThumbnailPanel;

beforeAll(async () => {
  // The panel labels each nav button via t('thumbnail.goToPage'), so i18n must be live.
  await initI18n();
});

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  onNavigate = vi.fn<(index: number) => void>();
  panel = new PageThumbnailPanel({
    container,
    // generateThumbnail is irrelevant here: activation is DOM behaviour, and a null thumb
    // leaves the placeholder image in place, which is enough to click.
    renderer: { generateThumbnail: vi.fn().mockResolvedValue(null) } as unknown as PDFRenderer,
    model: makeModel(3),
    onNavigate,
    onDelete: vi.fn(), onReorder: vi.fn(), onRotate: vi.fn(),
    onAddPdf: vi.fn(), onDownload: vi.fn(), onDownloadImage: vi.fn(),
  });
  await panel.render();
});

afterEach(() => { container.remove(); });

function nav(index: number): HTMLButtonElement {
  const el = container.querySelectorAll<HTMLButtonElement>('.thumb-item .thumb-nav')[index];
  if (!el) throw new Error(`no .thumb-nav at index ${index}`);
  return el;
}

describe('thumbnail nav button — native keyboard activation', () => {
  it('is reachable by Tab (the tile itself is not a tab stop)', () => {
    nav(0).focus();
    expect(document.activeElement).toBe(nav(0));
    // The tile must not be focusable, or Tab would stop twice per thumbnail.
    const tile = container.querySelectorAll<HTMLElement>('.thumb-item')[0];
    expect(tile.getAttribute('tabindex')).toBeNull();
    expect(tile.getAttribute('role')).toBeNull();
  });

  it('Enter navigates exactly ONCE (native activation, no double-fire)', async () => {
    nav(1).focus();
    await userEvent.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith(1);
    // The regression this guards: a reintroduced keydown handler would make this 2.
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('Space navigates exactly ONCE and does not scroll the page', async () => {
    // Make the document scrollable so a Space-scroll would be observable.
    const tall = document.createElement('div');
    tall.style.height = '4000px';
    document.body.appendChild(tall);
    window.scrollTo(0, 0);
    try {
      nav(2).focus();
      await userEvent.keyboard(' ');
      expect(onNavigate).toHaveBeenCalledWith(2);
      expect(onNavigate).toHaveBeenCalledTimes(1);
      // A native button consumes Space; the page must not have scrolled.
      expect(window.scrollY).toBe(0);
    } finally {
      tall.remove();
    }
  });

  it('activating an overlay control does NOT navigate (children stopPropagation)', async () => {
    const del = container.querySelectorAll<HTMLElement>('.thumb-item')[1]
      .querySelector<HTMLButtonElement>('.thumb-delete');
    expect(del).not.toBeNull();
    del?.focus();
    await userEvent.keyboard('{Enter}');
    // Delete is handled by its own listener; the tile's click handler must not also fire.
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
