# F2b — Mobile Page-Thumbnail Touch-Target Redesign (⋮ action menu)

**Date:** 2026-06-26
**Status:** Approved (brainstorming) → ready for implementation plan
**Source finding:** QA-sweep 2026-06-26 (`qa-sweep/2026-06-26-qa-sweep.md`), DESIGN MOBILE / F2 sub-finding.

## Problem

On narrow viewports (`@media (max-width:640px)`, `src/styles/pdf-layers.css:183`) each page thumbnail
is **50×74px** with **five controls overlaid**, all forced `opacity:1` (hover never fires on touch):

- ↺ / ↻ rotate — 18×18px
- 📄 / 🖼 export (PDF / image) — 18×18px, stacked top-left
- × delete — 20×20px, top-right

None reach the **44×44px** touch-target guideline (axe / WCAG 2.5.5), and at 18–20px on a 50px-wide
tile they crowd the image and each other. A CSS size bump cannot fix this: five 44px targets physically
cannot tile a 50×74px thumbnail without total overlap. This requires a **layout redesign**, not a tweak.

Desktop (>640px) hover-reveal is fine and is explicitly **out of scope** — it stays byte-for-byte as-is.

## Approach (selected)

**Mobile-only ⋮ action menu.** On `≤640px`, hide the five overlaid controls and replace them with a
single **⋮ "more actions"** button per thumbnail. Tapping it opens a popup menu whose rows are each
**≥44px tall**, so every action gets a real touch target. The whole 50×74 tile remains the page-navigation
tap target.

Rejected alternatives (recorded for context):
- *Bigger overlaid buttons* — five 44px targets can't tile a 50×74px thumbnail; still fails axe.
- *Controls in a row below the image* — still width-constrained by the 50px tile; adds strip clutter.

## Behavior

### Desktop (>640px) — UNCHANGED
The five overlaid buttons reveal on `:hover` exactly as today. The new `.thumb-more` button is
`display:none`.

### Mobile (≤640px)
- The five overlaid controls (`.thumb-rotate`, `.thumb-dl`, `.thumb-delete`) become `display:none`.
  They remain in the DOM (desktop uses them); only the media query hides them.
- A single **⋮ button** (`.thumb-more`) sits in the top-right corner, `opacity:1`, ~30×30px, semi-transparent
  dark background matching the existing overlay controls. It calls `stopPropagation()` so it never triggers
  page navigation.
- Tapping ⋮ opens a **body-anchored, fixed-position popup** (so the narrow `overflow-x:auto` strip never
  clips it) with these rows, in order:

  | Row | Icon | Label key | Action |
  |---|---|---|---|
  | Rotate left | ↺ | `thumbnail.rotateCcw` | `onRotate(pageId, 90)` |
  | Rotate right | ↻ | `thumbnail.rotateCw` | `onRotate(pageId, -90)` |
  | Export page (PDF) | 📄 | `thumbnail.exportPagePdf` (`{page}`) | `onDownload(i)` |
  | Export as image | 🖼 | `thumbnail.exportPageImg` (`{page}`) | opens the existing 3-format submenu |
  | Delete page | × | `thumbnail.deletePage` | sets `_focusSlotAfterRender=i`, `onDelete(pageId)` |

- Each row is `icon + text`, min-height **44px**, full-width tap target.
- **Export as image** closes the action menu and opens the existing image-format popup
  (`_openImageMenu` → PNG / JPEG / Hi-res PNG), preserving feature parity. Never two menus open at once.
- Dismiss: outside-click or Escape. Only one menu open at a time.

## Architecture

### `src/ui/pageThumbnailPanel.ts`
1. **Add `.thumb-more` button** to each thumbnail item in `render()` (after the existing controls, before
   `item` event wiring). `textContent = '⋮'`, `title = t('thumbnail.moreActions')`,
   click → `stopPropagation()` + `_openActionMenu(btn, i, page)`.
2. **Generalize the single-open-menu state.** Rename the existing `_imgMenu` field → `_openMenu`
   (generic "currently-open popup"); `_closeImageMenu` → `_closeMenu`; the outside/key arrow handlers
   stay but reference `_closeMenu`. `_openImageMenu` keeps building the **format** popup but stores into
   `_openMenu`. This guarantees one open menu and one dismiss path shared by both popups.
3. **New `_openActionMenu(anchor, index, page)`** — builds the five-row menu described above into
   `_openMenu`, positioned `fixed` at the anchor (same positioning logic as `_openImageMenu`). The
   "Export as image" row calls `this._closeMenu()` then `this._openImageMenu(anchor, index)`.
4. Menu DOM uses CSS classes (`.thumb-action-menu` / `.thumb-action-menu-item`) for structure/sizing
   (44px rows); only `position/top/left/zIndex` are set inline (mirrors the existing format-menu pattern,
   which the narrow strip requires for clip-free placement on `document.body`).

### `src/styles/pdf-layers.css`
1. `.thumb-more` base rule — corner button, `display:none` by default (desktop keeps its hover controls).
2. In `@media (max-width:640px)`:
   - `.thumb-rotate, .thumb-dl, .thumb-delete { display: none; }`
   - `.thumb-more { display: flex; opacity: 1; … }` (~30×30, top-right corner).
3. `.thumb-action-menu` (column, white card, border, shadow, rounded) + `.thumb-action-menu-item`
   (`min-height:44px`, full-width, `icon+label` flex row, hover/active background). These can live
   outside the media query (the menu only ever opens on mobile, but defining them globally is harmless
   and keeps the rule near the other `.thumb-*` rules).

### i18n (`locales/{en,fr,ar}.json`)
- **One new key:** `thumbnail.moreActions` — the ⋮ button title / aria-label.
  - en: `"Page actions"` · fr: `"Actions de page"` · ar: `"إجراءات الصفحة"` `[Unverified]`.
- Row labels **reuse** the existing keys (`rotateCcw`, `rotateCw`, `exportPagePdf`, `exportPageImg`,
  `deletePage`) — already present and translated in all three locales. The locale-sync hook stays green
  because the single new key is added to all three.

## Testing & evidence

### jsdom — `tests/ui/pageThumbnailPanel.test.ts`
- A `.thumb-more` button is rendered for each thumbnail with the `moreActions` title.
- Clicking `.thumb-more` appends a `.thumb-action-menu` to `document.body` with **5** `.thumb-action-menu-item`
  rows.
- Each row invokes the correct callback: Rotate-left → `onRotate(pageId, 90)`, Rotate-right →
  `onRotate(pageId, -90)`, Export-PDF → `onDownload(index)`, Delete → `onDelete(pageId)`.
- The "Export as image" row closes the action menu and opens the existing `.thumb-img-menu` (format) popup.
- Outside-click and Escape close the open menu.
- Opening the action menu while another menu is open closes the first (single-open invariant).

### real-Chrome @375px — `tests/browser/thumbnail-mobile-actions.browser.test.ts`
- `browser_resize` 375×812. Load a multi-page PDF.
- Assert the five overlaid controls (`.thumb-rotate/.thumb-dl/.thumb-delete`) compute to `display:none`
  and `.thumb-more` is visible.
- Tap `.thumb-more`; assert the menu rows each measure **≥44px** tall (`getBoundingClientRect().height`).
- Tap the Delete row; assert the page count drops by one.
- **Before/after screenshots** to `qa-shots/f2b/`.

### Full deploy gate (before push)
`npm audit --audit-level=high` → `ocr:assets` → type-check → lint → test (jsdom) → test:browser →
`test:coverage:export` → build. All green required.

## Ceiling / non-goals

- The ⋮ trigger itself is ~30px — a 50px tile cannot host a 44px corner button without burying the image.
  The guaranteed ≥44px targets are the **menu rows** plus the **whole-tile page-navigation** tap.
- Mobile thumbnail size stays **50×74** (preserves strip density / tiles-per-row). Enlarging thumbnails was
  considered and declined.
- Drag-to-reorder on mobile is unchanged (existing HTML5 drag on the tile).
- Desktop hover-reveal overlay is unchanged.

## Constraints (inherited)

- No new dependency; reuse the existing popup infrastructure.
- `textContent` over `innerHTML` for all user/translation data (i18n escaping rule).
- oxlint: no non-null `!`, no `==`.
- Per-item commit pre-authorized for this program; **push is manual**.
- No `Co-Authored-By` trailers.
