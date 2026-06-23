# Page Ops QA — raw findings (2026-06-23)

Domain: thumbnails, reorder, rotate, insert blank, delete, range export.

Files read:
- src/core/documentModel.ts
- src/core/pageService.ts
- src/core/commands/pageCmds.ts
- src/ui/pageThumbnailPanel.ts
- src/core/pageNavigationController.ts
- src/infra/pdfRenderer.ts (generateThumbnail)
- src/export/exportService.ts (downloadPageRange, renderThumbnailWithOverlays, _applyOverlaysToPage)
- src/export/exportPipeline.ts (crop/cropbox)
- src/utils/pageRange.ts

Overall: the page-ops domain is in good shape. Every page mutation (rotate, crop,
delete, reorder, add, insert-blank) goes through a Command pushed to historyManager,
so undo/redo is structurally sound. Element↔pageId association is keyed by the stable
`page.id` (not index), so reorder is safe; DeletePageCmd snapshots and restores both
the page and its elements (and re-adds a GC'd source on undo). i18n parity is clean
for all page-ops toasts + thumbnail labels (en/fr/ar all present). Findings below are
mostly P2.

---

## P2 — Cropped page WITHOUT overlays renders uncropped in the thumbnail strip (contract violation)

Category: export-positioning / bug
File: src/infra/pdfRenderer.ts:168-177; src/ui/pageThumbnailPanel.ts:170-182

`PageThumbnailPanel._loadThumb` first tries the overlay compositor
(`renderThumbnailWithOverlays` → `_applyOverlaysToPage` → `buildPageOverlays`, which
applies `page.setCropBox(...)` in exportPipeline.ts:220-221). But for a page with NO
overlay elements and NO ink, the compositor returns `null` (exportService.ts:765) and
the panel falls back to `renderer.generateThumbnail(index)`:

```ts
// pdfRenderer.ts generateThumbnail — source-only path
const effectiveRotation = (page.rotate + (docPage.rotation ?? 0)) % 360;
const vp = page.getViewport({ scale: thumbScale, rotation: effectiveRotation });
// ... renders full page; docPage.crop is NEVER read
```

This path applies rotation but never reads `docPage.crop`. So a cropped page that has
no annotations shows its UNCROPPED extent in the strip, while the main canvas and the
exported PDF show the crop. The crop-tool plan explicitly promises the opposite:
docs/plans/crop-tool.plan.md:10 ("Thumbnails + export show the true crop") and :67
("thumbnail always reflects crop"). This is an undocumented contradiction of the
stated contract, not a documented ceiling.

Recommendation: in `generateThumbnail`, when `docPage.crop` is set, compute the
effective crop box (reuse `contentCropToPdfCropBox` / `getPageCropBox`) and pass a
clipped viewport, or route cropped-but-overlay-free pages through the overlay
compositor (have `renderThumbnailWithOverlays` not early-return when `docPage.crop`
is present). Add a browser-test guard asserting a cropped page's thumbnail aspect
ratio matches the crop.

---

## P2 — Thumbnail dataURL cache is never pruned on page delete (bounded memory leak)

Category: bug / performance
File: src/ui/pageThumbnailPanel.ts:35,334-341; src/core/pageService.ts:205-220

`_thumbCache: Map<pageId, dataURL>` only grows in `_loadThumb` (set) and is cleared
wholesale by `invalidateAll()`. The delete path (PageService.deletePage →
DeletePageCmd) calls `onPageStructureChange()` → `render()`, which rebuilds the strip
but never calls `invalidateThumb(deletedPageId)`. The cache entry for the deleted page
persists. Page ids are unique-per-creation (`p_<ts>_<rand>`), so the entry is dead
weight that lives until the next `invalidateAll` (zoom change / source change). On a
long editing session with many delete/insert cycles this accumulates JPEG dataURLs in
memory. Not severe (thumbScale 0.15 JPEGs are small) but it is an unbounded-by-design
leak keyed off a stable id that never returns.

Recommendation: in `DeletePageCmd.execute` (or PageService.deletePage) call
`ctx.invalidateThumbnail(pageId)` before/after the structure change so the stale entry
is evicted. Cheap and correct.

---

## P2 — `onPageStructureChange` silently drops a concurrent refresh (reentrancy guard returns early)

Category: bug / UX
File: src/core/pageNavigationController.ts:18-32

```ts
async onPageStructureChange(): Promise<void> {
  if (this._pageUpdatePending) return;   // <-- drops the call entirely
  this._pageUpdatePending = true;
  try { ...renderCurrentPage / renderThumbnails / ... } finally { this._pageUpdatePending = false; }
}
```

The guard prevents overlapping re-renders, but a second mutation that lands while the
first refresh is mid-`await` (e.g. user hits delete then rotate rapidly, or a
`MacroCmd` whose sub-commands each fire `onUpdate`) is DROPPED, not coalesced. The model
state is correct (commands mutate synchronously) but the UI (current-page raster,
thumbnail strip, page-info) can be left reflecting the intermediate state until the
NEXT mutation. For the `cropPage` applyToAll macro this is mitigated because only the
current page's command calls `onPageStructureChange` once, but for back-to-back user
ops it is a real "stale UI until I touch it again" hazard.

Recommendation: change the guard to a trailing-edge coalescing pattern — if a call
arrives while pending, set a `_rerunRequested` flag and re-run once in the `finally`,
rather than dropping. (Classic debounce-to-trailing-edge.)

---

## P3 — Deleting a page leaves keyboard focus on a removed DOM node (a11y)

Category: a11y / UX
File: src/ui/pageThumbnailPanel.ts:223-230, 185-187

Thumbnail items are `role=button tabindex=0` (good). The delete button lives inside the
item; on click the whole strip is rebuilt (`render()` does `this.strip.innerHTML = ''`).
After a keyboard user activates delete, focus is lost (the focused subtree was wiped),
dropping the user to `document.body`. There is no focus restoration to the
now-current thumbnail.

Recommendation: after a delete-driven `render()`, move focus to the thumbnail at the
new current index (`item.focus()`), so keyboard navigation continues from a sensible
anchor.

---

## P3 — Custom blank-page dimensions accept NaN / non-positive input silently

Category: bug / UX
File: src/core/pageService.ts:280-284

```ts
const mmW = parseFloat((document.getElementById('blankPageW') as HTMLInputElement)?.value ?? '210');
const mmH = parseFloat((document.getElementById('blankPageH') as HTMLInputElement)?.value ?? '297');
w = Math.round(mmW * 2.8346);
h = Math.round(mmH * 2.8346);
```

`parseFloat('')` / `parseFloat('abc')` → `NaN`; `Math.round(NaN * k)` → `NaN`. A blank
page with `blankWidth: NaN` is then inserted. Downstream `generateThumbnail` guards via
`?? 595` (only triggers on `undefined`/`null`, NOT `NaN`), so `Math.round(NaN*0.15)` →
`NaN` canvas size and a broken thumbnail; export uses `blankWidth ?? 595` likewise. The
NaN-safe `intOr` idiom documented for Bates (#61b) is not applied here.

Recommendation: clamp with a finite-guard, e.g. `const n = parseFloat(...); w =
Number.isFinite(n) && n > 0 ? Math.round(n*2.8346) : 595;` (and a min/max sanity cap).

---

## Notes — verified clean (NOT findings)

- Undo/redo coverage: rotate (RotatePageCmd + TransformAnnotationsCmd + ink macro),
  crop (SetPageCropCmd, applyToAll via MacroCmd), delete (DeletePageCmd restores page +
  elements + GC'd source), reorder (ReorderPagesCmd snapshots before/after id arrays),
  add (AddPagesCmd), insert-blank (InsertBlankPageCmd restores prior currentPageIndex).
  All go through historyManager.execute. No orphaned-element-on-delete (elements are
  filtered+restored by pageId).
- reorderPages is index-stable: cache is keyed by pageId, drop uses `_dragSrcIndex`
  splice on a fresh id array, currentPageIndex re-found by id (documentModel.ts:137-142).
- downloadPageRange: out-of-range indices dropped, empty selection warns
  (`toast.extractNoPages`), edits baked via `_assemblePdfDoc(pages, {cleanMetadata})`,
  FS-Access picker acquired BEFORE assembly (transient-activation rule honored).
- parsePageRange: reversed ranges swapped, clamped to [1,maxPages], malformed tokens
  ignored, ascending unique output. Solid.
- "cannot delete only page" guarded (pageService.ts:207).
- Source-only generateThumbnail correctly composes source `page.rotate` + user
  `docPage.rotation`. Overlay-thumbnail loadingTask.destroy() cleanup present
  (exportService.ts:805) — matches the documented pdf.js v6 worker-release pattern.
- No XSS surface in this domain: all labels via `t()` + `textContent`; the inline
  image-export menu styles are static; no innerHTML of user/translation data.
