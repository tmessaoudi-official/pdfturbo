// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PlacementManager, type IPlacementContext } from '../../src/ui/placementManager';

/**
 * The placement ghost — the dashed box that follows the pointer in a placement mode — shows where the element will
 * land ON THE PAGE. It is `position:fixed; z-index:9999`, above every dialog but the session-restore one
 * (10000), and until 2026-11-11 it followed the
 * pointer over an open dialog too: over the ✍ modal's drawing pad, and (phone-signature-pad step 5a) over the QR code
 * a phone has to scan. Mounted on the REAL `#signatureModal` markup of index.html, so the dialog role cannot drift.
 */

const INDEX = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

function setup(mode: IPlacementContext['mode'] = 'addSignature') {
  const doc = new DOMParser().parseFromString(INDEX, 'text/html');
  const modal = doc.getElementById('signatureModal');
  if (!modal) throw new Error('#signatureModal missing from index.html');
  document.body.innerHTML = '<div id="page"></div>';
  document.body.append(document.importNode(modal, true));
  const ctx = { mode } as unknown as IPlacementContext;
  const mgr = new PlacementManager(ctx);
  const move = (target: Element, clientX = 100, clientY = 200) =>
    mgr.updatePlacementGhost({ target, clientX, clientY } as unknown as PointerEvent);
  const ghost = () => Array.from(document.body.children).find((e) => (e as HTMLElement).style.zIndex === '9999') as HTMLElement | undefined;
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  return { move, ghost, page: $('page'), modal: $('signatureModal'), pad: $('signatureCanvas') };
}

describe('placement ghost', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('follows the pointer over the page, 12 px down and right of it (control)', () => {
    const { move, ghost, page } = setup();
    move(page, 100, 200);
    const g = ghost();
    expect(g?.style.display).toBe('flex');
    expect([g?.style.left, g?.style.top]).toEqual(['112px', '212px']);
  });

  it('is not shown while the pointer is over an open dialog: its content', () => {
    const { move, ghost, pad } = setup();
    move(pad);
    expect(ghost()?.style.display ?? 'none').toBe('none');
  });

  it('is not shown while the pointer is over an open dialog: its backdrop (the dialog element itself)', () => {
    const { move, ghost, modal } = setup();
    expect(modal.getAttribute('role')).toBe('dialog'); // the predicate's anchor, read from the real markup
    move(modal);
    expect(ghost()?.style.display ?? 'none').toBe('none');
  });

  it('a ghost already on screen is hidden when the pointer moves onto a dialog, and comes back on the page', () => {
    const { move, ghost, page, pad } = setup();
    move(page);
    expect(ghost()?.style.display).toBe('flex');
    move(pad);
    expect(ghost()?.style.display).toBe('none');
    move(page, 300, 50);
    expect(ghost()?.style.display).toBe('flex');
    expect([ghost()?.style.left, ghost()?.style.top]).toEqual(['312px', '62px']);
  });

  it('holds for every placement mode, not only the signature', () => {
    for (const mode of ['addText', 'addComment', 'addImage', 'addSignature'] as const) {
      document.body.innerHTML = '';
      const { move, ghost, page, pad } = setup(mode);
      move(page);
      expect(ghost()?.style.display, `${mode} over the page`).toBe('flex');
      move(pad);
      expect(ghost()?.style.display, `${mode} over a dialog`).toBe('none');
    }
  });
});
