# Error Management / Progress Indicators / Customizable Toolbar — Architecture Plan

## Decisions Log

- [2026-06-12] AGREED: Large task, write full architecture plan before any implementation.
- [2026-06-12] AGREED: Three independent features plus open P1/P2 backlog items, all in one sprint.
- [2026-06-12] VERIFIED: eventBinder.ts binds all listeners directly to `app.ui.*` node refs —
  toolbar DnD MUST move live DOM nodes (not rebuild from template) to preserve all handlers.
- [2026-06-12] VERIFIED: Four flyout patterns are per-known-ID hardcoded; must be generalized
  for DnD-created submenus.
- [2026-06-12] AGREED: DnD library → SortableJS (touch-capable; native HTML5 drag not used).
- [2026-06-12] AGREED: Customization scope → responsive-aware (logical order + CSS reflow, all viewports).
- [2026-06-12] AGREED: Scope expanded — mobile-first for ALL three features. Everything must work
  flawlessly on mobile browsers (touch, viewport, keyboard, safe areas).

---

## Formal Plan

### §0 — Mobile-first principles (all features)

PDFturbo is a PWA. Every new UI component must:
1. **Touch targets ≥ 44×44px** (Apple HIG / WCAG 2.5.8) — applies to toast dismiss, progress cancel,
   drag handles on toolbar.
2. **Viewport-edge clamping** — all `position: fixed` overlays (toast, progress, flyouts) must not
   extend beyond `100dvh` / `100dvw`, especially with the mobile keyboard raised (`visualViewport` API).
3. **Safe area insets** — use `env(safe-area-inset-*)` in CSS for notched devices (iPhone X+).
4. **No hover-only affordances** — anything discoverable only on hover must have a touch equivalent.
5. **Pointer events, not mouse events** — new event handlers use `pointerdown/pointermove/pointerup`;
   SortableJS handles this internally for DnD.
6. **`visualViewport` awareness** — when the software keyboard raises, `window.innerHeight` does NOT
   change reliably on iOS. Use `window.visualViewport.height` for overlay positioning.

These apply without exception to: Toast, ProgressOverlay, FlyoutManager, ToolbarCustomizer.

---

### Sequencing rationale

Each feature is independently shippable. The order below is dictated by dependency:
1. **ProgressManager first** — moves loaders off the single `#toast` node; unblocks clean
   error system (both can't share one element without racing).
2. **ErrorReporter second** — toast queue depends on ProgressManager having vacated the
   "long-duration toast" slot; also fixes hardcoded English strings and P2-03/P2-05 backlog.
3. **ToolbarCustomizer last** — most DnD risk; self-contained; no runtime dependency on 1 or 2.

---

## §1 — Error Management & Reporting

### 1.1 Current problems (verified)

| Problem | Evidence |
|---|---|
| Single `#toast`, single timer — second message clobbers first | `uiController.ts:461–474` |
| `showToast('Generating PDF…', 60000)` — loader abuses toast slot | `pdfEditorApp.ts:2073` |
| Hardcoded English bypasses `t()` | `eventBinder.ts:404,541,550` |
| Silent `catch {}` blocks with no feedback | `pdfEditorApp.ts:527,2092,2095` |
| Inconsistent channel: some ops use both console+toast, some toast-only, some neither | grep of all 83 showToast + 3 console calls |

### 1.2 Error taxonomy

```
Severity    Meaning                                   Duration   Icon
─────────   ──────────────────────────────────────    ─────────  ──────
INFO        Operation feedback ("Copied", "Pasted")   2 500 ms   none
WARN        Expected limitation or user input error   4 000 ms   ⚠
ERROR       Unexpected failure affecting work         6 000 ms   ✕

Channel     Toast   console.error   Use when
─────────   ─────   ─────────────   ──────────────────────────────────────────
TOAST_ONLY   ✓       ✗               INFO / WARN (not worth a stack trace)
BOTH         ✓       ✓               ERROR (user sees it, dev can trace it)
CONSOLE_ONLY ✗       ✓               Internal state transitions (not user-visible)
SILENT       ✗       ✗               Expected control flow (per-field form fill catch)
```

### 1.3 New interfaces

```typescript
// src/core/errorReporter.ts
export type ErrorSeverity = 'info' | 'warn' | 'error';

export interface IErrorReporter {
  /** Operation feedback — INFO level, toast only. */
  info(msgKey: string, params?: Record<string, unknown>): void;
  /** Expected limitation — WARN level, toast only. */
  warn(msgKey: string, params?: Record<string, unknown>): void;
  /** Unexpected failure — ERROR level, toast + console.error. */
  error(msgKey: string, err?: unknown, params?: Record<string, unknown>): void;
  /** Internal state failure — no toast, console.warn only. */
  silent(err?: unknown, context?: string): void;
}
```

All `msgKey` parameters are i18n keys — never raw strings. Enforced by convention
(type is `string` but code review + ESLint rule can catch raw-string patterns).

### 1.4 Toast queue

```typescript
// src/ui/toastQueue.ts
export interface IToastQueue {
  enqueue(msg: string, severity: ErrorSeverity, duration: number): void;
  clear(): void;
}

export class ToastQueue implements IToastQueue {
  // Holds ref to the single #toast HTMLElement + a FIFO queue
  // Replace logic: INFO/WARN always replace current; ERROR is always appended
  // (so a user is never left without seeing an ERROR just because INFO fired first)
}
```

`ErrorReporter` depends only on `IToastQueue` — pure, DOM-free, unit-testable in vitest.
`ToastQueue` is the DOM adapter; it is NOT tested with vitest (jsdom can't CSS-transition).
Manual `npm run dev` verification covers the visual layer.

### 1.5 CSS — toast severity classes + mobile positioning

```css
.toast--info   { /* existing style (no change) */ }
.toast--warn   { background: #f59e0b; }   /* amber */
.toast--error  { background: #ef4444; }   /* red   */
```

Icon injected as an `aria-label` + `::before` pseudo-element (no SVG in JS).

**Mobile**: toast must stay above the software keyboard. Current `#toast` uses
`bottom: 1rem` — replace with:

```css
#toast {
  bottom: max(1rem, env(safe-area-inset-bottom));
  /* When keyboard is open, visualViewport shrinks — add JS clamp */
}
```

JS clamp (in `ToastQueue`):
```typescript
private _reposition(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const bottomOffset = window.innerHeight - vv.height - vv.offsetTop;
  this._el.style.bottom = `${Math.max(16, bottomOffset + 16)}px`;
}
// call on: visualViewport 'resize' and 'scroll' events
```

### 1.6 IAppContext changes

```typescript
// src/core/appContext.ts — additions
showProgress(labelKey: string, params?: Record<string, unknown>): ProgressHandle;
reportError: IErrorReporter;
```

`showToast` stays on IAppContext for backward compatibility during migration; removed
after all call sites are converted.

### 1.7 Call-site migration routing table

Every existing `showToast` / `console.*` call is classified below. Implementation
must follow this table — no ad-hoc decisions at call sites.

| File | Pattern | Classified as | New call |
|---|---|---|---|
| `pdfEditorApp.ts:2073` | `showToast('Generating PDF…', 60000)` | progress.begin | → ProgressManager (§2) |
| `pdfEditorApp.ts:2181` | `showToast('Generating page…', 30000)` | progress.begin | → ProgressManager |
| `pdfEditorApp.ts:2226` | `showToast('Generating image…', 30000)` | progress.begin | → ProgressManager |
| `pdfEditorApp.ts:528` | `showToast(t('toast.fileLoadFailed'))` | ERROR / BOTH | `errors.error('toast.fileLoadFailed', err)` |
| `pdfEditorApp.ts:708,725` | `console.error + showToast (undo/redo)` | ERROR / BOTH | `errors.error('toast.renderFailedUndo', err)` |
| `pdfEditorApp.ts:843` | `console.warn + showToast (session restore)` | WARN / BOTH | `errors.warn + errors.silent` |
| `pdfEditorApp.ts:155,532,629,840…` | success feedback toasts | INFO / TOAST_ONLY | `errors.info(key)` |
| `pdfEditorApp.ts:538,962` | user constraint toasts ("only page", "no annotations") | WARN / TOAST_ONLY | `errors.warn(key)` |
| `pdfEditorApp.ts:2092,2095` | `catch { /* form field */ }` | SILENT | `errors.silent(err, 'form-fill')` |
| `eventBinder.ts:404` | `showToast('User password is required')` | WARN / TOAST_ONLY | fix i18n key + `errors.warn('toast.passwordRequired')` |
| `eventBinder.ts:541,550` | `showToast('Eyedropper not supported…')` | WARN / TOAST_ONLY | fix i18n key + `errors.warn('toast.eyedropperUnsupported')` |
| `eventBinder.ts:410,416` | already uses `t()` | INFO / TOAST_ONLY | `errors.info(key)` |
| `sessionManager.ts` | `snap.onError(msg)` | ERROR / BOTH | `errors.error('toast.storageFull')` |

### 1.8 New i18n keys required

Hardcoded strings that must become i18n keys:

| Current raw string | New key | EN value |
|---|---|---|
| `'User password is required'` | `toast.passwordRequired` | `User password is required` |
| `'Eyedropper not supported in this browser'` | `toast.eyedropperUnsupported` | `Color picker not supported in this browser` |

Add to en/fr/ar. Arabic values need native-speaker review.

### 1.9 P2-03 fix (bundled here)

`_insertBlankPage` void IIFE (`pdfEditorApp.ts:916`):

```typescript
// Before — swallows exceptions silently
void (async () => { ... })();

// After — routes through ErrorReporter
void (async () => {
  try { ... }
  catch (err) { this._errors.error('toast.blankPageInsertFailed', err); }
})();
```

### 1.10 Tests

```
tests/core/errorReporter.test.ts
  ✓ info() enqueues with severity INFO and correct duration
  ✓ warn() enqueues with severity WARN
  ✓ error() enqueues toast AND calls console.error
  ✓ silent() calls console.warn only, no toast enqueue
  ✓ replace logic: second INFO replaces first in queue
  ✓ ERROR is appended after current INFO, not replaced
```

`ToastQueue` DOM behavior: manual `npm run dev` verification only (jsdom limitation).

---

## §2 — Loading / Progress Indicators

### 2.1 Current problems (verified)

| Problem | Evidence |
|---|---|
| `showToast('Generating PDF…', 60000)` occupies `#toast` for 60s — any real error during export collides | `pdfEditorApp.ts:2073` |
| `this.ui.container.style.opacity = '0.4'` spread across 3 export paths (not centralized) | lines 2075, 2181, 2226 |
| No loading indicator for: `_loadDocument`, `_restoreSession`, `_imagesToPdf` | `pdfEditorApp.ts:499–532, 779–848, 916+` |
| Opacity not restored on error path (missing `finally`) | `downloadPDF` catch block at 2169–2273 — needs audit |

### 2.2 New interfaces

```typescript
// src/ui/progressManager.ts

export interface ProgressHandle {
  /** Update the visible label mid-operation. */
  update(labelKey: string, params?: Record<string, unknown>): void;
  /** Operation completed — hide overlay after brief success flash. */
  done(): void;
  /** Operation failed — hide overlay immediately (ErrorReporter shows the error toast). */
  failed(): void;
}

export interface IProgressManager {
  /** Show progress overlay with a translated label. Returns a scoped handle. */
  begin(labelKey: string, params?: Record<string, unknown>): ProgressHandle;
}
```

**Stack model**: multiple concurrent `begin()` calls are allowed. The overlay shows the
most-recently-begun label. When the last active handle calls `done()`/`failed()`, the
overlay hides. No depth counter visible to user.

### 2.3 DOM element

```html
<!-- added to index.html, after #toast -->
<div id="progress-overlay" role="status" aria-live="polite" aria-label="">
  <div class="progress-spinner"></div>
  <span id="progress-label"></span>
</div>
```

```css
#progress-overlay {
  display: none;  /* shown via .active class */
  position: fixed;
  inset: 0;
  /* Mobile safe areas */
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
  background: rgba(0,0,0,0.35);
  z-index: 200;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  /* Prevents touch-through to elements below */
  touch-action: none;
}
#progress-overlay.active { display: flex; }
.progress-spinner {
  /* CSS-only spinner — width/height 48px (≥44px touch target) */
  width: 48px; height: 48px;
  border: 4px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
```

`aria-live="polite"` reads the label to screen readers on update.
`aria-label` on the wrapper mirrors the label text for VoiceOver compatibility.
`touch-action: none` prevents scroll-through on mobile while a blocking operation is running.

### 2.4 Operations to instrument

| Method | Label key | Notes |
|---|---|---|
| `_loadDocument` | `progress.loadingDocument` | wrap try/finally |
| `downloadPDF` | `progress.generatingPdf` | replaces toast+opacity |
| `downloadPage` | `progress.exportingPage` | replaces toast+opacity |
| `downloadPageAsImage` | `progress.exportingImage` | replaces toast+opacity |
| `exportAsDocx` | `progress.generatingDocx` | new |
| `exportAsMarkdown` | `progress.generatingMarkdown` | new |
| `_restoreSession` | `progress.restoringSession` | new |
| `_imagesToPdf` | `progress.convertingImages` | replaces `'Converting N images…'` toast |
| `_handleAddPdfUpload` | `progress.loadingDocument` | reuse same key |

Pattern applied uniformly:
```typescript
async downloadPDF(): Promise<void> {
  if (!this.documentModel.pageCount) return;
  this._cleanEmptyTextElements();
  const progress = this._progress.begin('progress.generatingPdf');
  try {
    // ... export logic (no more opacity or long toast)
    progress.done();
  } catch (err) {
    progress.failed();
    this._errors.error('toast.exportFailed', err);
  }
}
```

### 2.5 Opacity removal

All `this.ui.container.style.opacity = '0.4/1'` lines are removed. The progress overlay
replaces this visual feedback (it overlays the entire viewport, preventing interaction
and indicating the blocking operation — a semantically better signal than opacity).

### 2.6 P2-05 fix (SW update toast — bundled here)

```typescript
// vite.config.ts — workbox plugin
registerType: 'prompt',    // was 'autoUpdate'
```

```typescript
// pdfEditorApp.ts — SW event handler
if ('serviceWorker' in navigator) {
  const reg = await navigator.serviceWorker.register('/pdfturbo/sw.js');
  reg.addEventListener('updatefound', () => {
    const newWorker = reg.installing;
    newWorker?.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        // New version available — inform user non-intrusively
        this._errors.info('toast.appUpdateAvailable');
      }
    });
  });
}
```

The INFO toast dismisses after 2.5s — no blocking dialog. User refreshes manually.

### 2.7 New i18n keys required

```
progress.loadingDocument     / Chargement du document…     / جارٍ تحميل المستند…
progress.generatingPdf       / Génération du PDF…          / جارٍ إنشاء ملف PDF…
progress.exportingPage       / Export de la page…          / جارٍ تصدير الصفحة…
progress.exportingImage      / Export de l'image…          / جارٍ تصدير الصورة…
progress.generatingDocx      / Génération du DOCX…         / جارٍ إنشاء ملف DOCX…
progress.generatingMarkdown  / Génération du Markdown…     / جارٍ إنشاء Markdown…
progress.restoringSession    / Restauration de session…    / جارٍ استعادة الجلسة…
progress.convertingImages    / Conversion des images…      / جارٍ تحويل الصور…
toast.appUpdateAvailable     / Mise à jour disponible — rechargez la page  / …
```

Arabic values: placeholder; needs native-speaker review before shipping.

### 2.8 Tests

```
tests/ui/progressManager.test.ts
  ✓ begin() returns a handle; overlay becomes active
  ✓ done() hides overlay when no other handles active
  ✓ failed() hides overlay immediately
  ✓ two concurrent begin() → done() on first → overlay still shown
  ✓ done() on last active handle → overlay hidden
  ✓ update() changes the label text
```

---

## §3 — Customizable Toolbar

### 3.1 Architectural constraint (verified)

`eventBinder.ts` binds ALL 145+ event listeners directly to `app.ui.*` DOM node references
at startup time. Moving a DOM node (re-parenting) preserves its event listeners and its
identity in all `app.ui.*` refs. **Rebuilding HTML from a saved template silently breaks
every handler** — the cloned/created nodes have no listeners and `app.ui.*` still points
to the now-detached originals.

Therefore:
- **DnD reordering MUST move live nodes** via `parentEl.insertBefore(node, ref)`.
- **No innerHTML, no `cloneNode()`, no template re-instantiation.**
- **Layout persistence is a descriptor** (element ID → parent group ID → order index),
  not a snapshot of HTML. Restore replays the descriptor by reordering live nodes.

### 3.2 DnD library — DESIGN DECISION REQUIRED

| Option | Touch support | Bundle cost | External dep |
|---|---|---|---|
| **SortableJS** | ✓ iOS + Android | ~26 KB gz | yes (new dep) |
| **Native HTML5 drag** | ✗ broken on iOS/Android | 0 KB | no |

**Recommendation: SortableJS.** PDFturbo is a PWA deployed to mobile browsers. Native
HTML5 DnD events (`dragstart`, `drop`) do not fire on iOS Safari or Android Chrome —
a customizable toolbar that silently doesn't work on mobile is a defect, not a feature.

SortableJS is the industry-standard solution (30M weekly downloads), actively maintained,
and has zero transitive dependencies. It can be injected as an interface for testing.

**⚠ User must confirm this choice before implementation begins (see §3.2 decision gate).**

### 3.3 ToolbarCustomizer — public interface

```typescript
// src/ui/toolbarCustomizer.ts

export interface ILayoutStorage {
  load(): ToolbarLayout | null;
  save(layout: ToolbarLayout): void;
  clear(): void;
}

export interface ToolbarLayout {
  readonly version: 1;
  /** Ordered list of group IDs within toolbar-row1. */
  groupOrder: string[];
  /** For each group: ordered list of direct-child element IDs. */
  groupItems: Record<string, string[]>;
  /** For each flyout: ordered list of element IDs inside it. */
  flyoutItems: Record<string, string[]>;
}

export class ToolbarCustomizer {
  constructor(
    private readonly _toolbar: HTMLElement,
    private readonly _storage: ILayoutStorage,
    private readonly _sortableFactory: SortableFactory,
  ) {}

  /** Restore saved layout by reordering live nodes. Safe to call on startup. */
  restore(): void;

  /** Enable drag-and-drop customization mode. */
  enable(): void;

  /** Disable drag-and-drop, save current layout. */
  disable(): void;

  /** Clear saved layout and restore DOM to original markup order. */
  reset(): void;
}
```

`ILayoutStorage` default implementation uses `localStorage` key `pdfturbo.toolbarLayout`.
The interface enables swapping to a mock in tests without any DOM or localStorage access.

`SortableFactory` is a thin `(el, options) => Sortable` function — injectable for tests.

### 3.4 Layout scope — DESIGN DECISION REQUIRED

**AGREED: Responsive-aware** — logical order in DOM, CSS flexbox reflows naturally on any viewport.

**Why this works without a CSS architecture refactor:**
- The toolbar rows use CSS flexbox (`display: flex; flex-wrap: wrap`).
- DOM node order IS visual order in a flex container. Reordering DOM nodes = reordering visually.
- On small screens the flex container wraps naturally — the same logical order applies at any width.
- No absolute pixel positions are stored. The layout descriptor records `groupId → [itemId, …]` order only.
- Result: a layout saved on desktop (5-group horizontal bar) reflows to 2–3 wrapping rows on mobile,
  in the same logical sequence the user arranged.

**Mobile-specific toolbar concerns (additional scope):**
1. **Drag handles** — buttons in the toolbar are ≤36px currently. A separate drag-mode handle
   (long-press or dedicated grab icon) must be ≥44px to be touch-friendly.
2. **Long-press to enter drag mode** — on mobile, a tap = tool activation. Drag must be
   triggered by long-press (SortableJS `delay: 300, delayOnTouchOnly: true` option).
3. **Flyout positioning on mobile** — `getBoundingClientRect()` returns coordinates in
   the visual viewport. When the keyboard is raised, coordinates can be outside `visualViewport`.
   `FlyoutManager.reposition()` must clamp to `visualViewport` bounds, not `window` bounds.
4. **No hover affordance** — the "you can drag" affordance must be visible without hover.
   A subtle grip icon (`⣿`) on each toolbar item in drag mode satisfies this.

**Touch drag configuration for SortableJS:**
```typescript
Sortable.create(groupEl, {
  animation: 150,
  delay: 300,             // 300ms long-press before drag starts
  delayOnTouchOnly: true, // desktop: instant drag; mobile: long-press
  touchStartThreshold: 10,// pixels of movement before cancel
  swapThreshold: 0.65,
  onEnd: () => this.save(),
});
```

### 3.5 Layout descriptor

```typescript
// Stored in localStorage as JSON
const DEFAULT_LAYOUT: ToolbarLayout = {
  version: 1,
  groupOrder: ['tbg-file', 'tbg-history', 'tbg-edit', 'tbg-shapes', 'tbg-actions'],
  groupItems: {
    'tbg-file': ['openBtn', 'addPdfBtn', 'clearSessionBtn'],
    'tbg-history': ['undoBtn', 'redoBtn'],
    'tbg-edit': ['selectBtn', 'drawFlyoutWrap', 'annotateFlyoutWrap', ...],
    'tbg-shapes': [...],
    'tbg-actions': ['downloadBtn', 'previewExportBtn', ...],
  },
  flyoutItems: {
    'drawFlyout': ['inkBtn', 'freehandBtn', 'highlightBtn', ...],
    'annotateFlyout': [...],
    'textFlyout': [...],
    'exportFlyout': [...],
  },
};
```

### 3.6 Flyout generalization

Current: 4 hardcoded per-ID flyout toggles in eventBinder.ts (drawFlyoutWrap,
annotateFlyoutWrap, textFlyout, exportFlyout). Each repeats the same pattern:
```
toggle .open class → reposition with getBoundingClientRect() → close on click inside
```

Extracted into:
```typescript
// src/ui/flyoutManager.ts

export interface IFlyoutManager {
  register(triggerEl: HTMLElement, flyoutEl: HTMLElement): void;
  unregister(triggerEl: HTMLElement): void;
  toggle(triggerEl: HTMLElement): boolean;
  closeAll(): void;
}

export class FlyoutManager implements IFlyoutManager {
  // Map<triggerEl, flyoutEl> — allows runtime registration of DnD-created submenus
}
```

Replaces the 4 hardcoded toggle blocks in eventBinder.ts. New dynamically-created
submenus (from DnD) call `flyoutManager.register(trigger, flyout)` at creation time.

### 3.7 Submenu creation (drag-onto-button)

When a user drops item B onto existing item A (not into a group, but onto a button):

1. A new flyout wrapper element is created dynamically:
   ```typescript
   const flyoutWrap = document.createElement('div');
   flyoutWrap.className = 'flyout-wrap';
   const flyout = document.createElement('div');
   flyout.className = 'flyout';
   flyoutWrap.appendChild(flyout);
   ```
2. Node B is moved inside the new flyout: `flyout.appendChild(B)`.
3. A is wrapped with a split-button chevron trigger.
4. `flyoutManager.register(A, flyout)` — wires the generic toggle.
5. Layout descriptor is updated: `flyoutItems['dynamic-0'] = [B.id]`.

Note: `A` and `B` are live DOM nodes — all their event listeners remain intact.

### 3.8 Restore on startup

```typescript
// Called once in PDFEditorApp constructor, before bindEvents
restore(): void {
  const layout = this._storage.load();
  if (!layout) return;  // no saved layout → default markup order

  // Reorder groups within toolbar row
  const row = this._toolbar.querySelector('.toolbar-row1')!;
  for (const groupId of layout.groupOrder) {
    const group = document.getElementById(groupId);
    if (group) row.appendChild(group);  // moves to end, building correct order
  }

  // Reorder items within each group
  for (const [groupId, itemIds] of Object.entries(layout.groupItems)) {
    const group = document.getElementById(groupId);
    if (!group) continue;
    for (const id of itemIds) {
      const el = document.getElementById(id);
      if (el) group.appendChild(el);
    }
  }

  // Reorder items within each flyout
  for (const [flyoutId, itemIds] of Object.entries(layout.flyoutItems)) {
    const flyout = document.getElementById(flyoutId);
    if (!flyout) continue;
    for (const id of itemIds) {
      const el = document.getElementById(id);
      if (el) flyout.appendChild(el);
    }
  }
}
```

`restore()` runs **before** `bindEvents()` — so by the time listeners are attached,
nodes are already in their restored positions and `app.ui.*` refs are still valid.

### 3.9 Tests

```
tests/ui/toolbarCustomizer.test.ts
  ✓ restore() with null storage → DOM unchanged
  ✓ restore() reorders groups according to saved layout
  ✓ restore() reorders items within a group
  ✓ restore() skips unknown element IDs gracefully (no crash on stale layout)
  ✓ disable() saves current DOM order to storage
  ✓ reset() clears storage and DOM returns to original order
  ✓ version mismatch in saved layout → treated as null (fresh layout)

tests/ui/flyoutManager.test.ts
  ✓ register() + toggle() adds/removes .open class
  ✓ closeAll() removes .open from all registered flyouts
  ✓ unregister() stops responding to toggle calls for that trigger
  ✓ repositions flyout based on trigger's getBoundingClientRect()
```

Note: SortableJS drag and touch behavior requires manual browser verification on:
- Desktop Chrome / Firefox (pointer + mouse events)
- iOS Safari (touch, long-press, keyboard interactions)
- Android Chrome (touch, long-press, viewport behavior)
jsdom does not support pointer events or getBoundingClientRect() with real geometry.

---

## §3.5 — God Class Refactor (scope expansion, 2026-06-12)

### Constraint

`PDFEditorApp` is 104KB / 2500+ lines. The prior session reduced it from 3300 lines by extracting
`searchManager`, `sessionManager`, `pdfRenderer`, `inkLayer`, `storage`. What remains is still a
coordinator/renderer/tool-manager/exporter all in one.

The extraction strategy is constrained by `renderElements()`: it destroys and recreates every element
DOM node on every call. This means services can't "own" element nodes — they must return data,
and the coordinator renders. This is the single architectural rule everything else must respect.

### Services to extract

| Service | File | Responsibility | Currently in |
|---|---|---|---|
| `ExportService` | `src/core/exportService.ts` | `downloadPDF`, `downloadPage`, `downloadPageAsImage`, `exportAsDocx`, `exportAsMarkdown` — deduplicates the tripled rotation/cropbox/watermark/ink pipeline | `pdfEditorApp.ts` (3× duplicated) |
| `PageService` | `src/core/pageService.ts` | `_rotatePage`, `_deletePage`, `_insertBlankPage`, `_addPages`, `_reorderPages`, `applyZoom`, `_goToPageIndex` | `pdfEditorApp.ts` |
| `AnnotationService` | `src/core/annotationService.ts` | Element add/delete/clear/clone/select — pure operations on `DocumentModel` + `HistoryManager` | `pdfEditorApp.ts` |
| `ToolModeManager` | `src/core/toolModeManager.ts` | `setMode()`, active tool tracking, toolbar button aria-pressed state | `pdfEditorApp.ts` |

### Injection pattern

Each service receives a **narrow interface** (not `PDFEditorApp`):

```typescript
// ExportService gets what it needs for export — nothing more
interface IExportContext {
  readonly documentModel: DocumentModel;
  readonly elements: readonly PDFElement[];
  renderInkForExport(pageId: string, w: number, h: number, rot: number): string | null;
  progress: IProgressManager;
  errors: IErrorReporter;
}

class ExportService {
  constructor(private ctx: IExportContext) {}
  async downloadPDF(): Promise<void> { … }
  async downloadPage(pageId: string): Promise<void> { … }
  // … shared pipeline extracted here, called by all three download methods
}
```

### What stays in PDFEditorApp

After extraction, `PDFEditorApp`:
- Constructs all services with correct contexts
- Implements `IAppContext` by delegating to services
- Owns the rendering loop (`_renderCurrentPage`, `renderElements`)
- Handles startup (`_restoreSession`, `_loadDocument`)
- Bridges services → UI (calls `renderElements` after service mutates documentModel)

Target: reduce from 2500 → ~700 lines. Each extracted service has full test coverage via mocked interfaces.

### Test strategy for each service

```
tests/core/exportService.test.ts
  ✓ shared pipeline applies watermark to all three export paths
  ✓ shared pipeline applies rotation to all three export paths
  ✓ error in any path calls errors.error() and progress.failed()

tests/core/pageService.test.ts
  ✓ rotatePage pushes RotateCmd to historyManager
  ✓ deletePage removes page from documentModel
  ✓ insertBlankPage adds page and calls onRerender
  ✓ all operations wrapped in try/catch → errors.error()

tests/core/annotationService.test.ts
  ✓ addElement pushes AddElementCmd, calls onRerender
  ✓ deleteElement calls errors.warn when nothing selected
  ✓ clearAnnotations on empty page calls errors.warn
  ✓ cloneElement preserves element type and position offset

tests/core/toolModeManager.test.ts
  ✓ setMode() updates _mode
  ✓ setMode() calls onModeChange callback
  ✓ toolbar state reflects active mode via aria-pressed
```

---

## §4 — Open Fable Backlog

### 4.1 P2-09 — historyManager reference safety

```typescript
// historyManager.ts — _clearFuture or reset
// Before:
this.elements = [];
// After:
this.elements.splice(0);
```

Why: consumers holding a reference to the same array see the mutation immediately.
`this.elements = []` creates a new array — old refs become stale.

One-liner fix; bundled into the first available commit.

### 4.2 P2-10 — UIController smoke test + thumbnail render test

```
tests/ui/uiController.test.ts
  ✓ showToast() sets textContent and adds .show class
  ✓ clearToast() removes .show class and clears textContent
  ✓ setMode() updates aria-pressed on the correct button

tests/ui/pageThumbnailPanel.test.ts
  ✓ renders N thumbnails for N pages
  ✓ highlights the active page thumbnail
  ✓ click on thumbnail triggers onPageSelect callback
```

### 4.3 P1-03 — PDFEditorApp unit tests (surface only)

The god class has near-zero unit coverage. Strategy: test through `IAppContext` boundary.

```
tests/core/pdfEditorApp.showToast.test.ts
  ✓ showToast() delegates to UIController.showToast()

tests/core/pdfEditorApp.errorReporter.test.ts
  ✓ _errors.error() calls both IToastQueue.enqueue() and console.error
  ✓ _errors.info() calls IToastQueue.enqueue() only

tests/core/pdfEditorApp.progress.test.ts
  ✓ _progress.begin() activates overlay; done() deactivates
```

These tests use mock implementations of IToastQueue, IProgressManager, ILayoutStorage —
injected via constructor, not globals. This is the SOLID inversion that makes the god
class partially testable without a real DOM.

### 4.4 P1-04 — geometry import consolidation

Replace all inline copies of geometry helpers with imports from `src/utils/geometry.ts`.
One pass, mechanical: grep for duplicated functions, replace with import.

---

## §5 — Implementation sequence

Each step is independently shippable and CI-green before the next begins.

| Step | Description | Files created/modified | Tests added |
|---|---|---|---|
| **0** | P2-09 + P1-04 quick fixes | `historyManager.ts`, affected element files | none (existing tests cover) |
| **1** | `ToastQueue` + `IToastQueue` interface | `src/ui/toastQueue.ts` (new) | `tests/ui/toastQueue.test.ts` |
| **2** | `ErrorReporter` + `IErrorReporter` | `src/core/errorReporter.ts` (new) | `tests/core/errorReporter.test.ts` |
| **3** | Wire `ErrorReporter` into `IAppContext` + `PDFEditorApp` | `appContext.ts`, `pdfEditorApp.ts` | smoke tests |
| **4** | Migrate all call sites (routing table §1.7) | `pdfEditorApp.ts`, `eventBinder.ts`, `sessionManager.ts` | regression: existing tests pass |
| **5** | Fix hardcoded English strings + add i18n keys | `eventBinder.ts`, `locales/*.json` | locale-sync-check hook |
| **6** | P2-03 `_insertBlankPage` fix (bundled in step 4) | `pdfEditorApp.ts` | error path test |
| **7** | `ProgressManager` + `IProgressManager` | `src/ui/progressManager.ts` (new), `index.html`, CSS | `tests/ui/progressManager.test.ts` |
| **8** | Wire `ProgressManager` into `IAppContext` + instrument all 9 async ops | `appContext.ts`, `pdfEditorApp.ts` | operation tests |
| **9** | Remove all `container.style.opacity` uses + long-duration toasts | `pdfEditorApp.ts` | regression |
| **10** | P2-05 SW `registerType: 'prompt'` + update toast | `vite.config.ts`, `pdfEditorApp.ts` | n/a (PWA, manual only) |
| **11** | P2-10 UIController + thumbnail tests | `tests/ui/uiController.test.ts`, `pageThumbnailPanel.test.ts` (new) | new tests |
| **12** | `FlyoutManager` + replace 4 hardcoded patterns | `src/ui/flyoutManager.ts` (new), `eventBinder.ts` | `tests/ui/flyoutManager.test.ts` |
| **13** | `ToolbarCustomizer` + `ILayoutStorage` | `src/ui/toolbarCustomizer.ts` (new) | `tests/ui/toolbarCustomizer.test.ts` |
| **14** | SortableJS integration + drag-and-drop enable/disable | `pdfEditorApp.ts`, `index.html` (drag handles CSS) | manual `npm run dev` |
| **15** | Submenu creation on drop-onto-button | `toolbarCustomizer.ts` | jsdom-level tests |
| **16** | Toolbar reset button + settings panel entry point | `index.html`, `uiController.ts` | UIController tests |
| **17** | Extract `ExportService` (deduplicates 3×) | `src/core/exportService.ts` (new), `pdfEditorApp.ts` | `tests/core/exportService.test.ts` |
| **18** | Extract `PageService` | `src/core/pageService.ts` (new), `pdfEditorApp.ts` | `tests/core/pageService.test.ts` |
| **19** | Extract `AnnotationService` | `src/core/annotationService.ts` (new), `pdfEditorApp.ts` | `tests/core/annotationService.test.ts` |
| **20** | Extract `ToolModeManager` | `src/core/toolModeManager.ts` (new), `pdfEditorApp.ts` | `tests/core/toolModeManager.test.ts` |
| **21** | `PDFEditorApp` final cleanup (target ~700 lines) | `pdfEditorApp.ts` | all suites green |

### Pre-commit gate (unchanged, all steps)

```bash
npm run type-check && npm run lint && npm run test
```

CI runs this automatically on push to `master`.

---

## §6 — What needs manual browser verification

jsdom cannot test:
- CSS transitions (toast show/hide animation, progress overlay fade)
- SortableJS drag gestures (pointer events with real geometry)
- `getBoundingClientRect()` flyout positioning
- PWA service worker update notification
- Canvas-based page rendering regression

Manual checklist for `npm run dev` after each step:
**Desktop:**
- [ ] Toast shows with correct color/duration for INFO / WARN / ERROR
- [ ] Two rapid errors: first is not swallowed
- [ ] Progress overlay appears/disappears on export, load, restore
- [ ] Toolbar drag-and-drop reorders items (instant drag on desktop)
- [ ] Reloading browser restores saved toolbar layout
- [ ] Reset button returns toolbar to default order
- [ ] Flyouts open/close correctly after DnD reorder
- [ ] All toolbar buttons still work after reorder (listeners preserved)
- [ ] No regression on: undo/redo, page navigation, annotation tools, export

**Mobile (iOS Safari + Android Chrome):**
- [ ] Toast stays above software keyboard (visualViewport-aware positioning)
- [ ] Toast safe-area insets on notched devices
- [ ] Progress overlay covers full viewport, prevents touch-through
- [ ] Toolbar long-press (300ms) activates drag mode on mobile
- [ ] Grip icon visible in drag mode without hover
- [ ] Drag and drop reorders items on touch
- [ ] Flyouts reposition within visualViewport (not clipped behind keyboard)
- [ ] Saved layout persists and restores on mobile
- [ ] All toolbar buttons still work after mobile reorder

---

## §7 — Design decisions log

| Decision | Chosen | Date |
|---|---|---|
| DnD library | **SortableJS** (touch-capable, iOS/Android first) | 2026-06-12 |
| Customization scope | **Responsive-aware** (logical order, CSS reflow, all viewports) | 2026-06-12 |
| Mobile scope | **All three features mobile-first** (toast, progress, toolbar) | 2026-06-12 |

No open decisions remain.

---

STATUS: Designed — not yet implemented. Ready for Phase 5 implementation.
