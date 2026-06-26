# F2b — Mobile Thumbnail ⋮ Action-Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, per-item) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On mobile (≤640px) replace the five tiny overlaid thumbnail controls with one ⋮ button that opens a full-size (≥44px-row) action menu, so every page action has a real touch target. Desktop hover-reveal is unchanged.

**Architecture:** Add a `.thumb-more` ⋮ button per thumbnail; tapping it opens a body-anchored popup of 5 rows (Rotate L/R, Export PDF, Export image, Delete) reusing the existing single-open-menu machinery. Mobile CSS hides the five overlaid controls and shows ⋮; desktop hides ⋮ and keeps the hover overlays.

**Tech Stack:** TypeScript, Vite, vitest (jsdom), real-Chrome via Playwright MCP for the mobile visual check.

## Global Constraints

- No new dependency — reuse the existing `.thumb-img-menu` popup infrastructure in `pageThumbnailPanel.ts`.
- `textContent` over `innerHTML` for user/translation data; never disable i18n escaping.
- The three locale files (`en/fr/ar`) MUST stay key-identical (locale-sync hook).
- oxlint: no non-null `!`, no `==`.
- Per-item commit is pre-authorized; **`git push` is manual** — never push.
- No `Co-Authored-By` trailers. Commit prefixes: `feat:`/`fix:`/`docs:`.
- Spec: `docs/superpowers/specs/2026-06-26-thumbnail-touch-targets-design.md`.

---

### Task 1: ⋮ button + action menu (TS) + i18n key + jsdom tests

**Files:**
- Modify: `src/ui/pageThumbnailPanel.ts`
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`
- Test: `tests/ui/pageThumbnailPanel.test.ts`

**Interfaces:**
- Consumes: existing `onRotate(pageId, delta)`, `onDownload(index)`, `onDelete(pageId)`, `_openImageMenu(anchor, index)`, `_focusSlotAfterRender`.
- Produces: `_openActionMenu(anchor: HTMLElement, index: number, pageId: string): void`; renamed single-open-menu state `_openMenu` / `_closeMenu` / `_onMenuOutside` / `_onMenuKey`; a `.thumb-more` button + `.thumb-action-menu`/`.thumb-action-menu-item` DOM.

- [ ] **Step 1: Write the failing jsdom tests.** Append this describe block to `tests/ui/pageThumbnailPanel.test.ts` (the existing `makeModel`/`makePanel` helpers and the `t` mock are reused — note the mock appends the page number to any label called with `{page}`, so assert by order/class, not text):

```ts
describe('PageThumbnailPanel — mobile ⋮ action menu (F2b)', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    // close any open popup + clear body
    document.querySelectorAll('.thumb-action-menu, .thumb-img-menu').forEach(el => el.remove());
  });

  function makePanelFull(model: DocumentModel) {
    const cbs = {
      onNavigate: vi.fn(), onDelete: vi.fn(), onReorder: vi.fn(), onRotate: vi.fn(),
      onAddPdf: vi.fn(), onDownload: vi.fn(), onDownloadImage: vi.fn(),
    };
    const panel = new PageThumbnailPanel({ container, renderer: makeRenderer(), model, ...cbs });
    return { panel, ...cbs };
  }
  const flush = () => new Promise(r => { setTimeout(r, 0); });

  it('renders a .thumb-more button per thumbnail', async () => {
    const { panel } = makePanelFull(makeModel(3));
    await panel.render();
    const more = container.querySelectorAll('.thumb-more');
    expect(more).toHaveLength(3);
    expect((more[0] as HTMLElement).title).toBe('thumbnail.moreActions');
  });

  it('clicking ⋮ opens an action menu with 5 rows', async () => {
    const { panel } = makePanelFull(makeModel(2));
    await panel.render();
    (container.querySelector('.thumb-more') as HTMLElement).click();
    const menu = document.body.querySelector('.thumb-action-menu');
    expect(menu).not.toBeNull();
    expect(menu?.querySelectorAll('.thumb-action-menu-item')).toHaveLength(5);
  });

  it('rows invoke the correct callbacks (rotate L/R, export PDF, delete)', async () => {
    const { panel, onRotate, onDownload, onDelete } = makePanelFull(makeModel(3));
    await panel.render();
    (container.querySelectorAll('.thumb-more')[1] as HTMLElement).click(); // page-1
    const rows = document.body.querySelectorAll<HTMLElement>('.thumb-action-menu-item');
    rows[0].click(); expect(onRotate).toHaveBeenCalledWith('page-1', 90);
    (container.querySelectorAll('.thumb-more')[1] as HTMLElement).click();
    document.body.querySelectorAll<HTMLElement>('.thumb-action-menu-item')[1].click();
    expect(onRotate).toHaveBeenLastCalledWith('page-1', -90);
    (container.querySelectorAll('.thumb-more')[1] as HTMLElement).click();
    document.body.querySelectorAll<HTMLElement>('.thumb-action-menu-item')[2].click();
    expect(onDownload).toHaveBeenCalledWith(1);
    (container.querySelectorAll('.thumb-more')[1] as HTMLElement).click();
    document.body.querySelectorAll<HTMLElement>('.thumb-action-menu-item')[4].click();
    expect(onDelete).toHaveBeenCalledWith('page-1');
  });

  it('the "export image" row closes the action menu and opens the format menu', async () => {
    const { panel } = makePanelFull(makeModel(2));
    await panel.render();
    (container.querySelector('.thumb-more') as HTMLElement).click();
    document.body.querySelectorAll<HTMLElement>('.thumb-action-menu-item')[3].click();
    expect(document.body.querySelector('.thumb-action-menu')).toBeNull();
    expect(document.body.querySelector('.thumb-img-menu')).not.toBeNull();
  });

  it('Escape closes the open menu', async () => {
    const { panel } = makePanelFull(makeModel(1));
    await panel.render();
    (container.querySelector('.thumb-more') as HTMLElement).click();
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.querySelector('.thumb-action-menu')).toBeNull();
  });

  it('a second ⋮ click toggles the menu closed', async () => {
    const { panel } = makePanelFull(makeModel(1));
    await panel.render();
    const more = container.querySelector('.thumb-more') as HTMLElement;
    more.click();
    expect(document.body.querySelector('.thumb-action-menu')).not.toBeNull();
    more.click();
    expect(document.body.querySelector('.thumb-action-menu')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests, verify they FAIL** (no `.thumb-more` / `_openActionMenu` yet):

Run: `npm run test -- tests/ui/pageThumbnailPanel.test.ts`
Expected: the new "mobile ⋮ action menu (F2b)" tests FAIL; the existing tests still PASS.

- [ ] **Step 3: Rename the single-open-menu state in `pageThumbnailPanel.ts`.** Generalize the format-menu state so both popups share one open/close/dismiss path:
  - Field: `private _imgMenu: HTMLElement | null = null;` → `private _openMenu: HTMLElement | null = null;`
  - In `_openImageMenu`: `if (this._imgMenu) { this._closeImageMenu(); return; }` → `if (this._openMenu) { this._closeMenu(); return; }`; `this._imgMenu = menu;` → `this._openMenu = menu;`; the two `document.addEventListener` lines reference `this._onMenuOutside` / `this._onMenuKey`.
  - Rename `_closeImageMenu()` → `_closeMenu()` (body: `if (!this._openMenu) return; this._openMenu.remove(); this._openMenu = null; document.removeEventListener('click', this._onMenuOutside); document.removeEventListener('keydown', this._onMenuKey);`).
  - Rename the arrow handlers: `_onImgMenuOutside` → `_onMenuOutside = (): void => { this._closeMenu(); };` and `_onImgMenuKey` → `_onMenuKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') this._closeMenu(); };`

- [ ] **Step 4: Add `_openActionMenu` to `pageThumbnailPanel.ts`** (place next to `_openImageMenu`):

```ts
  /**
   * F2b — mobile action menu. The five overlaid hover controls are hidden on narrow
   * viewports (CSS); a single ⋮ button opens this popup of full-height (≥44px) rows
   * so every page action gets a real touch target. Body-anchored + fixed-positioned
   * (the narrow overflow-x strip would clip an in-strip popup). Reuses the shared
   * single-open-menu state, so opening this closes any format menu and vice versa.
   */
  private _openActionMenu(anchor: HTMLElement, index: number, pageId: string): void {
    if (this._openMenu) { this._closeMenu(); return; } // toggle
    const menu = document.createElement('div');
    menu.className = 'thumb-action-menu';
    menu.setAttribute('role', 'menu');
    const rows: { icon: string; labelKey: string; isExportImg?: boolean; run: () => void }[] = [
      { icon: '↺', labelKey: 'thumbnail.rotateCcw', run: () => this.onRotate(pageId, 90) },
      { icon: '↻', labelKey: 'thumbnail.rotateCw', run: () => this.onRotate(pageId, -90) },
      { icon: '📄', labelKey: 'thumbnail.exportPagePdf', run: () => this.onDownload(index) },
      { icon: '🖼', labelKey: 'thumbnail.exportPageImg', isExportImg: true, run: () => { this._closeMenu(); this._openImageMenu(anchor, index); } },
      { icon: '×', labelKey: 'thumbnail.deletePage', run: () => { this._focusSlotAfterRender = index; this.onDelete(pageId); } },
    ];
    for (const row of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.className = 'thumb-action-menu-item';
      const ic = document.createElement('span');
      ic.className = 'thumb-action-icon';
      ic.textContent = row.icon;
      const lb = document.createElement('span');
      lb.textContent = t(row.labelKey, { page: index + 1 });
      btn.append(ic, lb);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!row.isExportImg) this._closeMenu(); // export-img closes inside run() before opening the format menu
        row.run();
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    Object.assign(menu.style, {
      position: 'fixed',
      top: `${rect.bottom + 2}px`,
      left: `${rect.left}px`,
      zIndex: '1000',
    } as Partial<CSSStyleDeclaration>);
    this._openMenu = menu;
    setTimeout(() => {
      document.addEventListener('click', this._onMenuOutside, { once: true });
      document.addEventListener('keydown', this._onMenuKey);
    }, 0);
  }
```

- [ ] **Step 5: Add the ⋮ button to the thumbnail DOM in `render()`.** After the `dlImgBtn` block and before `item.appendChild(img)`, add:

```ts
      // F2b — mobile "more actions" trigger (hidden on desktop via CSS; the five
      // overlaid controls above are hidden on mobile). Opens the action menu.
      const moreBtn = document.createElement('button');
      moreBtn.className = 'thumb-more';
      moreBtn.type = 'button';
      moreBtn.textContent = '⋮';
      moreBtn.title = t('thumbnail.moreActions');
      moreBtn.setAttribute('aria-haspopup', 'menu');
      moreBtn.addEventListener('click', (e) => { e.stopPropagation(); this._openActionMenu(moreBtn, i, page.id); });
```

  Then append it alongside the other controls — add `item.appendChild(moreBtn);` after `item.appendChild(del);`.

- [ ] **Step 6: Add the `thumbnail.moreActions` i18n key to all three locales.** In each of `locales/en.json`, `locales/fr.json`, `locales/ar.json`, add to the `"thumbnail"` object after `"addPagesTitle"` (add a comma to the prior line):
  - en: `"moreActions": "Page actions"`
  - fr: `"moreActions": "Actions de page"`
  - ar: `"moreActions": "إجراءات الصفحة"`  ← `[Unverified]` — needs native review.

- [ ] **Step 7: Run the tests, verify they PASS.**

Run: `npm run test -- tests/ui/pageThumbnailPanel.test.ts`
Expected: ALL pass (the 6 new + all existing).

- [ ] **Step 8: type-check + lint.**

Run: `npm run type-check && npm run lint`
Expected: 0 errors.

- [ ] **Step 9: Commit.**

```bash
git add src/ui/pageThumbnailPanel.ts locales/en.json locales/fr.json locales/ar.json tests/ui/pageThumbnailPanel.test.ts
git commit -m "feat(thumbnails): mobile ⋮ action menu — DOM + wiring + i18n"
```

---

### Task 2: Mobile CSS — hide overlays, show ⋮, 44px menu rows

**Files:**
- Modify: `src/styles/pdf-layers.css`

**Interfaces:**
- Consumes: the `.thumb-more` / `.thumb-action-menu` / `.thumb-action-menu-item` / `.thumb-action-icon` class names produced by Task 1.

- [ ] **Step 1: Add the `.thumb-more` base rule + menu styles** to `pdf-layers.css`, immediately after the `.thumb-dl-img` rule (`:167`) and before `.thumb-add-btn`:

```css
/* F2b — mobile-only "more actions" trigger. display:none on desktop (which keeps
   its hover-reveal overlays); the media query below flips it to flex on ≤640px. */
.thumb-more {
  position: absolute; inset-block-start: 1px; inset-inline-end: 1px;
  width: 30px; height: 30px; border-radius: 4px;
  background: rgba(0,0,0,0.55); color: white;
  border: none; cursor: pointer;
  font-size: 18px; line-height: 1; font-weight: 700;
  display: none; align-items: center; justify-content: center; padding: 0;
}
/* The action menu (body-anchored; position set inline). Rows are ≥44px touch targets. */
.thumb-action-menu {
  display: flex; flex-direction: column;
  background: #fff; border: 1px solid #cbd5e1; border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 4px; gap: 2px; min-width: 180px;
}
.thumb-action-menu-item {
  display: flex; align-items: center; gap: 10px;
  min-height: 44px; padding: 0 12px;
  border: none; background: none; cursor: pointer;
  font-size: 14px; color: #1e293b; text-align: start; border-radius: 4px;
}
.thumb-action-menu-item:hover { background: #f1f5f9; }
.thumb-action-icon { font-size: 16px; width: 20px; text-align: center; flex-shrink: 0; }
```

- [ ] **Step 2: Rewrite the `@media (max-width: 640px)` block** (`:183-196`) — drop the now-dead enlarge rules for the overlaid controls; hide them and surface ⋮:

```css
@media (max-width: 640px) {
  .page-thumb-container { padding: 4px 6px; }
  .thumb-item { width: 50px; height: 74px; }
  .thumb-add-btn { width: 50px; min-height: 74px; }
  /* F2b: five 44px touch targets can't tile a 50×74 thumbnail — hide the overlaid
     controls and surface a single ⋮ that opens a full-size action menu instead. */
  .thumb-rotate, .thumb-dl, .thumb-delete { display: none; }
  .thumb-more { display: flex; }
}
```

- [ ] **Step 3: type-check + lint** (lint covers `.ts`; the CSS change is structural — verify no TS regression):

Run: `npm run type-check && npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit.**

```bash
git add src/styles/pdf-layers.css
git commit -m "feat(thumbnails): mobile CSS — hide overlays, show ⋮, 44px menu rows"
```

---

### Task 3: Live mobile verification + full deploy gate + docs

**Files:**
- Modify: `CLAUDE.md` (thumbnail gotcha note)
- Evidence: `qa-shots/f2b/` (before/after screenshots)

- [ ] **Step 1: Start the dev server** (background) and confirm it serves:

Run: `npm run dev` (background) → wait for `http://localhost:5173/pdfturbo/` (or note the fallback port 5174/5175).

- [ ] **Step 2: Live mobile check via Playwright MCP.** `browser_navigate` to the dev URL, `browser_resize` 375×812, upload a multi-page PDF (`browser_file_upload`). Then via `browser_evaluate`:
  - assert each `.thumb-rotate/.thumb-dl/.thumb-delete` computes `getComputedStyle(el).display === 'none'`;
  - assert `.thumb-more` is visible (`display !== 'none'`);
  - tap a `.thumb-more`; assert `.thumb-action-menu-item` rows each have `getBoundingClientRect().height >= 44`;
  - tap the Delete row; assert the thumbnail count drops by one.
  - Capture **before** (mobile thumbnails, menu closed) and **after** (menu open, rows visible) screenshots to `qa-shots/f2b/`.

- [ ] **Step 3: Run the FULL deploy gate** (a green local `test` alone is not the CI gate):

Run:
```bash
npm audit --audit-level=high \
  && npm run ocr:assets \
  && npm run type-check \
  && npm run lint \
  && npm run test \
  && npm run test:browser \
  && npm run test:coverage:export \
  && npm run build
```
Expected: every step exits 0. (The full browser suite has known non-deterministic canvas/pixel flakiness — re-run any flaky failure in isolation before treating it as a regression.)

- [ ] **Step 4: Update `CLAUDE.md`** — add a short gotcha under the thumbnail/UI notes recording the mobile ⋮ action-menu pattern (overlaid controls are desktop-hover-only; mobile uses the single ⋮ → `.thumb-action-menu`; guarded by the jsdom F2b tests + live @375px evidence).

- [ ] **Step 5: Commit.**

```bash
git add CLAUDE.md qa-shots/f2b
git commit -m "docs: record F2b mobile thumbnail action-menu + live evidence"
```

- [ ] **Step 6: Update the program plan + memory** — mark F2b DONE in `docs/plans/maxfidelity-program-2026-06-25.plan.md` Decisions Log and the memory pointer; note commits are unpushed (push is manual).

## Self-Review

- **Spec coverage:** behavior split (T1+T2), 5-row menu + export-image submenu (T1 Step 4), mobile CSS hide/show + 44px rows (T2), one i18n key (T1 Step 6), jsdom wiring tests (T1) + live @375px evidence (T3), full gate (T3). All spec sections map to a task.
- **Placeholder scan:** none — all steps carry real code/commands.
- **Type consistency:** `_openMenu`/`_closeMenu`/`_onMenuOutside`/`_onMenuKey` renamed uniformly across `_openImageMenu`, `_closeMenu`, and `_openActionMenu`; `_openActionMenu(anchor, index, pageId)` signature matches the `render()` call site; menu class names (`.thumb-action-menu`/`-item`/`.thumb-action-icon`/`.thumb-more`) match between TS (T1) and CSS (T2) and tests.
- **Note:** the mobile-CSS assertions (display:none / 44px rows) are real-browser-only (jsdom applies no CSS), so they live in the live Playwright check (T3) — the jsdom tests guard DOM/wiring; this mirrors the F1/F2/F3 verification precedent from the same QA cycle.
